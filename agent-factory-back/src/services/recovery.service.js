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

    await client.query("COMMIT");

    return {
      recoveredTasks: tasksResult.rows,
      recoveredAgents: agentsResult.rows,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}