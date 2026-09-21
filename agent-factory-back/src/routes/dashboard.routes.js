import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const [projectsResult, agentsResult, tasksResult] = await Promise.all([
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
            WHEN 'qa' THEN 3
          END
      `),

      pool.query(`
        SELECT
          t.*,
          p.name AS project_name
        FROM tasks t
        INNER JOIN projects p ON p.id = t.project_id
        ORDER BY t.created_at DESC
        LIMIT 50
      `),
    ]);

    const tasks = tasksResult.rows;

    res.json({
      projects: projectsResult.rows,
      agents: agentsResult.rows,
      tasks,
      metrics: {
        totalTasks: tasks.length,
        queuedTasks: tasks.filter(
          (task) => task.status === "queued"
        ).length,
        runningTasks: tasks.filter(
          (task) => task.status === "running"
        ).length,
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