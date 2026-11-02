import { taskQueue } from "../services/task-queue.service.js";
import { Router } from "express";
import { pool } from "../db.js";
import { isQaFallbackEligible } from "../services/qa-fallback-eligibility.js";
import { getDisplayModel } from "../services/agent-runner.service.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const [projectsResult, agentsResult, tasksResult, queueResult] = await Promise.all([
      pool.query(`
        SELECT *
        FROM projects
        WHERE active = TRUE
        ORDER BY created_at DESC
      `),

      pool.query(`
        SELECT *
        FROM agents
        WHERE active = TRUE
        ORDER BY
          CASE role
            WHEN 'frontend' THEN 1
            WHEN 'backend' THEN 2
            WHEN 'fullstack' THEN 3
            WHEN 'qa' THEN 4
          END
      `),

      pool.query(`
        SELECT
          t.*,
          p.name AS project_name,
          dev.provider AS latest_development_provider,
          last_qa.provider AS latest_qa_provider,
          last_qa.status AS latest_qa_status,
          last_qa.error_message AS latest_qa_error
        FROM tasks t
        INNER JOIN projects p ON p.id = t.project_id
        LEFT JOIN LATERAL (
          SELECT provider FROM task_executions
          WHERE task_id = t.id AND execution_type IN ('development', 'correction') AND status = 'passed'
          ORDER BY started_at DESC, id DESC LIMIT 1
        ) dev ON TRUE
        LEFT JOIN LATERAL (
          SELECT provider, status, error_message FROM task_executions
          WHERE task_id = t.id AND execution_type = 'qa'
          ORDER BY started_at DESC, id DESC LIMIT 1
        ) last_qa ON TRUE
        ORDER BY t.created_at DESC
        LIMIT 50
      `),
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'running' AND execution_requested_at IS NOT NULL)::int AS active,
        COUNT(*) FILTER (WHERE status = 'queued' AND execution_requested_at IS NOT NULL)::int AS pending
        FROM tasks`),
    ]);

    const tasks = tasksResult.rows.map(({ latest_development_provider, latest_qa_provider,
      latest_qa_status, latest_qa_error, ...task }) => ({
      ...task,
      qa_fallback_eligible: isQaFallbackEligible({
        task,
        developmentProvider: latest_development_provider,
        lastQa: latest_qa_provider ? {
          provider: latest_qa_provider, status: latest_qa_status, error_message: latest_qa_error,
        } : null,
      }),
    }));

    res.json({
      serverTime: new Date().toISOString(),
      projects: projectsResult.rows,
      agents: agentsResult.rows,
      tasks,
      providerConfig: {
        claude: {
          model: getDisplayModel("claude"),
        },
      },
      executionQueue: {
        active: queueResult.rows[0].active,
        pending: queueResult.rows[0].pending,
        limit: taskQueue.limit,
      },
      metrics: {
        totalTasks: tasks.length,
        queuedTasks: queueResult.rows[0].pending,
        runningTasks: queueResult.rows[0].active,
        passedTasks: tasks.filter(
          (task) => task.status === "passed"
        ).length,
        failedTasks: tasks.filter(
          (task) => task.status === "failed"
        ).length,
      },
    });
  } catch (error) {
    console.error("Error obteniendo dashboard:", error);

    res.status(500).json({
      status: "error",
      message: "No se pudo obtener el dashboard",
    });
  }
});

export default router;
