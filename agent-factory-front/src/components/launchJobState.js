export const LAUNCH_JOB_STORAGE_KEY = "agentFactory:lastLaunchJobId";

export function isActiveLaunchJob(job) {
  return job?.status === "pending" || job?.status === "running";
}

export function shouldPollLaunchJob(job) {
  return Boolean(job?.jobId && isActiveLaunchJob(job));
}

function jobTimestamp(job) {
  return Date.parse(job?.updatedAt || job?.startedAt || job?.finishedAt || 0) || 0;
}

export function resolveRestoredLaunchJob(storedJob, latestJob) {
  const activeJobs = [storedJob, latestJob].filter(isActiveLaunchJob);

  if (activeJobs.length > 0) {
    return activeJobs.sort((a, b) => jobTimestamp(b) - jobTimestamp(a))[0];
  }

  return latestJob || storedJob || null;
}

export async function resolveConflictingLaunchJob(data, fetchLaunchJob, signal) {
  if (data.job) {
    return data.job;
  }

  return fetchLaunchJob(data.jobId, { signal });
}
