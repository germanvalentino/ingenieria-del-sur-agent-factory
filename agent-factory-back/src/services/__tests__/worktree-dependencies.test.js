import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectWorktreeDependencies } from '../worktree-dependencies.service.js';

test('existing empty node_modules is not sufficient', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'af-deps-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '^5.0.0' } }));
  await fs.mkdir(path.join(dir, 'node_modules'));
  const result = await inspectWorktreeDependencies(dir);
  assert.deepEqual(result, { missing: ['express'], ready: false });
});

test('installed direct dependency is accepted', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'af-deps-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '^5.0.0' } }));
  await fs.mkdir(path.join(dir, 'node_modules', 'express'), { recursive: true });
  await fs.writeFile(path.join(dir, 'node_modules', 'express', 'package.json'), JSON.stringify({ name: 'express', version: '5.0.0', main: 'index.js' }));
  await fs.writeFile(path.join(dir, 'node_modules', 'express', 'index.js'), 'module.exports = {};');
  const result = await inspectWorktreeDependencies(dir);
  assert.deepEqual(result, { missing: [], ready: true });
});
