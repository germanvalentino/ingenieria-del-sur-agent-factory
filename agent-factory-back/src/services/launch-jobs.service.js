import crypto from "node:crypto";

const JOB_TTL_MS = 30 * 60 * 1000;
const jobs = new Map();

export function createJob(stageNames) {
  const id = crypto.randomUUID();

  jobs.set(id, {
    id,
    status: "running",
    stages: stageNames.map((stageName) => ({
      name: stageName,
      status: "pending",
      message: null,
    })),
    result: null,
    error: null,
    createdAt: Date.now(),
  });

  return id;
}

export function onStageFactory(jobId) {
  return (stageName, status, message = null) => {
    const job = jobs.get(jobId);

    if (!job) {
      return;
    }

    const stage = job.stages.find((item) => item.name === stageName);

    if (stage) {
      stage.status = status;
      stage.message = message;
    }
  };
}

export function completeJob(jobId, result) {
  const job = jobs.get(jobId);

  if (!job) {
    return;
  }

  job.status = "completed";
  job.result = result;
}

export function failJob(jobId, error) {
  const job = jobs.get(jobId);

  if (!job) {
    return;
  }

  job.status = "failed";
  job.error = {
    message: error.message,
    details: error.details || null,
    cleanupWarning: error.cleanupWarning || null,
  };
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

setInterval(() => {
  const now = Date.now();

  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();
