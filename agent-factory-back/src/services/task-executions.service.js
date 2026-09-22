import { pool } from "../db.js";

function normalizeTokenValue(value) {
  return Number.isFinite(value) ? value : null;
}

function normalizeUsage(usage) {
  if (!usage) {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    };
  }

  const inputTokens = normalizeTokenValue(
    usage.inputTokens
  );
  const outputTokens = normalizeTokenValue(
    usage.outputTokens
  );
  const totalTokens = normalizeTokenValue(
    usage.totalTokens
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens:
      totalTokens ??
      (inputTokens !== null &&
      outputTokens !== null
        ? inputTokens + outputTokens
        : null),
  };
}

export async function startTaskExecution({
  taskId,
  agentId,
  executionType,
  provider,
  model = null,
}) {
  const result = await pool.query(
    `
      INSERT INTO task_executions (
        task_id,
        agent_id,
        execution_type,
        provider,
        model,
        status,
        started_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        'running',
        NOW()
      )
      RETURNING *
    `,
    [
      taskId,
      agentId,
      executionType,
      provider,
      model,
    ]
  );

  return result.rows[0];
}

export async function finishTaskExecution({
  executionId,
  status,
  usage = null,
  model = null,
  errorMessage = null,
}) {
  if (!executionId) {
    return null;
  }

  const normalizedUsage =
    normalizeUsage(usage);

  const result = await pool.query(
    `
      UPDATE task_executions
      SET status = $2,
          input_tokens = $3,
          output_tokens = $4,
          total_tokens = $5,
          model = COALESCE($6, model),
          error_message = $7,
          finished_at = NOW(),
          duration_ms =
            FLOOR(
              EXTRACT(
                EPOCH FROM (NOW() - started_at)
              ) * 1000
            )::BIGINT
      WHERE id = $1
      RETURNING *
    `,
    [
      executionId,
      status,
      normalizedUsage.inputTokens,
      normalizedUsage.outputTokens,
      normalizedUsage.totalTokens,
      model,
      errorMessage,
    ]
  );

  return result.rows[0] ?? null;
}

export async function getTaskExecutionsSummary(
  taskId
) {
  const [executionsResult, summaryResult] =
    await Promise.all([
      pool.query(
        `
          SELECT
            id,
            task_id,
            agent_id,
            execution_type,
            provider,
            model,
            status,
            input_tokens,
            output_tokens,
            total_tokens,
            started_at,
            finished_at,
            duration_ms,
            error_message,
            created_at
          FROM task_executions
          WHERE task_id = $1
          ORDER BY started_at DESC,
                   created_at DESC
        `,
        [taskId]
      ),
      pool.query(
        `
          SELECT
            COUNT(*)::INT AS total_executions,
            COALESCE(SUM(input_tokens), 0)::BIGINT
              AS total_input_tokens,
            COALESCE(SUM(output_tokens), 0)::BIGINT
              AS total_output_tokens,
            COALESCE(SUM(total_tokens), 0)::BIGINT
              AS total_tokens,
            COALESCE(SUM(duration_ms), 0)::BIGINT
              AS total_duration_ms
          FROM task_executions
          WHERE task_id = $1
        `,
        [taskId]
      ),
    ]);

  const summary = summaryResult.rows[0];

  return {
    executions: executionsResult.rows,
    summary: {
      totalExecutions:
        summary.total_executions,
      totalInputTokens: Number(
        summary.total_input_tokens
      ),
      totalOutputTokens: Number(
        summary.total_output_tokens
      ),
      totalTokens: Number(
        summary.total_tokens
      ),
      totalDurationMs: Number(
        summary.total_duration_ms
      ),
    },
  };
}
