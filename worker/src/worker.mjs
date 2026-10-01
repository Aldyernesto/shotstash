// The worker loop: register, claim, process, report, repeat. It never exits
// on its own: 401, 503 and network errors wait 30 s and try again, so the
// worker rides out app restarts and first-run setup.
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKOFF_SECONDS, ContractError, classify, sleep, waitSeconds } from './backoff.mjs';

/** A job error that another attempt cannot fix (bad input). */
export class PermanentJobError extends Error {}

/** Thrown inside a job when the server says it is no longer ours (cancelled, requeued). */
class JobLost extends Error {}

const isLost = (err) => err instanceof ContractError && err.status === 409 && (err.code === 'JOB_TERMINAL' || err.code === 'CLAIM_STALE');

/**
 * @param {object} opts
 * @param {import('./client.mjs').ContractClient} opts.client
 * @param {(job: object, ctx: { dir: string, input: string, signal: AbortSignal, progress: (pct: number) => void }) => Promise<{ path: string, mimeType: string, ext: string }>} opts.process
 * @param {ReturnType<import('./log.mjs').createLogger>} opts.log
 * @param {number} [opts.pollSeconds] idle wait between empty claims
 * @param {number} [opts.backoffSeconds]
 * @param {string} opts.tmpDir
 */
export function createWorker({ client, process: processJob, log, pollSeconds = 5, backoffSeconds = BACKOFF_SECONDS, tmpDir }) {
  const stop = new AbortController();
  const state = { phase: 'starting', jobId: null, jobs: 0, lastError: null };
  let current = null; // { job, abort: AbortController }
  let heartbeatTimer = null;
  let loopDone = null;

  async function sendHeartbeat() {
    if (!client.registered) return;
    try {
      const lost = await client.heartbeat(current ? [current.job.id] : []);
      if (current && lost.includes(current.job.id)) {
        log.warn('job lost (cancelled or requeued): stopping it', { jobId: current.job.id });
        current.abort.abort(new JobLost('lost'));
      }
    } catch (err) {
      if (err instanceof ContractError && err.status === 401) client.forgetToken();
      log.warn('heartbeat failed', { status: err.status ?? null, code: err.code ?? null, err });
    }
  }

  function startHeartbeats() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => void sendHeartbeat(), client.heartbeatSeconds * 1000);
    heartbeatTimer.unref?.();
  }

  async function runJob(job) {
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, stop.signal]);
    current = { job, abort };
    state.phase = 'working';
    state.jobId = job.id;
    log.info('job claimed', { jobId: job.id, kind: job.kind, attempt: job.attempt, size: job.input?.size });
    const dir = await mkdtemp(join(tmpDir, 'shotstash-job-'));
    let lastSent = -1;
    let lastAt = 0;
    let reporting = Promise.resolve();
    const progress = (pct) => {
      const now = Date.now();
      if (pct === lastSent || (pct < 100 && now - lastAt < 2000)) return;
      lastSent = pct;
      lastAt = now;
      reporting = reporting.then(() =>
        client.progress(job, pct).catch((err) => {
          if (isLost(err)) abort.abort(new JobLost(err.code));
          else log.warn('progress report failed', { jobId: job.id, status: err.status ?? null, err });
        }),
      );
    };
    try {
      const input = join(dir, 'input');
      await client.downloadInput(job, input, signal);
      progress(0);
      const output = await processJob(job, { dir, input, signal, progress });
      await reporting;
      if (signal.aborted) throw signal.reason ?? new JobLost('aborted');
      await client.uploadOutput(job, output.path, { mimeType: output.mimeType, ext: output.ext, signal });
      await client.complete(job);
      state.jobs++;
      log.info('job done', { jobId: job.id });
    } catch (err) {
      await reporting.catch(() => {});
      const reason = signal.reason;
      if (reason instanceof JobLost || isLost(err)) {
        log.warn('job dropped: the server no longer assigns it to this worker', { jobId: job.id });
      } else if (stop.signal.aborted) {
        // Shutting down: give the job back for another attempt.
        await client.fail(job, 'The worker shut down while processing', true).catch(() => {});
        log.warn('job returned to the queue (shutdown)', { jobId: job.id });
      } else {
        const permanent = err instanceof PermanentJobError;
        log.error('job failed', { jobId: job.id, retryable: !permanent, err });
        await client.fail(job, err.message || 'Processing failed', !permanent).catch((e) => {
          if (!isLost(e)) log.warn('fail report failed', { jobId: job.id, status: e.status ?? null, err: e });
        });
      }
    } finally {
      current = null;
      state.jobId = null;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function loop() {
    while (!stop.signal.aborted) {
      try {
        if (!client.registered) {
          state.phase = 'registering';
          const reg = await client.register();
          log.info('registered', { workerId: reg.workerId, heartbeatSeconds: reg.heartbeatSeconds, leaseSeconds: reg.leaseSeconds });
          startHeartbeats();
          await sendHeartbeat();
        }
        state.phase = 'idle';
        const job = await client.next();
        state.lastError = null;
        if (job) await runJob(job);
        else await sleep(pollSeconds * 1000, stop.signal);
      } catch (err) {
        if (stop.signal.aborted) break;
        const kind = classify(err);
        if (kind === 'reregister') client.forgetToken();
        const wait = kind === 'retry' ? waitSeconds(err) : Math.min(waitSeconds(err, backoffSeconds), Math.max(backoffSeconds, 1) * 10);
        state.phase = 'backoff';
        state.lastError = err.code ?? err.message;
        log.warn('waiting before the next try', { seconds: wait, status: err.status ?? null, code: err.code ?? null, err });
        await sleep(wait * 1000, stop.signal);
      }
    }
    state.phase = 'stopped';
  }

  return {
    state,
    start() {
      loopDone = loop();
      return loopDone;
    },
    /** Stops polling; a running job is failed as retryable. Resolves when the loop has ended. */
    async stop() {
      stop.abort();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      await loopDone;
    },
  };
}
