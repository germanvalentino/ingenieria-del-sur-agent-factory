import crypto from "node:crypto";
import { redactSecrets } from "./secret-redaction.service.js";

const STAGE_STATUSES = new Set(["pending", "running", "completed", "failed"]);
const JOB_STATUSES = new Set(["pending", "running", "completed", "failed"]);
const memoryJobs = new Map();

async function resolveDb(db) {
  if (db) {
    return db;
  }

  const module = await import("../db.js");
  return module.pool;
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeMessage(message) {
  if (!message) {
    return null;
  }

  return redactSecrets(String(message));
}

function sanitizeValue(value) {
  if (typeof value === "string") {
    return sanitizeMessage(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)])
    );
  }

  return value;
}

function buildStages(stageNames) {
  return stageNames.map((stageName) => ({
    name: stageName,
    status: "pending",
    message: null,
    startedAt: null,
    finishedAt: null,
  }));
}

function sanitizeResult(result = null) {
  if (!result) {
    return null;
  }

  return {
    projectId: result.project?.id || result.projectId || null,
    project: result.project
      ? {
          id: result.project.id,
          name: result.project.name,
          description: result.project.description,
          frontend_path: result.project.frontend_path,
          backend_path: result.project.backend_path,
          repository_url: sanitizeMessage(result.project.repository_url),
          default_branch: result.project.default_branch,
          active: result.project.active,
        }
      : null,
    frontendUrl: result.frontendUrl || null,
    backendUrl: result.backendUrl || null,
    databaseName: result.databaseName || result.dbName || null,
    frontendPort: result.frontendPort || null,
    backendPort: result.backendPort || null,
    ports: {
      frontend: result.frontendPort || null,
      backend: result.backendPort || null,
    },
    dependenciesInstalled: result.dependenciesInstalled === true,
    migrationsApplied: result.migrationsApplied === true,
  };
}

function sanitizeError(error = null) {
  if (!error) {
    return null;
  }

  return {
    message: sanitizeMessage(error.message),
    details: sanitizeValue(error.details || null),
    cleanupWarning: sanitizeMessage(error.cleanupWarning),
  };
}

function normalizeRow(row) {
  if (!row) {
    return null;
  }

  const result = row.result || null;

  return {
    id: row.id,
    jobId: row.id,
    projectId: row.project_id || result?.projectId || result?.project?.id || null,
    status: row.status,
    currentStage: row.current_stage,
    stages: row.stages || [],
    result,
    error: row.error || null,
    startedAt:
      row.started_at instanceof Date
        ? row.started_at.toISOString()
        : row.started_at,
    finishedAt:
      row.finished_at instanceof Date
        ? row.finished_at.toISOString()
        : row.finished_at,
    createdAt:
      row.started_at instanceof Date
        ? row.started_at.getTime()
        : Date.parse(row.started_at),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
  };
}

async function saveJob(job, db) {
  const resolvedDb = await resolveDb(db);

  await resolvedDb.query(
    `
      INSERT INTO project_launch_jobs (
        id,
        project_id,
        requested_name,
        requested_project_path,
        status,
        current_stage,
        stages,
        result,
        error,
        started_at,
        finished_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        project_id = EXCLUDED.project_id,
        status = EXCLUDED.status,
        current_stage = EXCLUDED.current_stage,
        stages = EXCLUDED.stages,
        result = EXCLUDED.result,
        error = EXCLUDED.error,
        finished_at = EXCLUDED.finished_at,
        updated_at = NOW()
    `,
    [
      job.id,
      job.projectId,
      job.requestedName,
      job.requestedProjectPath,
      job.status,
      job.currentStage,
      JSON.stringify(job.stages),
      job.result ? JSON.stringify(job.result) : null,
      job.error ? JSON.stringify(job.error) : null,
      new Date(job.startedAt),
      job.finishedAt ? new Date(job.finishedAt) : null,
    ]
  );
}

export async function createJob(
  stageNames,
  { requestedName = null, requestedProjectPath = null, db = null } = {}
) {
  const id = crypto.randomUUID();
  const job = {
    id,
    projectId: null,
    requestedName,
    requestedProjectPath,
    status: "pending",
    currentStage: null,
    stages: buildStages(stageNames),
    result: null,
    error: null,
    startedAt: nowIso(),
    finishedAt: null,
  };

  memoryJobs.set(id, job);
  await saveJob(job, db);

  return id;
}

export function onStageFactory(jobId, { db = null } = {}) {
  return async (stageName, status, message = null) => {
    if (!STAGE_STATUSES.has(status)) {
      throw new Error(`Estado de etapa invÃ¡lido: ${status}`);
    }

    const job = memoryJobs.get(jobId) || (await getJob(jobId, { db, raw: true }));

    if (!job) {
      return;
    }

    const stages = job.stages.map((stage) => {
      if (stage.name !== stageName) {
        return stage;
      }

      return {
        ...stage,
        status,
        message: sanitizeMessage(message),
        startedAt:
          status === "running" && !stage.startedAt ? nowIso() : stage.startedAt,
        finishedAt:
          status === "completed" || status === "failed" ? nowIso() : stage.finishedAt,
      };
    });

    const nextJob = {
      ...job,
      status: job.status === "pending" ? "running" : job.status,
      currentStage: stageName,
      stages,
    };

    memoryJobs.set(jobId, nextJob);
    await saveJob(nextJob, db);
  };
}

export async function attachProjectToJob(jobId, projectId, { db = null } = {}) {
  const job = memoryJobs.get(jobId) || (await getJob(jobId, { db, raw: true }));

  if (!job) {
    return;
  }

  const nextJob = { ...job, projectId };
  memoryJobs.set(jobId, nextJob);
  await saveJob(nextJob, db);
}

export async function updateJobStatus(jobId, status, { db = null } = {}) {
  if (!JOB_STATUSES.has(status)) {
    throw new Error(`Estado de job invÃ¡lido: ${status}`);
  }

  const job = memoryJobs.get(jobId) || (await getJob(jobId, { db, raw: true }));

  if (!job) {
    return;
  }

  const nextJob = {
    ...job,
    status,
    finishedAt: ["completed", "failed"].includes(status) ? nowIso() : job.finishedAt,
  };

  memoryJobs.set(jobId, nextJob);
  await saveJob(nextJob, db);
}

export async function completeJob(jobId, result, { db = null } = {}) {
  const job = memoryJobs.get(jobId) || (await getJob(jobId, { db, raw: true }));

  if (!job) {
    return;
  }

  const sanitizedResult = sanitizeResult(result);
  const nextJob = {
    ...job,
    projectId: sanitizedResult?.projectId || job.projectId,
    status: "completed",
    result: sanitizedResult,
    error: null,
    finishedAt: nowIso(),
  };

  memoryJobs.set(jobId, nextJob);
  await saveJob(nextJob, db);
}

export async function failJob(jobId, error, { db = null } = {}) {
  const job = await getJob(jobId, { db, raw: true });

  if (!job) {
    return;
  }

  const nextJob = {
    ...job,
    status: "failed",
    error: sanitizeError(error),
    finishedAt: nowIso(),
  };

  memoryJobs.set(jobId, nextJob);
  await saveJob(nextJob, db);
}

export async function getJob(jobId, { db = null, raw = false } = {}) {
  const resolvedDb = await resolveDb(db);
  const result = await resolvedDb.query(
    `
      SELECT *
      FROM project_launch_jobs
      WHERE id = $1
    `,
    [jobId]
  );
  const row = result.rows[0] || null;

  if (!row) {
    return null;
  }

  const normalized = normalizeRow(row);

  if (raw) {
    return {
      id: normalized.id,
      projectId: row.project_id || null,
      requestedName: row.requested_name,
      requestedProjectPath: row.requested_project_path,
      status: normalized.status,
      currentStage: normalized.currentStage,
      stages: normalized.stages,
      result: normalized.result,
      error: normalized.error,
      startedAt: normalized.startedAt,
      finishedAt: normalized.finishedAt,
    };
  }

  return normalized;
}

export async function getLatestProjectJob(projectId, { db = null } = {}) {
  const resolvedDb = await resolveDb(db);
  const result = await resolvedDb.query(
    `
      SELECT *
      FROM project_launch_jobs
      WHERE project_id = $1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [projectId]
  );

  return normalizeRow(result.rows[0] || null);
}

export async function getLatestLaunchJob({ db = null } = {}) {
  const resolvedDb = await resolveDb(db);
  const result = await resolvedDb.query(
    `
      SELECT *
      FROM project_launch_jobs
      ORDER BY updated_at DESC
      LIMIT 1
    `
  );

  return normalizeRow(result.rows[0] || null);
}

export async function getActiveJobForRequest(
  { requestedName, requestedProjectPath },
  { db = null } = {}
) {
  const resolvedDb = await resolveDb(db);
  const result = await resolvedDb.query(
    `
      SELECT *
      FROM project_launch_jobs
      WHERE status IN ('pending', 'running')
        AND requested_name = $1
        AND requested_project_path = $2
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [requestedName, requestedProjectPath]
  );

  return normalizeRow(result.rows[0] || null);
}
