import test from "node:test";
import assert from "node:assert/strict";
import {
  isActiveLaunchJob,
  resolveRestoredLaunchJob,
  shouldPollLaunchJob,
} from "./launchJobState.js";

test("recargar durante una ejecucion recupera la etapa actual desde el job restaurado", () => {
  const storedJob = {
    jobId: "job-running",
    status: "running",
    currentStage: "Instalando backend",
    stages: [
      { name: "Instalando backend", status: "running" },
      { name: "Instalando frontend", status: "pending" },
    ],
  };

  const restored = resolveRestoredLaunchJob(storedJob, {
    jobId: "job-latest",
    status: "completed",
  });

  assert.equal(restored.jobId, "job-running");
  assert.equal(restored.currentStage, "Instalando backend");
  assert.equal(isActiveLaunchJob(restored), true);
  assert.equal(shouldPollLaunchJob(restored), true);
});

test("recargar despues de finalizar recupera el job completado y no reinicia polling", () => {
  const latestJob = {
    jobId: "job-completed",
    status: "completed",
    result: {
      frontendUrl: "http://localhost:5174",
      backendUrl: "http://localhost:3002",
      databaseName: "hola_mundo",
    },
  };

  const restored = resolveRestoredLaunchJob(null, latestJob);

  assert.equal(restored.jobId, "job-completed");
  assert.equal(isActiveLaunchJob(restored), false);
  assert.equal(shouldPollLaunchJob(restored), false);
});

test("recargar prioriza un job activo del backend sobre un job viejo guardado", () => {
  const storedJob = {
    jobId: "job-old-completed",
    status: "completed",
    updatedAt: "2026-10-05T10:00:00.000Z",
  };
  const latestJob = {
    jobId: "job-active-latest",
    status: "running",
    currentStage: "Instalando frontend",
    updatedAt: "2026-10-05T10:05:00.000Z",
  };

  const restored = resolveRestoredLaunchJob(storedJob, latestJob);

  assert.equal(restored.jobId, "job-active-latest");
  assert.equal(restored.currentStage, "Instalando frontend");
  assert.equal(shouldPollLaunchJob(restored), true);
});

test("el polling se detiene en failed y completed", () => {
  assert.equal(shouldPollLaunchJob({ jobId: "a", status: "failed" }), false);
  assert.equal(shouldPollLaunchJob({ jobId: "b", status: "completed" }), false);
  assert.equal(shouldPollLaunchJob({ jobId: "c", status: "pending" }), true);
  assert.equal(shouldPollLaunchJob({ jobId: "d", status: "running" }), true);
});
