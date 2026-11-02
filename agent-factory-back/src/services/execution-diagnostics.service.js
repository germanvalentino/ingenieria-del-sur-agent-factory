// Never serialize errors: messages, stacks and provider output can contain secrets.
const CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
const OPERATIONS = new Set(['development', 'correction', 'qa', 'qa-alternative', 'qa-release']);

function safeId(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  return /^(?:[1-9]\d{0,18}|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i.test(value) ? value : null;
}

export function executionDiagnostics(error, { operation, taskId, executionId, durationMs } = {}) {
  return {
    operation: OPERATIONS.has(operation) ? operation : 'unknown',
    taskId: safeId(taskId),
    executionId: safeId(error?.executionId) ?? safeId(executionId),
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : null,
    errorCode: CODES.has(error?.code) ? error.code : null,
    statusCode: Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : null,
  };
}
