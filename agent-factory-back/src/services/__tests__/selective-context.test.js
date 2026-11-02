import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { includeContextFile, buildSelectiveContext, contextLimits, qaContextChunks, blockingQa, collectExecutionDiff } from '../selective-context.service.js';
const diff = (name, body = '+export const value = 2;') => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${body}\n`;
test('exclude generated, binary extensions, env variants, secrets, traversal and temporary files', () => {
  for (const file of ['node_modules/a.js', 'front/dist/a.js', 'build/a', 'coverage/a', '.git/config', '.env', 'x/.env.production', '.envrc', 'secret.json', 'credentials.json', 'logs/a', 'a.log', 'tmp/a', 'a.tmp', 'a.png', 'a.pem', '../a', 'package-lock.json']) assert.equal(includeContextFile(file), false, file);
  assert.equal(includeContextFile('src/app.js'), true);
  assert.equal(includeContextFile('package-lock.json', true), true);
});
test('safe defaults and invalid environment values', () => {
  assert.equal(contextLimits({}).total, 240000);
  assert.equal(contextLimits({ AGENT_CONTEXT_MAX_CHARS: '-1' }).total, 240000);
  assert.equal(contextLimits({ AGENT_CONTEXT_MAX_RELATED_FILES: '2' }).related, 2);
});
test('select only direct dependencies, exclude env and binary dependencies, redact secrets', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'selective-context-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'a.js'), "import './b.js'; import './.env'; import './binary.js';");
  await fs.writeFile(path.join(root, 'b.js'), "import './unrelated.js'; export const b = 2;");
  await fs.writeFile(path.join(root, 'binary.js'), Buffer.from([0, 255]));
  const result = await buildSelectiveContext({ root, diff: diff('a.js', '+const password = "private-value";') + diff('.env', '+NEVER') });
  assert.deepEqual(result.metrics.includedFiles, ['a.js', 'b.js']);
  assert.equal(result.text.includes('NEVER'), false);
  assert.equal(result.text.includes('private-value'), false);
  assert.equal(result.metrics.excludedFiles.length, 2);
  await assert.rejects(buildSelectiveContext({ root, diff: diff('a.js'), limits: { ...contextLimits(), related: 0 } }), e => e.qaClassification === 'technical_error');
});
test('oversized necessary context fails without silent truncation', async () => {
  for (const limits of [{ ...contextLimits(), file: 5 }, { ...contextLimits(), total: 5 }]) {
    await assert.rejects(buildSelectiveContext({ root: '.', diff: diff('missing.js'), limits }), e => e.qaClassification === 'technical_error');
  }
});
test('frontend/backend groups cover diff once and enforce block limit', () => {
  const source = diff('front/src/A.jsx') + diff('back/src/api.js');
  const groups = qaContextChunks(source);
  assert.equal(groups.length, 2);
  assert.equal(groups.join(''), source);
  assert.throws(() => qaContextChunks(source, { ...contextLimits(), blocks: 1 }), e => e.qaClassification === 'technical_error');
});
test('correction includes blockers only, never passed groups or risks', () => {
  const result = blockingQa('Grupo 1:\nQA_PASS\nHALLAZGOS:\nold resolved\nGrupo 2:\nQA_FAIL\nRESUMEN:\nsummary\nHALLAZGOS:\nbroken api\nRIESGOS:\noptional refactor');
  assert.equal(result, 'QA_FAIL\nbroken api');
  assert.equal(blockingQa('QA_PASS\nHALLAZGOS:\nnone'), '');
});

test('old QA executions are discarded even if they had blockers', () => {
  assert.equal(blockingQa('Grupo 1:\nQA_FAIL\nHALLAZGOS:\nold bug\nGrupo 1:\nQA_FAIL\nHALLAZGOS:\nnew bug'), 'QA_FAIL\nnew bug');
});

for (const command of ['npm run lint', 'npm run test', 'npm run build', 'npm ci', 'node --check src/app.js', 'BACKEND: npm run test', 'FRONTEND: npm run lint']) {
  test(`correction preserves failed validation diagnostics: ${command}`, () => {
    const failed = `=== ${command} ===\nRESULTADO: FAILED\nsrc/app.js:12:3 broken validation\nassertion details`;
    const summary = `=== npm ci ===\nRESULTADO: PASSED\ninstallation output\n\n${failed}\n\n=== npm run build ===\nRESULTADO: PASSED\nbuild output`;
    assert.equal(blockingQa(summary), `QA_FAIL\n${failed}`);
    assert.equal(blockingQa(summary.replaceAll('\n', '\r\n')), `QA_FAIL\n${failed.replaceAll('\n', '\r\n')}`);
  });
}

test('correction includes all failed commands but no successful validations', () => {
  const failed = '=== FRONTEND: npm run lint ===\nRESULTADO: FAILED\nsrc/App.jsx:4 error';
  const other = '=== BACKEND: npm run test ===\nRESULTADO: FAILED\nsrc/app.js:12 assertion failed';
  assert.equal(blockingQa(`${failed}\n\n${other}`), `QA_FAIL\n${failed}\n\n${other}`);
  assert.equal(blockingQa('=== npm run test ===\nRESULTADO: PASSED\nall tests passed'), '');
  assert.equal(blockingQa(`${failed}\n=== REVISION DE CODIGO CLAUDE ===\nQA_PASS\nOK`), '');
});
for (const classification of ['technical_error', 'stale', 'inconclusive', 'passed']) {
  test(`correction excludes diagnostics classified as ${classification}`, () => {
    for (const summary of ['=== npm run lint ===\nRESULTADO: FAILED\nsrc/app.js:12 error', 'Grupo 1:\nQA_FAIL\nHALLAZGOS:\nbroken api']) {
      assert.equal(blockingQa(summary, classification), '');
    }
  });
}

test('simple QA keeps complete diff and only dependencies used by changed lines', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'simple-context-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'a.js'), "import { needed } from './b.js';\nimport { unrelated } from './c.js';\n" + '// large unchanged content\n'.repeat(3000));
  await fs.writeFile(path.join(root, 'b.js'), 'export const needed = 1;');
  await fs.writeFile(path.join(root, 'c.js'), 'export const unrelated = 2;');
  const change = diff('a.js', '-const label = needed("old");\n+const label = needed("new");');
  const normal = await buildSelectiveContext({ root, diff: change });
  const simple = await buildSelectiveContext({ root, diff: change, simple: true });
  assert.equal(simple.diff, change);
  assert.deepEqual(simple.metrics.includedFiles, ['a.js', 'b.js']);
  assert.ok(simple.text.length < normal.text.length);
  assert.ok(!simple.text.includes('large unchanged content'));
  assert.ok(!simple.text.includes('export const unrelated'));
});

test('ignores whitespace-only separators before the first diff header', async () => {
  const change = `\n\n${diff('a.js', '+const value = 1;')}`;
  const result = await buildSelectiveContext({
    root: 'C:/proyectos/test',
    diff: change,
    readFile: async () => '',
  });

  assert.deepEqual(result.metrics.includedFiles, ['a.js']);
  assert.match(result.diff, /diff --git a\/a\.js b\/a\.js/);
});


test('collectExecutionDiff from a nested frontend directory includes root-relative changed files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-nested-worktree-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.name', 'QA Test');
  git('config', 'user.email', 'qa@example.test');
  const nested = path.join(root, 'agent-factory-front');
  await fs.mkdir(path.join(nested, 'src'), { recursive: true });
  await fs.writeFile(path.join(nested, 'src', 'App.jsx'), 'before\n');
  git('add', '.');
  git('commit', '-qm', 'baseline');
  await fs.writeFile(path.join(nested, 'src', 'App.jsx'), 'after\n');
  const result = await collectExecutionDiff(nested);
  assert.equal(
    (await fs.realpath(result.root)).replaceAll('\\', '/').toLowerCase(),
    (await fs.realpath(root)).replaceAll('\\', '/').toLowerCase()
  );
  assert.match(result.diff, /diff --git a\/agent-factory-front\/src\/App\.jsx b\/agent-factory-front\/src\/App\.jsx/);
  assert.match(result.diff, /\+after/);
  const context = await buildSelectiveContext(result);
  assert.deepEqual(context.metrics.includedFiles, ['agent-factory-front/src/App.jsx']);
});
