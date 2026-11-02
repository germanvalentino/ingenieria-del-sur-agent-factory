import { pool } from "../db.js";
import { executionDiagnostics } from "./execution-diagnostics.service.js";

export function concurrencyLimit(value = process.env.MAX_CONCURRENT_TASKS ?? "2") {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error("MAX_CONCURRENT_TASKS debe ser un entero positivo");
  }
  return Number(value);
}

// The existing startup recovery is also exclusive: a second API instance must
// never reset tasks belonging to a live instance. Keep this session for life.
export async function acquireExecutionOwner(db = pool, onLost = () => process.exit(1)) {
  const client = await db.connect();
  try {
    const result = await client.query("SELECT pg_try_advisory_lock(179363, 1) AS acquired");
    if (!result.rows[0].acquired) throw new Error("Otro backend controla la ejecucion de tareas");
    client.on("error", onLost);
    return client;
  } catch (error) {
    client.release();
    throw error;
  }
}

export class TaskQueue {
  constructor({ db = pool, limit = concurrencyLimit(), report = (error) =>
    console.error("Error en cola:", executionDiagnostics(error, { operation: "queue" })) } = {}) {
    this.db = db;
    this.limit = concurrencyLimit(limit);
    this.report = report;
    this.active = new Set();
    this.draining = false;
  }

  async getStatus() {
    const result = await this.db.query(`SELECT
      COUNT(*) FILTER (WHERE status = 'running' AND execution_requested_at IS NOT NULL)::int AS active,
      COUNT(*) FILTER (WHERE status = 'queued' AND execution_requested_at IS NOT NULL)::int AS pending
      FROM tasks`);
    return { active: result.rows[0].active, pending: result.rows[0].pending, limit: this.limit };
  }

  async enqueue(id) {
    // One persistent request per task. Repeated clicks preserve FIFO order.
    const result = await this.db.query(`UPDATE tasks
      SET execution_requested_at = COALESCE(execution_requested_at, clock_timestamp())
      WHERE id = $1 AND status = 'queued' RETURNING *`, [id]);
    this.wake();
    return result.rows[0];
  }

  start(run) {
    if (this.timer) throw new Error("La cola ya esta iniciada");
    this.run = run;
    this.timer = setInterval(() => this.wake(), 1000);
    this.timer.unref?.();
    this.wake();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.run = null;
  }

  wake() {
    if (this.run) void this.drain().catch(this.report);
  }

  async drain() {
    if (this.draining || !this.run) return;
    this.draining = true;
    try {
      // A completed worker whose final DB write failed must not leave a slot
      // occupied forever. Only this owner runs development; live IDs are excluded.
      await this.db.query(`UPDATE tasks SET status = 'failed',
        execution_finished_at = NOW(), updated_at = NOW()
        WHERE execution_requested_at IS NOT NULL AND status = 'running'
          AND NOT (id = ANY($1::uuid[]))`, [[...this.active]]);
      await this.db.query(`UPDATE tasks SET execution_requested_at = NULL
        WHERE execution_requested_at IS NOT NULL AND status NOT IN ('queued', 'running')
          AND NOT (id = ANY($1::uuid[]))`, [[...this.active]]);
      while (this.run && this.active.size < this.limit) {
        const result = await this.db.query(`SELECT id, execution_requested_at::text AS request_key FROM tasks
          WHERE status = 'queued' AND execution_requested_at IS NOT NULL
            AND NOT (id = ANY($1::uuid[]))
          ORDER BY execution_requested_at, id LIMIT 1`, [[...this.active]]);
        const task = result.rows[0];
        if (!task) break;
        // Reserve synchronously before invoking asynchronous execution.
        this.active.add(task.id);
        void this.execute(task);
      }
    } finally {
      this.draining = false;
    }
  }

  async execute({ id, request_key: requestKey }) {
    let completed = false;
    try {
      const status = await this.run(id);
      // Validation errors before the atomic running reservation are terminal too.
      await this.db.query(`UPDATE tasks SET execution_requested_at = NULL,
        status = CASE WHEN status = 'queued' THEN 'failed' ELSE status END,
        result_summary = CASE WHEN status = 'queued' THEN $2 ELSE result_summary END,
        updated_at = NOW() WHERE id = $1 AND execution_requested_at = $3::timestamptz`,
      [id, `No se pudo iniciar la tarea (HTTP ${status}). Revisar configuracion y reintentar.`, requestKey]);
      completed = true;
    } catch (error) {
      // A DB outage retains the persistent request. The next poll reconciles
      // finished running work; queued work can be retried without losing it.
      this.report(error);
    } finally {
      this.active.delete(id);
      if (completed) this.wake();
    }
  }
}

export const taskQueue = new TaskQueue();
