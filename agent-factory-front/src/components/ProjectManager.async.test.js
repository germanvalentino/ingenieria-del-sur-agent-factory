import test from "node:test";
import assert from "node:assert/strict";
import { createLaunchJobPoller } from "./launchJobPolling.js";
import { resolveConflictingLaunchJob } from "./launchJobState.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createTimers() {
  let nextId = 1;
  const timers = [];

  return {
    timers,
    setTimer(fn, delay) {
      const timer = {
        id: nextId,
        fn,
        delay,
        cleared: false,
      };

      nextId += 1;
      timers.push(timer);
      return timer.id;
    },
    clearTimer(id) {
      const timer = timers.find((candidate) => candidate.id === id);

      if (timer) {
        timer.cleared = true;
      }
    },
    nextTimer() {
      while (timers.length > 0) {
        const timer = timers.shift();

        if (!timer.cleared) {
          return timer;
        }
      }

      return null;
    },
  };
}

test("el polling avanza con el estado real y se detiene en completed", async () => {
  const timers = createTimers();
  const updates = [];
  const finished = [];
  const signals = [];
  const jobs = [
    { jobId: "job-1", status: "running" },
    { jobId: "job-1", status: "completed" },
  ];

  createLaunchJobPoller({
    jobId: "job-1",
    fetchLaunchJob: async (jobId, { signal }) => {
      signals.push({ jobId, signal });
      return jobs.shift();
    },
    isMounted: () => true,
    onJob: async (job) => {
      updates.push(job.status);
    },
    onFinished: async (job) => {
      finished.push(job.status);
    },
    onError: async (error) => {
      throw error;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const firstTimer = timers.nextTimer();
  assert.equal(firstTimer.delay, 0);
  await firstTimer.fn();

  assert.deepEqual(updates, ["running"]);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].jobId, "job-1");
  assert.equal(signals[0].signal.aborted, false);

  const secondTimer = timers.nextTimer();
  assert.equal(secondTimer.delay, 1200);
  await secondTimer.fn();

  assert.deepEqual(updates, ["running", "completed"]);
  assert.deepEqual(finished, ["completed"]);
  assert.equal(timers.nextTimer(), null);
});

test("el polling no agenda otra consulta mientras una sigue pendiente", async () => {
  const timers = createTimers();
  const pendingRequest = createDeferred();
  let fetchCount = 0;

  createLaunchJobPoller({
    jobId: "job-1",
    fetchLaunchJob: async () => {
      fetchCount += 1;
      return pendingRequest.promise;
    },
    isMounted: () => true,
    onJob: async () => {},
    onFinished: async () => {},
    onError: async (error) => {
      throw error;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const firstTimer = timers.nextTimer();
  const firstPoll = firstTimer.fn();

  assert.equal(fetchCount, 1);
  assert.equal(timers.nextTimer(), null);

  pendingRequest.resolve({ jobId: "job-1", status: "running" });
  await firstPoll;

  assert.equal(fetchCount, 1);
  assert.equal(timers.nextTimer().delay, 1200);
});

test("detener el polling aborta la consulta en curso y evita updates tardios", async () => {
  const timers = createTimers();
  const pendingRequest = createDeferred();
  const updates = [];
  let requestSignal = null;

  const poller = createLaunchJobPoller({
    jobId: "job-1",
    fetchLaunchJob: async (_jobId, { signal }) => {
      requestSignal = signal;
      return pendingRequest.promise;
    },
    isMounted: () => true,
    onJob: async (job) => {
      updates.push(job.status);
    },
    onFinished: async () => {},
    onError: async (error) => {
      throw error;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const firstPoll = timers.nextTimer().fn();
  assert.equal(requestSignal.aborted, false);

  poller.stop();
  assert.equal(requestSignal.aborted, true);

  pendingRequest.resolve({ jobId: "job-1", status: "running" });
  await firstPoll;

  assert.deepEqual(updates, []);
  assert.equal(timers.nextTimer(), null);
});

test("AbortError no se muestra como error de UI ni reprograma polling", async () => {
  const timers = createTimers();
  const errors = [];
  const abortError = Object.assign(new Error("aborted"), {
    name: "AbortError",
  });

  createLaunchJobPoller({
    jobId: "job-1",
    fetchLaunchJob: async () => {
      throw abortError;
    },
    isMounted: () => true,
    onJob: async () => {},
    onFinished: async () => {},
    onError: async (error) => {
      errors.push(error.message);
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  await timers.nextTimer().fn();

  assert.deepEqual(errors, []);
  assert.equal(timers.nextTimer(), null);
});

test("la recuperacion del job en conflicto pasa AbortSignal a la consulta", async () => {
  const controller = new AbortController();
  const calls = [];
  const existingJob = await resolveConflictingLaunchJob(
    { mode: "job", jobId: "job-conflict" },
    async (jobId, options) => {
      calls.push({ jobId, signal: options.signal });
      return { jobId, status: "running" };
    },
    controller.signal,
  );

  assert.equal(existingJob.jobId, "job-conflict");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].jobId, "job-conflict");
  assert.equal(calls[0].signal, controller.signal);
});

test("la recuperacion del job en conflicto reutiliza el job incluido sin otra consulta", async () => {
  const controller = new AbortController();
  const includedJob = { jobId: "job-in-response", status: "running" };
  const existingJob = await resolveConflictingLaunchJob(
    { mode: "job", job: includedJob },
    async () => {
      throw new Error("fetchLaunchJob no debe ejecutarse");
    },
    controller.signal,
  );

  assert.equal(existingJob, includedJob);
});
