import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createRequire } from "node:module";
import healthRoutes from "../../routes/health.routes.js";
import { taskQueue } from "../task-queue.service.js";

const require = createRequire(import.meta.url);
const { version } = require("../../../package.json");

test("GET /api/health/queue devuelve el estado actual y se recupera de fallos sin exponer detalles", async (t) => {
  let state = { active: 2, pending: 70, limit: 3 };
  let failure = false;
  t.mock.method(taskQueue, "getStatus", async () => {
    if (failure) throw new Error("private database details");
    return state;
  });
  const app = express();
  app.use("/api/health", healthRoutes);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const url = `http://127.0.0.1:${server.address().port}/api/health/queue`;
  for (const next of [state, { active: 0, pending: 0, limit: 3 }]) {
    state = next;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await response.json(), state);
  }
  failure = true;
  const failed = await fetch(url);
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {
    status: "error", message: "No se pudo consultar la cola de ejecucion",
  });
  failure = false;
  const recovered = await fetch(url);
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), state);
});

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
