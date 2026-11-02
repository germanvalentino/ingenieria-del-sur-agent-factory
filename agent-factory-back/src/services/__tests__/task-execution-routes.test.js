import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../../routes/tasks.routes.js';
import { pool } from '../../db.js';

for (const [route, operation, state] of [
  ['run', 'development', "status = 'failed'"],
  ['correct', 'correction', "status = 'review'"],
  ['qa', 'qa', 'qa_status = $3'],
]) {
  test(`${route}: safe diagnostics preserve HTTP failure and state recovery`, async (t) => {
    const error = Object.assign(new Error('provider rejected Bearer private-token'), { code: 'ECONNRESET', executionId: 72 });
    const queries = [];
    const logs = [];
    t.mock.method(pool, 'query', async (sql, values) => {
      queries.push({ sql, values });
      if (queries.length === 1) throw error;
      return { rows: [] };
    });
    t.mock.method(console, 'error', (...args) => logs.push(args));
    const handler = router.stack.find(layer => layer.route?.path === `/:id/${route}`).route.stack[0].handle;
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ params: { id: '12' }, body: {} }, response);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { status: 'error', message: error.message });
  if (route === 'qa') {
  // El error ocurre antes de adquirir la reserva de QA.
  // No debe intentarse liberar una reserva inexistente.
  assert.equal(queries.length, 1);
} else {
  assert.ok(queries[1].sql.includes(state));
  assert.equal(queries[1].values[0], '12');
}
    assert.equal(logs.length, 1);
    assert.equal(logs[0][1].operation, operation);
    assert.equal(logs[0][1].taskId, '12');
    assert.equal(logs[0][1].executionId, 72);
    assert.equal(logs[0][1].errorCode, 'ECONNRESET');
    assert.ok(logs[0][1].durationMs >= 0);
    assert.ok(!JSON.stringify(logs).includes('private-token'));
  });
}

for (const releaseFails of [false, true]) {
  test(`alternative QA preserves unlock after failure (release fails: ${releaseFails})`, async (t) => {
    const logs = [];
    let released = false;
    let calls = 0;
    const failure = new Error('provider private-token');
    t.mock.method(console, 'error', (...args) => logs.push(args));
    t.mock.method(pool, 'query', async (sql) => {
      calls++;
      if (calls === 1) return { rows: [{ id: 12, status: 'review', qa_status: 'pending', agent_working_path: 'unused', worktree_path: 'unused', auto_correction_active: false }] };
      if (calls === 2) return { rows: [{ provider: 'codex' }] };
      if (calls === 3) return { rows: [{ provider: 'claude', status: 'failed', error_message: 'ETIMEDOUT' }] };
      if (calls === 4) return { rowCount: 1, rows: [{ id: 12 }] };
      if (calls === 5) throw failure;
      if (sql.includes("SET qa_status = 'pending'")) {
        released = true;
        if (releaseFails) throw failure;
      }
      return { rows: [] };
    });
    const handler = router.stack.find(layer => layer.route?.path === '/:id/qa/authorize-fallback').route.stack[0].handle;
    const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ params: { id: '12' }, body: { authorize: true } }, response);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { message: failure.message });
    assert.equal(released, true);
    assert.equal(logs[0][1].operation, 'qa-alternative');
    assert.equal(logs.length, releaseFails ? 2 : 1);
    if (releaseFails) assert.equal(logs[1][1].operation, 'qa-release');
    assert.ok(!JSON.stringify(logs).includes('private-token'));
  });
}
