import { isActiveLaunchJob } from "./launchJobState.js";

function isAbortError(error) {
  return error?.name === "AbortError";
}

export function createLaunchJobPoller({
  jobId,
  fetchLaunchJob,
  isMounted,
  onJob,
  onFinished,
  onError,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  initialDelayMs = 0,
  intervalMs = 1200,
}) {
  let cancelled = false;
  let timeoutId = null;
  let activeController = null;

  async function pollLaunchJob() {
    if (cancelled || !isMounted()) {
      return;
    }

    activeController = new AbortController();
    const signal = activeController.signal;

    try {
      const data = await fetchLaunchJob(jobId, { signal });

      if (cancelled || !isMounted() || signal.aborted) {
        return;
      }

      await onJob(data, signal);

      if (cancelled || !isMounted() || signal.aborted) {
        return;
      }

      if (!isActiveLaunchJob(data)) {
        await onFinished(data, signal);
        return;
      }
    } catch (pollError) {
      if (isAbortError(pollError) || cancelled || !isMounted()) {
        return;
      }

      await onError(pollError);
      return;
    } finally {
      activeController = null;
    }

    if (cancelled || !isMounted()) {
      return;
    }

    timeoutId = setTimer(pollLaunchJob, intervalMs);
  }

  timeoutId = setTimer(pollLaunchJob, initialDelayMs);

  return {
    stop() {
      cancelled = true;

      if (timeoutId) {
        clearTimer(timeoutId);
      }

      activeController?.abort();
    },
  };
}
