// Reproducible comparison of a small current change, without calling a provider.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSelectiveContext } from '../src/services/selective-context.service.js';
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = 'agent-factory-back/src/services/secret-redaction.service.js';
const git = async lines => (await exec('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'diff', 'HEAD', '--no-ext-diff', '--no-textconv', `--unified=${lines}`, '--', file], { cwd: root })).stdout;
const before = await git(60), diff = await git(3);
if (!diff) throw new Error('Benchmark requires the current small redaction change');
const after = await buildSelectiveContext({ root, diff });
console.log(JSON.stringify({ beforeDiffCharacters: before.length, afterDiffCharacters: diff.length, afterContextCharacters: after.text.length, files: after.metrics.includedFiles.length, contextReductionPercent: Number(((1 - after.text.length / before.length) * 100).toFixed(2)), providerCalls: 0 }, null, 2));
