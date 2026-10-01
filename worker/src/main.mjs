// Shotstash reference worker: claims `shotstash/proxy-720p` jobs and turns
// each video into a 720p H.264/AAC MP4 proxy with ffmpeg.
//
//   SHOTSTASH_URL           app base URL, such as http://app:3005 (required)
//   WORKER_BOOTSTRAP_TOKEN  the shared token from the app's .env (required)
//   WORKER_NAME             display name (default reference-proxy)
//   WORKER_HEALTH_PORT      port of GET /healthz (default 8080; 0 turns it off)
//   WORKER_POLL_SECONDS     wait between empty claims (default 5)
//   WORKER_TMP_DIR          scratch space for one job (default the OS temp dir)
//   WORKER_IDLE_SECONDS     abort a job whose download, upload or ffmpeg
//                           progress is silent this long (default 600)
//   LOG_LEVEL               debug, info, warn or error (default info)
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContractClient } from './client.mjs';
import { createLogger } from './log.mjs';
import { PROXY_EXT, PROXY_KIND, PROXY_MIME, makeProxy, probe } from './transcode.mjs';
import { PermanentJobError, createWorker, isToolMissing } from './worker.mjs';

const env = process.env;
const log = createLogger({ level: env.LOG_LEVEL || 'info' });
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const baseUrl = (env.SHOTSTASH_URL || '').trim();
const bootstrapToken = (env.WORKER_BOOTSTRAP_TOKEN || '').trim();
const missing = [!baseUrl && 'SHOTSTASH_URL', !bootstrapToken && 'WORKER_BOOTSTRAP_TOKEN'].filter(Boolean);
if (missing.length) {
  // Configuration cannot fix itself: say so clearly, then keep the container
  // alive and unhealthy instead of a restart loop.
  log.error('missing configuration', { variables: missing });
}

const client = new ContractClient({
  baseUrl: baseUrl || 'http://invalid',
  bootstrapToken,
  manifest: { name: env.WORKER_NAME || 'reference-proxy', version: pkg.version, kinds: [PROXY_KIND] },
});

/** The processing step: probe, transcode with progress, hand back the proxy. */
async function processJob(job, { dir, input, signal, progress, alive }) {
  if (job.kind !== PROXY_KIND) throw new PermanentJobError(`This worker does not process ${job.kind}`);
  const info = await probe(input, { signal }).catch((err) => {
    // A missing or unusable ffprobe is this machine's problem: another try (or worker) may succeed.
    if (signal.aborted || isToolMissing(err)) throw err;
    throw new PermanentJobError(`The input cannot be read as media (${err.message})`);
  });
  if (!info.hasVideo) throw new PermanentJobError('The input has no video stream');
  const output = join(dir, `proxy.${PROXY_EXT}`);
  await makeProxy(input, output, { durationSeconds: info.durationSeconds, onPercent: progress, onActivity: alive, signal });
  return { path: output, mimeType: PROXY_MIME, ext: PROXY_EXT };
}

const worker = createWorker({
  client,
  process: processJob,
  log,
  pollSeconds: Number(env.WORKER_POLL_SECONDS) > 0 ? Number(env.WORKER_POLL_SECONDS) : 5,
  tmpDir: env.WORKER_TMP_DIR || tmpdir(),
  idleSeconds: Number(env.WORKER_IDLE_SECONDS) > 0 ? Number(env.WORKER_IDLE_SECONDS) : 600,
});

const healthPort = env.WORKER_HEALTH_PORT === undefined ? 8080 : Number(env.WORKER_HEALTH_PORT);
let health = null;
if (healthPort > 0) {
  health = createServer((req, res) => {
    if (req.url !== '/healthz') {
      res.writeHead(404).end();
      return;
    }
    // Alive and configured is healthy, also while waiting for the app.
    const ok = missing.length === 0 && worker.state.phase !== 'stopped';
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok, phase: worker.state.phase, registered: client.registered, jobId: worker.state.jobId, jobsDone: worker.state.jobs }));
  });
  health.listen(healthPort, () => log.info('health endpoint ready', { port: healthPort }));
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  setTimeout(() => process.exit(0), 15_000).unref();
  await worker.stop();
  health?.close();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => log.error('unhandled rejection', { err: reason instanceof Error ? reason : new Error(String(reason)) }));

log.info('starting', { version: pkg.version, kinds: [PROXY_KIND], url: baseUrl || null });
if (!missing.length) void worker.start();
