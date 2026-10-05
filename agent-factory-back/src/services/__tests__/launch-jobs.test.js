import test from "node:test";
import assert from "node:assert/strict";
import {
  createJob,
  onStageFactory,
  attachProjectToJob,
  updateJobStatus,
  completeJob,
  failJob,
  getJob,
  getLatestProjectJob,
  getLatestLaunchJob,
  getActiveJobForRequest,
} from "../launch-jobs.service.js";

const STAGES = [
  "Generando estructura",
  "Inicializando Git",
  "Creando base PostgreSQL",
  "Instalando backend",
  "Instalando frontend",
  "Aplicando migraciones",
  "Iniciando backend",
  "Iniciando frontend",
  "Comprobando servicios",
];

function createFakeDb() {
  const rows = new Map();
  const deletedProjectIds = new Set();

  return {
    deleteProject(projectId) {
      deletedProjectIds.add(projectId);
      for (const row of rows.values()) {
        if (row.project_id === projectId) {
          row.project_id = null;
        }
      }
    },

    async query(sql, params = []) {
      if (sql.includes("INSERT INTO project_launch_jobs")) {
        if (params[1] && deletedProjectIds.has(params[1])) {
          throw new Error("violates foreign key constraint");
        }

        const row = {
          id: params[0],
          project_id: params[1],
          requested_name: params[2],
          requested_project_path: params[3],
          status: params[4],
          current_stage: params[5],
          stages: JSON.parse(params[6]),
          result: params[7] ? JSON.parse(params[7]) : null,
          error: params[8] ? JSON.parse(params[8]) : null,
          started_at: params[9],
          finished_at: params[10],
          updated_at: new Date(),
        };
        rows.set(row.id, row);
        return { rows: [row] };
      }

      if (sql.includes("WHERE id = $1")) {
        return { rows: rows.has(params[0]) ? [rows.get(params[0])] : [] };
      }

      if (sql.includes("WHERE project_id = $1")) {
        return {
          rows: [...rows.values()]
            .filter((row) => row.project_id === params[0])
            .sort((a, b) => b.updated_at - a.updated_at)
            .slice(0, 1),
        };
      }

      if (sql.includes("requested_name = $1")) {
        return {
          rows: [...rows.values()]
            .filter(
              (row) =>
                ["pending", "running"].includes(row.status) &&
                row.requested_name === params[0] &&
                row.requested_project_path === params[1]
            )
            .sort((a, b) => b.updated_at - a.updated_at)
            .slice(0, 1),
        };
      }

      if (sql.includes("ORDER BY updated_at DESC")) {
        return {
          rows: [...rows.values()]
            .sort((a, b) => b.updated_at - a.updated_at)
            .slice(0, 1),
        };
      }

      throw new Error(`SQL no contemplado en fakeDb: ${sql}`);
    },
  };
}

test("el job avanza por todas las etapas y npm install backend queda completed", async () => {
  const db = createFakeDb();
  const jobId = await createJob(STAGES, {
    requestedName: "Hola Mundo",
    requestedProjectPath: "C:/tmp/hola",
    db,
  });
  const onStage = onStageFactory(jobId, { db });

  await updateJobStatus(jobId, "running", { db });

  for (const stage of STAGES) {
    await onStage(stage, "running");
    await onStage(stage, "completed");
  }

  await attachProjectToJob(jobId, "project-1", { db });
  await completeJob(
    jobId,
    {
      project: { id: "project-1", name: "Hola Mundo" },
      frontendUrl: "http://localhost:5174",
      backendUrl: "http://localhost:3002",
      frontendPort: 5174,
      backendPort: 3002,
      databaseName: "hola_mundo",
      dependenciesInstalled: true,
      migrationsApplied: true,
    },
    { db }
  );

  const job = await getJob(jobId, { db });
  const backendInstall = job.stages.find(
    (stage) => stage.name === "Instalando backend"
  );

  assert.equal(job.status, "completed");
  assert.equal(job.projectId, "project-1");
  assert.equal(backendInstall.status, "completed");
  assert.equal(job.result.databaseName, "hola_mundo");
  assert.deepEqual(job.result.ports, { frontend: 5174, backend: 3002 });
  assert.equal(job.result.backendUrl, "http://localhost:3002");
  assert.equal(job.result.frontendUrl, "http://localhost:5174");
});

test("un error marca exactamente la etapa failed y no expone secretos", async () => {
  const db = createFakeDb();
  const jobId = await createJob(STAGES, {
    requestedName: "Falla",
    requestedProjectPath: "C:/tmp/falla",
    db,
  });
  const onStage = onStageFactory(jobId, { db });

  await updateJobStatus(jobId, "running", { db });
  await onStage("Instalando backend", "running");
  await onStage(
    "Instalando backend",
    "failed",
    "npm ERR password=super-secret DATABASE_URL=postgres://user:secret@localhost/db"
  );
  await failJob(
    jobId,
    new Error(
      "Falló npm install con password=super-secret y postgres://user:secret@localhost/db"
    ),
    { db }
  );

  const job = await getJob(jobId, { db });
  const failedStages = job.stages.filter((stage) => stage.status === "failed");

  assert.equal(job.status, "failed");
  assert.equal(failedStages.length, 1);
  assert.equal(failedStages[0].name, "Instalando backend");
  assert.doesNotMatch(failedStages[0].message, /super-secret|user:secret/);
  assert.doesNotMatch(job.error.message, /super-secret|user:secret/);
  assert.match(job.error.message, /\[REDACTED\]/);
});

test("un fallo despues del rollback del proyecto persiste failed sin reusar el projectId borrado", async () => {
  const db = createFakeDb();
  const jobId = await createJob(STAGES, {
    requestedName: "Rollback",
    requestedProjectPath: "C:/tmp/rollback",
    db,
  });
  const onStage = onStageFactory(jobId, { db });

  await updateJobStatus(jobId, "running", { db });
  await attachProjectToJob(jobId, "project-rollback", { db });
  await onStage("Instalando frontend", "running");
  await onStage("Instalando frontend", "failed", "npm install fallo");

  db.deleteProject("project-rollback");

  await failJob(jobId, new Error("Fallo despues de rollback"), { db });

  const job = await getJob(jobId, { db });
  const failedStages = job.stages.filter((stage) => stage.status === "failed");

  assert.equal(job.status, "failed");
  assert.equal(job.projectId, null);
  assert.equal(failedStages.length, 1);
  assert.equal(failedStages[0].name, "Instalando frontend");
  assert.equal(job.error.message, "Fallo despues de rollback");
});

test("consultar jobs finalizados y por proyecto conserva el resultado completed", async () => {
  const db = createFakeDb();
  const jobId = await createJob(STAGES, {
    requestedName: "Finalizado",
    requestedProjectPath: "C:/tmp/finalizado",
    db,
  });

  await completeJob(
    jobId,
    {
      project: { id: "project-final", name: "Finalizado" },
      frontendUrl: "http://localhost:5174",
      backendUrl: "http://localhost:3002",
      databaseName: "finalizado",
    },
    { db }
  );

  const byId = await getJob(jobId, { db });
  const byProject = await getLatestProjectJob("project-final", { db });
  const latest = await getLatestLaunchJob({ db });

  assert.equal(byId.status, "completed");
  assert.equal(byProject.jobId, jobId);
  assert.equal(latest.jobId, jobId);
});

test("no devuelve jobs duplicados como activos cuando ya terminaron", async () => {
  const db = createFakeDb();
  const request = {
    requestedName: "Duplicado",
    requestedProjectPath: "C:/tmp/duplicado",
  };
  const jobId = await createJob(STAGES, { ...request, db });

  assert.equal((await getActiveJobForRequest(request, { db })).jobId, jobId);

  await completeJob(
    jobId,
    {
      project: { id: "project-duplicado", name: "Duplicado" },
      databaseName: "duplicado",
    },
    { db }
  );

  assert.equal(await getActiveJobForRequest(request, { db }), null);
});
