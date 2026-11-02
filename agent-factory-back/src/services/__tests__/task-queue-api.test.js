import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import tasksRouter, { executeQueuedTask } from '../../routes/tasks.routes.js';
import dashboardRouter from '../../routes/dashboard.routes.js';
import { pool } from '../../db.js';

// Exercise the actual HTTP routers and JSON contract consumed by the dashboard.
test('run responds 202 with a durable request; dashboard reports global queue beyond 50 cards', async t => {
  let requested = false;
  const task = { id: '11111111-1111-1111-1111-111111111111', status: 'queued', project_id: 'project-a' };
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push(sql);
    if (sql.includes('COALESCE(execution_requested_at')) {
      assert.equal(params[0], task.id);
      requested = true;
      return { rows: [{ ...task, execution_requested_at: '2026-11-02T10:00:00.000Z' }] };
    }
    if (sql.includes('COUNT(*) FILTER')) return { rows: [{ active: 2, pending: 70 }] };
    if (sql.includes('FROM tasks t')) return { rows: [{ ...task, execution_requested_at: requested ? '2026-11-02T10:00:00.000Z' : null }] };
    return { rows: [] };
  });
  const app = express();
  app.use(express.json());
  app.use('/api/tasks', tasksRouter);
  app.use('/api/dashboard', dashboardRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/tasks/${task.id}/run`, { method: 'POST' });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.id, task.id);
    assert.equal(body.status, 'queued');
    assert.ok(body.execution_requested_at);
  }
  const response = await fetch(`${base}/dashboard`);
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  assert.equal(dashboard.metrics.runningTasks, 2);
  assert.equal(dashboard.metrics.queuedTasks, 70);
  assert.deepEqual(dashboard.executionQueue, { active: 2, pending: 70, limit: 2 });
  assert.equal(dashboard.tasks[0].execution_requested_at, '2026-11-02T10:00:00.000Z');
  assert.ok(!queries.some(sql => /SET status = 'running'/.test(sql)), 'enqueue must not start an agent or reserve a worktree');
});

test('dashboard excludes automatic QA corrections from development queue counts', async t => {
  const tasks = [
    { id: 'a', status: 'running', execution_requested_at: '2026-11-02T10:00:00Z' },
    { id: 'b', status: 'running', execution_requested_at: '2026-11-02T10:00:01Z' },
    { id: 'c', status: 'running', execution_requested_at: null, auto_correction_active: true },
    { id: 'd', status: 'queued', execution_requested_at: '2026-11-02T10:00:02Z' },
    { id: 'e', status: 'queued', execution_requested_at: null },
  ];
  t.mock.method(pool, 'query', async sql => {
    if (sql.includes('COUNT(*) FILTER')) {
      // Guard the SQL boundary: a constant aggregate mock would hide this regression.
      assert.match(sql, /COUNT\(\*\) FILTER \(WHERE status = 'running' AND execution_requested_at IS NOT NULL\)::int AS active/);
      assert.match(sql, /COUNT\(\*\) FILTER \(WHERE status = 'queued' AND execution_requested_at IS NOT NULL\)::int AS pending/);
      return { rows: [{
        active: tasks.filter(task => task.status === 'running' && task.execution_requested_at !== null).length,
        pending: tasks.filter(task => task.status === 'queued' && task.execution_requested_at !== null).length,
      }] };
    }
    return { rows: sql.includes('FROM tasks t') ? tasks : [] };
  });
  const app = express();
  app.use('/api/dashboard', dashboardRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard`);
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  assert.deepEqual(dashboard.executionQueue, { active: 2, pending: 1, limit: 2 });
  assert.equal(dashboard.metrics.runningTasks, 2);
  assert.equal(dashboard.metrics.queuedTasks, 1);
  assert.equal(dashboard.tasks.find(task => task.id === 'c').status, 'running');
});

test('run rejects non-queued tasks without executing or updating their state', async t => {
  let calls = 0;
  t.mock.method(pool, 'query', async () => { calls++; return { rows: [] }; });
  const handler = tasksRouter.stack.find(l => l.route?.path === '/:id/run').route.stack[0].handle;
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler({ params: { id: 'missing' } }, response);
  assert.equal(response.code, 409);
  assert.equal(calls, 1);
});


test('development error before reservation never changes another execution state', async t => {
  const queries = [];
  t.mock.method(console, 'error', () => {});
  t.mock.method(pool, 'query', async sql => {
    queries.push(sql);
    throw new Error('temporary database failure');
  });
  assert.equal(await executeQueuedTask('task-id'), 500);
  assert.equal(queries.length, 1);
  assert.ok(!queries.some(sql => /UPDATE tasks/.test(sql)));
});
