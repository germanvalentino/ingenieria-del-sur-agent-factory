import fs from 'node:fs/promises';
import path from 'node:path';
import { isText, reviewChunks } from './qa-cycle.service.js';
import { redactSecrets } from './secret-redaction.service.js';
import { executeGit } from './git-command.service.js';
export function contextLimits(env = process.env) {
  const positive = (key, fallback) => /^\d+$/.test(env[key] || '') && Number.isSafeInteger(Number(env[key])) && Number(env[key]) > 0 ? Number(env[key]) : fallback;
  return { file: positive('AGENT_CONTEXT_MAX_FILE_CHARS', 180000), total: positive('AGENT_CONTEXT_MAX_CHARS', 240000), related: positive('AGENT_CONTEXT_MAX_RELATED_FILES', 12), blocks: positive('AGENT_CONTEXT_MAX_QA_BLOCKS', 8) };
}
export function includeContextFile(file, intentionalLock = false) {
  const normalized = file.replaceAll('\\', '/').toLowerCase();
  return !normalized.split('/').some(p => ['..', 'node_modules', 'dist', 'build', 'coverage', '.git', 'tmp', 'temp', 'logs', '.cache'].includes(p) || p.startsWith('.env') || /^(?:\.?secrets?|credentials?)(?:\..*)?$/.test(p)) &&
    !/\.(log|tmp|bak|pem|key|p12|pfx|zip|png|jpg|jpeg|gif|ico|pdf|woff2?|exe|dll|sqlite|map)$/.test(normalized) &&
    (intentionalLock || !normalized.endsWith('package-lock.json'));
}
export function contextError(message, metrics) {
  return Object.assign(new Error(message), { qaClassification: 'technical_error', contextMetrics: metrics });
}
export function blockingQa(text, classification = 'functional_failure') {
  if (classification !== 'functional_failure') return '';
  // Each cycle supplies its latest result; keep failed validations or AI blockers only.
  const latest = String(text || '').split(/=== REVISION DE CODIGO [^=]+ ===/).at(-1);
  const failedCommands = latest.split(/(?=^=== [^\r\n]+ ===\r?$)/m)
    .filter(section => /^=== [^\r\n]+ ===\r?\nRESULTADO: FAILED\r?$/m.test(section));
  if (failedCommands.length) return 'QA_FAIL\n' + failedCommands.map(section => section.trim()).join('\n\n');
  const batch = latest.lastIndexOf('Grupo 1:');
  return (batch >= 0 ? latest.slice(batch) : latest).split(/(?=^Grupo \d+:)/m).filter(group => /(?:^|\n)QA_FAIL\s*(?:\n|$)/.test(group))
    .map(group => 'QA_FAIL\n' + (group.split(/HALLAZGOS:\s*/i)[1] || group.slice(group.indexOf('QA_FAIL') + 7)).split(/\nRIESGOS:/i)[0].trim()).join('\n');
}
export function directImports(source) {
  return [...new Set([...source.matchAll(/(?:from\s*|import\s*\(|require\s*\(|import\s*)['"](\.[^'"]+)['"]/g)].map(m => m[1]))];
}
export async function collectExecutionDiff(root) {
  const git = async args => (await executeGit(['-c', 'core.quotePath=false', ...args], { cwd: root, windowsHide: true, maxBuffer: 20 * 1024 * 1024 })).stdout;
  const repository = (await git(['rev-parse', '--show-toplevel'])).trim();
  // Git emits paths relative to cwd. Always collect from the worktree root so
  // file names match the absolute paths used for reading and diff generation.
  const gitFromRoot = async args => (await executeGit(['-c', 'core.quotePath=false', ...args], { cwd: repository, windowsHide: true, maxBuffer: 20 * 1024 * 1024 })).stdout;
  const tracked = (await gitFromRoot(['diff', 'HEAD', '--name-only', '-z'])).split('\0').filter(Boolean);
  const untracked = (await gitFromRoot(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  const excluded = [], diffs = [];
  const intentionalLocks = tracked.filter(file => file.endsWith('package-lock.json') && tracked.includes(file.replace('package-lock.json', 'package.json')));
  for (const file of [...new Set([...tracked, ...untracked])]) {
    if (!includeContextFile(file, intentionalLocks.includes(file))) { excluded.push({ file, reason: 'policy' }); continue; }
    const absolute = path.join(repository, file);
    let content;
    try {
      const stat = await fs.lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) { excluded.push({ file, reason: 'non-regular' }); continue; }
      if (!await safeRealFile(repository, absolute)) { excluded.push({ file, reason: 'non-regular' }); continue; }
      const bytes = await fs.readFile(absolute);
      if (!isText(bytes)) { excluded.push({ file, reason: 'binary' }); continue; }
      content = bytes.toString('utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (untracked.includes(file)) diffs.push(`diff --git a/${file} b/${file}\n--- /dev/null\n+++ b/${file}\n${content.split('\n').map(line => '+' + line).join('\n')}`);
    else diffs.push(await gitFromRoot(['diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--unified=3', '--', file]));
  }
  return { root: repository, diff: diffs.join('\n'), excluded, intentionalLocks };
}
export async function buildSelectiveContext({ root, diff = '', excluded = [], intentionalLocks = [], limits = contextLimits(), readFile = fs.readFile, simple = false }) {
  const metrics = { characters: 0, includedFiles: [], excludedFiles: [...excluded], blocksReviewed: 0 };
  const files = diff.split(/(?=^diff --git )/m).filter(section => section.trim().length > 0);
  const safe = [];
  for (const section of files) {
    const file = section.match(/^diff --git a\/(.+?) b\/(.+)\r?$/m)?.[2];
    if (!file) throw contextError('Contexto inseguro: no se pudo identificar archivo del diff', metrics);
    if (!includeContextFile(file, intentionalLocks.includes(file))) { metrics.excludedFiles.push({ file, reason: 'policy' }); continue; }
    if (!isText(Buffer.from(section))) throw contextError(`Contexto inseguro: diff binario: ${file}`, metrics);
    if (section.length > limits.file) { metrics.excludedFiles.push({ file, reason: 'file limit; review blocked' }); throw contextError(`Contexto inseguro: diff excede limite por archivo: ${file}`, metrics); }
    safe.push(section); metrics.includedFiles.push(file);
  }
  const dependencies = [];
  const dependencyOwners = {};
  for (const file of [...metrics.includedFiles]) {
    let source;
    try {
      const absolute = path.join(root, file);
      if (readFile === fs.readFile && !await safeRealFile(root, absolute)) throw contextError(`Contexto inseguro: ruta fuera del worktree: ${file}`, metrics);
      source = await readFile(absolute, 'utf8');
    } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    // For simple QA, only imports referenced by changed lines need extra context.
    const section = safe.find(section => section.startsWith(`diff --git a/${file} b/${file}\n`) || section.startsWith(`diff --git a/${file} b/${file}\r\n`)) || '';
    const changed = section
      .split(/\r?\n/)
      .filter((line) => /^[+-](?![+-])/.test(line))
      .map((line) => line.slice(1))
      .join("\n");
    const imports = simple ? directImports(source).filter(specifier => {
      if (directImports(changed).includes(specifier)) return true;
      const statements = [...source.matchAll(/(?:import\s+([^;'"]*?)\s+from\s*|(?:const|let|var)\s+([^;\n]+?)\s*=\s*require\s*\()['"]([^'"]+)['"]/g)];
      return statements.some(match => match[3] === specifier && (match[1] || match[2]).match(/[A-Za-z_$][\w$]*/g)?.some(name => !['as', 'type'].includes(name) && new RegExp(`\\b${name.replaceAll('$', '\\$')}\\b`).test(changed)));
    }) : directImports(source);
    for (const specifier of imports) {
      const base = path.resolve(root, path.dirname(file), specifier);
      for (const suffix of ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '/index.js', '/index.jsx', '/index.ts', '/index.tsx']) {
        const absolute = base + suffix, relative = path.relative(root, absolute).replaceAll('\\', '/');
        if (!includeContextFile(relative) || path.isAbsolute(relative)) break;
        if (metrics.includedFiles.includes(relative)) {
          if (dependencyOwners[relative]) dependencyOwners[relative].push(file);
          break;
        }
        let bytes;
        try { const stat = await fs.lstat(absolute); if (stat.isDirectory()) continue; if (!stat.isFile() || stat.isSymbolicLink() || !await safeRealFile(root, absolute)) throw contextError(`Contexto inseguro: dependencia fuera del worktree: ${relative}`, metrics); bytes = await readFile(absolute); } catch (e) { if (['ENOENT', 'EISDIR'].includes(e.code)) continue; throw e; }
        if (!isText(Buffer.from(bytes))) { metrics.excludedFiles.push({ file: relative, reason: 'binary dependency' }); break; }
        if (dependencies.length >= limits.related || bytes.length > limits.file) throw contextError(`Contexto inseguro: dependencia requerida excede limites: ${relative}`, metrics);
        dependencyOwners[relative] = [file];
        dependencies.push(`ARCHIVO ${relative}:\n${bytes.toString()}`); metrics.includedFiles.push(relative); break;
      }
    }
  }
  const text = redactSecrets(`DIFF VIGENTE (revisar primero):\n${safe.join('\n')}\nDEPENDENCIAS DIRECTAS:\n${dependencies.join('\n\n')}`);
  if (text.length > limits.total) throw contextError('Contexto inseguro: excede limite total', metrics);
  metrics.characters = text.length;
  return { text, diff: safe.join('\n'), dependencies: redactSecrets(dependencies.join('\n\n')), dependencyOwners, dependencyFiles: dependencies.map(text => redactSecrets(text)), metrics };
}
export function qaContextChunks(diff, limits = contextLimits()) {
  // Keep frontend and backend in separate groups, preserving complete coverage.
  const files = diff.split(/(?=^diff --git )/m).filter(Boolean);
  const groups = new Map();
  for (const file of files) {
    const name = file.match(/^diff --git a\/(\S+)/)?.[1] || '';
    const key = /front|client|\.jsx|\.tsx/.test(name) ? 'frontend' : /back|server/.test(name) ? 'backend' : 'shared';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  const chunks = [...groups.values()].flatMap(group => {
    const parts = reviewChunks(group.join(''));
    return parts.map((part, index) => index === 0 || part.startsWith('diff --git ') ? part : `CONTINUACION DEL GRUPO: ${group.map(file => file.split('\n')[0]).join('; ')}\n${part}`);
  });
  if (chunks.length > limits.blocks) throw contextError('Contexto inseguro: excede maximo de bloques QA');
  return chunks;
}

async function safeRealFile(root, absolute) {
  const realRoot = await fs.realpath(root), realFile = await fs.realpath(absolute);
  const relative = path.relative(realRoot, realFile);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && includeContextFile(relative, true);
}
