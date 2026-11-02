import test from 'node:test';
import assert from 'node:assert/strict';
import { isQaFallbackEligible } from '../qa-fallback-eligibility.js';

const task = { status: 'review', qa_status: 'pending', auto_correction_active: false,
  agent_working_path: 'worktree', worktree_path: 'worktree' };
const blocked = { provider: 'claude', status: 'failed', error_message: 'rate limit exceeded' };

test('fallback appears only for last failed independent reviewer with provider error', () => {
  assert.equal(isQaFallbackEligible({ task, developmentProvider: 'codex', lastQa: blocked }), true);
  assert.equal(isQaFallbackEligible({ task, developmentProvider: 'codex', lastQa: { ...blocked, error_message: 'npm run test failed' } }), false);
  assert.equal(isQaFallbackEligible({ task, developmentProvider: 'codex', lastQa: { ...blocked, provider: 'codex' } }), false);
  assert.equal(isQaFallbackEligible({ task, developmentProvider: 'codex', lastQa: { ...blocked, status: 'passed' } }), false);
  assert.equal(isQaFallbackEligible({ task: { ...task, auto_correction_active: true }, developmentProvider: 'codex', lastQa: blocked }), false);
  assert.equal(isQaFallbackEligible({ task: { ...task, qa_status: 'passed' }, developmentProvider: 'codex', lastQa: blocked }), false);
  assert.equal(isQaFallbackEligible({ task, developmentProvider: 'codex', lastQa: null }), false);
});
