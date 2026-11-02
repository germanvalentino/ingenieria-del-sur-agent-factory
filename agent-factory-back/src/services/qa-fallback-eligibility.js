import { getAlternativeProvider, getProviderFailure } from './agent-runner.service.js';

// The UI must not infer authorization from a free-text QA summary.
// The endpoint still revalidates against the database before taking the lock.
export function isQaFallbackEligible({ task, developmentProvider, lastQa }) {
  if (!task || task.status !== 'review' || task.qa_status !== 'pending' ||
      task.auto_correction_active || !task.agent_working_path || !task.worktree_path ||
      !['codex', 'claude'].includes(developmentProvider)) return false;

  const reviewer = getAlternativeProvider(developmentProvider);
  return Boolean(lastQa && lastQa.status === 'failed' &&
    lastQa.provider === reviewer &&
    getProviderFailure(new Error(lastQa.error_message || '')).isProviderFailure);
}
