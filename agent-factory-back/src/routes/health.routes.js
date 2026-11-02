import { Router } from "express";
import { createRequire } from "node:module";

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

export default router;
