import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import tasksRoutes from "./routes/tasks.routes.js";
import { recoverInterruptedTasks } from "./services/recovery.service.js";
import projectsRoutes from "./routes/projects.routes.js";
import specificationsRoutes from "./routes/specifications.routes.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import https from "node:https";
import fs from "node:fs";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/api/dashboard", dashboardRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/projects", projectsRoutes);
app.use("/api/specifications", specificationsRoutes);
app.use("/api/whatsapp", whatsappRoutes);

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

    // HTTPS adicional y opcional para Meta/WhatsApp.
    // No cambia el puerto HTTP existente usado por el frontend.
    const httpsPort = Number(process.env.WHATSAPP_HTTPS_PORT || 0);
    const sslCert = process.env.WHATSAPP_SSL_CERT;
    const sslKey = process.env.WHATSAPP_SSL_KEY;

    if (httpsPort && sslCert && sslKey) {
      https
        .createServer(
          {
            cert: fs.readFileSync(sslCert),
            key: fs.readFileSync(sslKey),
          },
          app
        )
        .listen(httpsPort, () => {
          console.log(
            `WhatsApp HTTPS disponible en puerto ${httpsPort}`
          );
        });
    }
  } catch (error) {
    console.error(
      "No se pudo iniciar Agent Factory:",
      error
    );

    process.exit(1);
  }
}

startServer();