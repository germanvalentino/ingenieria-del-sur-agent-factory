import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { TaskQueue, concurrencyLimit, acquireExecutionOwner } from '../task-queue.service.js';

const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
function store(count = 6) {
  const tasks = Array.from({ length: count }, (_, i) => ({ id: String(i + 1), status: 'queued',
    project_id: `project-${i % 2}`, worktree_path: `isolated/${i}`, execution_requested_at: null }));
  let order = 0;
  const db = { tasks, fail: false, async query(sql, args = []) {
    if (db.fail) throw new Error('database unavailable');
    let rows = [];
    if (sql.includes('COALESCE(execution_requested_at')) {
      const task = tasks.find(t => t.id === args[0] && t.status === 'queued');
      if (task) { task.execution_requested_at ??= ++order; rows = [{ ...task }]; }
    } else if (sql.startsWith('SELECT id')) {
      rows = tasks.filter(t => t.status === 'queued' && t.execution_requested_at !== null && !args[0].includes(t.id))
        .sort((a, b) => a.execution_requested_at - b.execution_requested_at).slice(0, 1).map(t => ({ id: t.id, request_key: t.execution_requested_at }));
    } else if (sql.includes('status = CASE')) {
      const task = tasks.find(t => t.id === args[0]);
      if (task.execution_requested_at !== args[2]) return { rows: [] };
      task.execution_requested_at = null;
      if (task.status === 'queued') task.status = 'failed';
    } else if (sql.includes("SET status = 'failed'")) {
      for (const t of tasks) if (t.execution_requested_at !== null && t.status === 'running' && !args[0].includes(t.id)) t.status = 'failed';
    } else if (sql.includes('SET execution_requested_at = NULL')) {
      for (const t of tasks) if (!['queued', 'running'].includes(t.status) && !args[0].includes(t.id)) t.execution_requested_at = null;
    } else throw new Error(`Unexpected SQL: ${sql}`);
    return { rows, rowCount: rows.length };
  } };
  return db;
}
function deferredRunner(db) {
  const started = [], finish = new Map();
  let peak = 0, running = 0;
  return { started, finish, get peak() { return peak; }, run(id) {
    started.push(id);
    running++;
    peak = Math.max(peak, running);
    db.tasks.find(t => t.id === id).status = 'running';
    return new Promise(resolve => finish.set(id, (status = 'review') => {
      db.tasks.find(t => t.id === id).status = status;
      running--;
      resolve(status === 'review' ? 200 : 500);
    }));
  } };
}

test('configuration defaults to two and rejects unsafe limits', () => {
  assert.equal(concurrencyLimit('2'), 2);
  for (const n of [0, -1, 1.2, '', '2x', 'Infinity', '9007199254740992']) assert.throws(() => concurrencyLimit(n));
});

for (const limit of [1, 2, 3]) test(`FIFO, duplicate requests and concurrent drains respect limit ${limit}`, async t => {
  const db = store(20), runner = deferredRunner(db);
  const queue = new TaskQueue({ db, limit });
  t.after(() => queue.stop());
  await Promise.all(db.tasks.flatMap(task => [queue.enqueue(task.id), queue.enqueue(task.id)]));
  const paths = db.tasks.map(t => [t.project_id, t.worktree_path]);
  queue.start(runner.run);
  await Promise.all(Array.from({ length: 20 }, () => queue.drain()));
  await flush();
  assert.equal(runner.started.length, limit);
  assert.equal(db.tasks.filter(t => t.status === 'queued').length, 20 - limit);
  for (const task of db.tasks) {
    await flush();
    assert.ok(runner.finish.has(task.id));
    runner.finish.get(task.id)(Number(task.id) % 3 ? 'review' : 'failed');
  }
  await flush();
  assert.equal(runner.peak, limit);
  assert.deepEqual(runner.started, db.tasks.map(t => t.id));
  assert.equal(new Set(runner.started).size, 20);
  assert.ok(db.tasks.every(t => t.execution_requested_at === null));
  assert.deepEqual(db.tasks.map(t => [t.project_id, t.worktree_path]), paths);
});

test('validation error releases capacity and next task runs', async t => {
  const db = store(2), seen = [];
  const queue = new TaskQueue({ db, limit: 1 });
  t.after(() => queue.stop());
  await queue.enqueue('1'); await queue.enqueue('2');
  queue.start(async id => { seen.push(id); return 400; });
  await flush();
  assert.deepEqual(seen, ['1', '2']);
  assert.ok(db.tasks.every(t => t.status === 'failed' && t.execution_requested_at === null));
});

test('DB outage retains waiting work, rejects unpersisted requests, and recovers without duplicates', async t => {
  const db = store(3), errors = [];
  const queue = new TaskQueue({ db, limit: 1, report: e => errors.push(e) });
  t.after(() => queue.stop());
  await queue.enqueue('1'); await queue.enqueue('2');
  db.fail = true;
  await assert.rejects(queue.enqueue('3'), /unavailable/);
  const runner = deferredRunner(db);
  queue.start(runner.run);
  await flush();
  assert.equal(runner.started.length, 0);
  db.fail = false;
  await queue.drain(); await flush();
  db.fail = true;
  runner.finish.get('1')(); await flush();
  assert.ok(db.tasks[0].execution_requested_at !== null);
  assert.equal(runner.started.length, 1);
  db.fail = false;
  await queue.drain(); await flush();
  assert.deepEqual(runner.started, ['1', '2']);
  runner.finish.get('2')(); await flush();
  assert.equal(db.tasks[0].execution_requested_at, null);
  assert.equal(db.tasks[2].execution_requested_at, null);
  assert.ok(errors.length >= 2);
});

test('restart resumes persisted pending requests, preserves failed interrupted work for explicit retry', async t => {
  const db = store(2);
  const previous = new TaskQueue({ db });
  await previous.enqueue('1'); await previous.enqueue('2');
  db.tasks[0].status = 'failed'; // Existing startup recovery of interrupted execution.
  const runner = deferredRunner(db), restarted = new TaskQueue({ db });
  t.after(() => restarted.stop());
  restarted.start(runner.run); await flush();
  assert.deepEqual(runner.started, ['2']);
  assert.equal(db.tasks[0].status, 'failed');
  assert.equal(db.tasks[0].execution_requested_at, null);
  runner.finish.get('2')(); await flush();
});

test('unexpected worker rejection retains pending request and retries on next poll', async t => {
  const db = store(1), errors = [];
  const queue = new TaskQueue({ db, report: e => errors.push(e) });
  t.after(() => queue.stop());
  await queue.enqueue('1');
  queue.start(async () => { throw new Error('temporary'); }); await flush();
  assert.equal(errors.length, 1); // No tight retry loop.
  assert.ok(db.tasks[0].execution_requested_at !== null);
  const runner = deferredRunner(db);
  queue.run = runner.run;
  await queue.drain(); await flush();
  assert.deepEqual(runner.started, ['1']);
  runner.finish.get('1')(); await flush();
});

test('exclusive DB owner rejects a second backend and fails closed on lock connection loss', async () => {
  let released = false, lost = false;
  const client = new EventEmitter();
  client.query = async () => ({ rows: [{ acquired: false }] });
  client.release = () => { released = true; };
  const db = { connect: async () => client };
  await assert.rejects(acquireExecutionOwner(db), /Otro backend/);
  assert.equal(released, true);
  client.query = async () => ({ rows: [{ acquired: true }] });
  assert.equal(await acquireExecutionOwner(db, () => { lost = true; }), client);
  client.emit('error', new Error('connection lost'));
  assert.equal(lost, true);
});


test('late completion cannot consume or fail a newer retry request', async t => {
  const db = store(1), queue = new TaskQueue({ db, limit: 1 });
  t.after(() => queue.stop());
  await queue.enqueue('1');
  let starts = 0, finishRetry;
  queue.start(async id => {
    starts++;
    if (starts === 1) {
      // Atomic failure followed by a user retry before the old worker settles.
      db.tasks[0].status = 'failed';
      db.tasks[0].execution_requested_at = null;
      db.tasks[0].status = 'queued';
      await queue.enqueue(id);
      return 500;
    }
    db.tasks[0].status = 'running';
    return new Promise(resolve => { finishRetry = () => {
      db.tasks[0].status = 'review'; resolve(200);
    }; });
  });
  await flush();
  assert.equal(starts, 2);
  assert.equal(db.tasks[0].status, 'running');
  assert.ok(db.tasks[0].execution_requested_at !== null);
  finishRetry(); await flush();
  assert.equal(db.tasks[0].status, 'review');
});
