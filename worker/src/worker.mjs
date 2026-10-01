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

/** The job made no progress (download, upload, ffmpeg) for the idle limit. */
export class IdleTimeout extends Error {}

/** 409 answers that mean the job is no longer ours: drop it, never fail it. */
const LOST_CODES = new Set(['CLAIM_STALE', 'JOB_TERMINAL', 'FILE_GONE']);
const isLost = (err) => err instanceof ContractError && err.status === 409 && LOST_CODES.has(err.code);

/** ffprobe or ffmpeg missing or not executable: a problem of this machine, so retryable. */
export function isToolMissing(err) {
  return err?.code === 'ENOENT' || err?.code === 'EACCES';
}

/**
 * Whether a job error is worth another attempt. Bad input or output the
 * server refused (400, 404, 413) and PermanentJobError are not; everything
 * else (processing crashes, missing tools, timeouts) is.
 */
export function isRetryable(err) {
  if (err instanceof PermanentJobError) return false;
  if (err instanceof ContractError && [400, 404, 413].includes(err.status)) return false;
  return true;
}

/**
 * @param {object} opts
 * @param {import('./client.mjs').ContractClient} opts.client
 * @param {(job: object, ctx: { dir: string, input: string, signal: AbortSignal, progress: (pct: number) => void, alive: () => void }) => Promise<{ path: string, mimeType: string, ext: string }>} opts.process
 * @param {ReturnType<import('./log.mjs').createLogger>} opts.log
 * @param {number} [opts.pollSeconds] idle wait between empty claims
 * @param {number} [opts.backoffSeconds]
 * @param {number} [opts.idleSeconds] abort a job silent this long (default 600)
 * @param {string} opts.tmpDir
 */
export function createWorker({ client, process: processJob, log, pollSeconds = 5, backoffSeconds = BACKOFF_SECONDS, idleSeconds = 600, tmpDir }) {
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

  /**
   * Runs a call that finishes a job (upload, complete) until it succeeds:
   * 429, 503 and network errors wait and try again while the claim is still
   * ours; a 401 registers again (same name, same worker row); 409 and other
   * refusals stop at once.
   */
  async function persist(what, jobId, signal, fn) {
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        const kind = classify(err);
        if (signal.aborted || isLost(err) || (kind !== 'backoff' && kind !== 'reregister')) throw err;
        if (err instanceof ContractError && err.code === 'CONTRACT_UNSUPPORTED') throw err;
        const wait = Math.min(waitSeconds(err, backoffSeconds), Math.max(backoffSeconds, 1) * 10);
        log.warn(`${what} failed, trying again`, { jobId, seconds: wait, status: err.status ?? null, code: err.code ?? null, err });
        await sleep(wait * 1000, signal);
        if (signal.aborted) throw signal.reason ?? err;
        if (kind === 'reregister') {
          client.forgetToken();
          await client.register();
        }
      }
    }
  }

  async function runJob(job) {
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, stop.signal]);
    current = { job, abort };
    state.phase = 'working';
    state.jobId = job.id;
    log.info('job claimed', { jobId: job.id, kind: job.kind, attempt: job.attempt, size: job.input?.size });
    let dir = null;
    let lastActivity = Date.now();
    const alive = () => {
      lastActivity = Date.now();
    };
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > idleSeconds * 1000) {
        log.warn('job made no progress: aborting it', { jobId: job.id, idleSeconds });
        abort.abort(new IdleTimeout(`No progress for ${idleSeconds} s`));
      }
    }, Math.min(10_000, Math.max(50, (idleSeconds * 1000) / 4)));
    watchdog.unref?.();
    let lastSent = -1;
    let lastAt = 0;
    let reporting = Promise.resolve();
    const progress = (pct) => {
      alive();
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
      dir = await mkdtemp(join(tmpDir, 'shotstash-job-'));
      const input = join(dir, 'input');
      await client.downloadInput(job, input, signal, alive);
      progress(0);
      const output = await processJob(job, { dir, input, signal, progress, alive });
      await reporting;
      if (signal.aborted) throw signal.reason ?? new JobLost('aborted');
      await persist('output upload', job.id, signal, () => {
        alive();
        return client.uploadOutput(job, output.path, { mimeType: output.mimeType, ext: output.ext, signal, onChunk: alive });
      });
      await persist('complete', job.id, signal, () => client.complete(job));
      state.jobs++;
      log.info('job done', { jobId: job.id });
    } catch (err) {
      await reporting.catch(() => {});
      const reason = signal.reason;
      if (reason instanceof JobLost || isLost(err)) {
        log.warn('job dropped: the server no longer assigns it to this worker', { jobId: job.id, code: err.code ?? null });
      } else if (stop.signal.aborted || dir === null) {
        // Shutting down, or no scratch space here: give the job back without spending an attempt.
        await client.release(job).catch(() => {});
        log.warn('job released', { jobId: job.id, reason: stop.signal.aborted ? 'shutdown' : 'no scratch space', err });
      } else {
        const failure = reason instanceof IdleTimeout ? reason : err;
        const retryable = isRetryable(failure);
        log.error('job failed', { jobId: job.id, retryable, err: failure });
        await client.fail(job, failure.message || 'Processing failed', retryable).catch((e) => {
          if (!isLost(e)) log.warn('fail report failed', { jobId: job.id, status: e.status ?? null, err: e });
        });
      }
    } finally {
      clearInterval(watchdog);
      current = null;
      state.jobId = null;
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
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
    /** Stops polling; a running job is released (no attempt spent). Resolves when the loop has ended. */
    async stop() {
      stop.abort();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      await loopDone;
    },
  };
}
