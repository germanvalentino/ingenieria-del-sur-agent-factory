import { pool } from "../db.js";

export async function recoverInterruptedTasks() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tasksResult = await client.query(`
      UPDATE tasks
      SET status = 'failed',
          qa_status =
            CASE
              WHEN qa_status = 'running'
                THEN 'failed'
              ELSE qa_status
            END,
          result_summary =
            COALESCE(result_summary, '')
            || E'\\n\\nRECUPERACIÓN AUTOMÁTICA:\\n'
            || 'La ejecución fue interrumpida por un reinicio del backend.',
          auto_correction_active = FALSE,
          auto_correction_stage = NULL,
          execution_finished_at = NOW(),
          qa_finished_at =
            CASE
              WHEN qa_status = 'running'
                THEN NOW()
              ELSE qa_finished_at
            END,
          updated_at = NOW()
      WHERE status = 'running'
      RETURNING id, title
    `);

    const agentsResult = await client.query(`
      UPDATE agents
      SET status = 'idle',
          updated_at = NOW()
      WHERE status = 'working'
      RETURNING id, name
    `);

    const executionsResult = await client.query(`
      UPDATE task_executions
      SET status = 'failed',
          finished_at = NOW(),
          duration_ms =
            FLOOR(
              EXTRACT(
                EPOCH FROM (NOW() - started_at)
              ) * 1000
            )::BIGINT,
          error_message =
            'La ejecuciÃ³n fue interrumpida por un reinicio del backend.'
      WHERE status = 'running'
      RETURNING id, task_id
    `);

    await client.query("COMMIT");

    return {
      recoveredTasks: tasksResult.rows,
      recoveredAgents: agentsResult.rows,
      recoveredExecutions:
        executionsResult.rows,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
