import test from 'node:test';
import assert from 'node:assert/strict';
import { executionDiagnostics } from '../execution-diagnostics.service.js';

test('diagnostics retain correlation and bounded machine codes only', () => {
  const error = Object.assign(new Error('Bearer secret; customer private data'), {
    code: 'ETIMEDOUT', statusCode: 504, executionId: 42,
    stdout: 'secret', stderr: 'secret', agentResult: { output: 'secret' },
    cause: new Error('secret'),
  });
  error.circular = error;
  assert.deepEqual(executionDiagnostics(error, { operation: 'development', taskId: '12', durationMs: 12.4 }), {
    operation: 'development', taskId: '12', executionId: 42, durationMs: 12,
    errorCode: 'ETIMEDOUT', statusCode: 504,
  });
});

test('untrusted metadata and thrown values cannot inject sensitive log text', () => {
  for (const error of [null, 'Bearer secret', { code: 'secret', statusCode: 'secret', executionId: 'secret' }]) {
    assert.deepEqual(executionDiagnostics(error, { operation: 'secret', taskId: 'secret\nforged', durationMs: Infinity }), {
      operation: 'unknown', taskId: null, executionId: null, durationMs: null, errorCode: null, statusCode: null,
    });
  }
});
