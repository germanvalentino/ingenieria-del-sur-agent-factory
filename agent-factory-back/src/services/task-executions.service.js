import { pool } from "../db.js";

function normalizeTokenValue(value) {
  return Number.isFinite(value) ? value : null;
}

function normalizeUsage(usage) {
  if (!usage) {
    return {
      inputTokens: null,
      cachedInputTokens: null,
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
  const cachedInputTokens = normalizeTokenValue(
    usage.cachedInputTokens
  );
  const cacheCreationInputTokens =
    normalizeTokenValue(
      usage.cacheCreationInputTokens
    );
  const totalTokens = normalizeTokenValue(
    usage.totalTokens
  );

  return {
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
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
  costUsd = null,
  durationMs = null,
  modelUsage = null,
  permissionDenials = null,
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
          cached_input_tokens = $4,
          output_tokens = $5,
          total_tokens = $6,
          model = COALESCE($7, model),
          error_message = $8,
          cost_usd = $9,
          cache_creation_input_tokens = $10,
          model_usage = $11,
          permission_denials = $12,
          finished_at = NOW(),
          duration_ms =
            COALESCE(
              $13,
              FLOOR(
                EXTRACT(
                  EPOCH FROM (NOW() - started_at)
                ) * 1000
              )::BIGINT
            )
      WHERE id = $1
      RETURNING *
    `,
    [
      executionId,
      status,
      normalizedUsage.inputTokens,
      normalizedUsage.cachedInputTokens,
      normalizedUsage.outputTokens,
      normalizedUsage.totalTokens,
      model,
      errorMessage,
      costUsd,
      normalizedUsage.cacheCreationInputTokens,
      modelUsage
        ? JSON.stringify(modelUsage)
        : null,
      permissionDenials
        ? JSON.stringify(permissionDenials)
        : null,
      durationMs,
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
            cached_input_tokens,
            cache_creation_input_tokens,
            output_tokens,
            total_tokens,
            cost_usd,
            model_usage,
            permission_denials,
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
            COALESCE(SUM(cached_input_tokens), 0)::BIGINT
              AS total_cached_input_tokens,
            COALESCE(SUM(cache_creation_input_tokens), 0)::BIGINT
              AS total_cache_creation_input_tokens,
            COALESCE(
              SUM(
                CASE
                  WHEN input_tokens IS NOT NULL
                    AND cached_input_tokens IS NOT NULL
                    THEN GREATEST(
                      input_tokens - cached_input_tokens,
                      0
                    )
                  ELSE NULL
                END
              ),
              0
            )::BIGINT
              AS total_non_cached_input_tokens,
            COALESCE(SUM(output_tokens), 0)::BIGINT
              AS total_output_tokens,
            COALESCE(SUM(total_tokens), 0)::BIGINT
              AS total_tokens,
            CASE
              WHEN COUNT(cost_usd) > 0
                THEN SUM(cost_usd)::NUMERIC
              ELSE NULL
            END AS total_cost_usd,
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
      totalCachedInputTokens: Number(
        summary.total_cached_input_tokens
      ),
      totalCacheCreationInputTokens: Number(
        summary.total_cache_creation_input_tokens
      ),
      totalNonCachedInputTokens: Number(
        summary.total_non_cached_input_tokens
      ),
      totalOutputTokens: Number(
        summary.total_output_tokens
      ),
      totalTokens: Number(
        summary.total_tokens
      ),
      totalCostUsd:
        summary.total_cost_usd === null
          ? null
          : Number(summary.total_cost_usd),
      totalDurationMs: Number(
        summary.total_duration_ms
      ),
    },
  };
}
