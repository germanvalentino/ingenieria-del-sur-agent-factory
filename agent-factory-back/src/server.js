import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import tasksRoutes from "./routes/tasks.routes.js";
import { recoverInterruptedTasks } from "./services/recovery.service.js";
import projectsRoutes from "./routes/projects.routes.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use("/api/dashboard", dashboardRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/projects", projectsRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Ingeniería del Sur Agent Factory",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/db-health", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        current_user AS user,
        version() AS version,
        NOW() AS timestamp
    `);

    res.json({
      status: "ok",
      ...result.rows[0],
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

async function startServer() {
  try {
    const recovery =
      await recoverInterruptedTasks();

    if (
      recovery.recoveredTasks.length > 0
    ) {
      console.log(
        "Tareas interrumpidas recuperadas:",
        recovery.recoveredTasks
      );
    }

    if (
      recovery.recoveredAgents.length > 0
    ) {
      console.log(
        "Agentes restablecidos:",
        recovery.recoveredAgents
      );
    }

    app.listen(PORT, () => {
      console.log(
        `Agent Factory API ejecutándose en http://localhost:${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "No se pudo iniciar Agent Factory:",
      error
    );

    process.exit(1);
  }
}

startServer();