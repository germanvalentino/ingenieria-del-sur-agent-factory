import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createRequire } from "node:module";
import healthRoutes from "../../routes/health.routes.js";

const require = createRequire(import.meta.url);
const { version } = require("../../../package.json");

test("GET /api/health conserva los campos actuales y agrega la version del package.json", async (t) => {
  const app = express();
  app.use("/api/health", healthRoutes);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    status: "ok",
    service: "Ingeniería del Sur Agent Factory",
    timestamp: body.timestamp,
    version,
  });
  assert.equal(new Date(body.timestamp).toISOString(), body.timestamp);
});
