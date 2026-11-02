import { Router } from "express";
import { createRequire } from "node:module";
import { taskQueue } from "../services/task-queue.service.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json");
const router = Router();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Ingeniería del Sur Agent Factory",
    timestamp: new Date().toISOString(),
    version,
  });
});

router.get("/queue", async (req, res) => {
  try {
    res.json(await taskQueue.getStatus());
  } catch {
    res.status(500).json({ status: "error", message: "No se pudo consultar la cola de ejecucion" });
  }
});

export default router;
