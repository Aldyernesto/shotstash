// End-to-end check of Stories 5.1-5.2: the job queue and the worker
// contract against a running app and its database. Runs in the CI e2e job
// on both storage backends.
//
//   WORKER_BOOTSTRAP_TOKEN=<token> SHOTSTASH_PIPELINE_SWEEP_SECONDS=2 npm run dev
//   WORKER_BOOTSTRAP_TOKEN=<token> npm run e2e:pipeline
//
// Needs the seeded development accounts (editor, viewer, superadmin) and
// refuses to run unless the base URL and DATABASE_URL point at localhost.
// It registers test workers and queues jobs of throwaway kinds; it moves
// heartbeats back in time in the database to make the sweeper expire claims.
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const B = process.env.E2E_BASE_URL || 'http://localhost:3005';
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
if (!LOCAL.has(hostOf(B))) {
  console.error(`e2e:pipeline refuses to run: base URL ${B} is not localhost.`);
  process.exit(2);
}
if (!LOCAL.has(hostOf(process.env.DATABASE_URL || ''))) {
  console.error('e2e:pipeline refuses to run: DATABASE_URL does not point at localhost.');
  process.exit(2);
}
const BOOTSTRAP = process.env.WORKER_BOOTSTRAP_TOKEN || '';
if (BOOTSTRAP.length < 32) {
  console.error('e2e:pipeline needs WORKER_BOOTSTRAP_TOKEN (the same value the server runs with).');
  process.exit(2);
}
/** How long to wait for the sweeper (the server's sweep interval plus slack). */
const SWEEP_WAIT_MS = Number(process.env.E2E_SWEEP_WAIT_SECONDS || 45) * 1000;

let fails = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label} ${extra}`);
  if (!cond) fails++;
};
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const kind = (name) => `e2e-${RUN}/${name}`;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const md5hex = (buf) => createHash('md5').update(buf).digest('hex');
const md5b64 = (buf) => createHash('md5').update(buf).digest('base64');

// A refused upload (413) is answered before its body is read, and the server
// then closes that keep-alive socket; a request that reuses it fails with
// ECONNRESET before it reaches the server. Send such a request once more.
const rawFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  try {
    return await rawFetch(url, init);
  } catch (err) {
    const replayable = !(init?.body instanceof ReadableStream);
    if (replayable && err?.cause?.code === 'ECONNRESET') return rawFetch(url, init);
    throw err;
  }
};

// One short-lived connection per query (the PGlite dev database serves one at a time).
async function sql(text, params) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
}

async function login(email, password = 'shotstash-dev') {
  const r = await fetch(`${B}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = await r.json().catch(() => null);
  return { status: r.status, token: body?.token, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
async function gql(token, query, variables) {
  const r = await fetch(`${B}/api/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  return r.json();
}
const code = (res) => res.errors?.[0]?.extensions?.code;

/* ---------------- worker side ---------------- */

// Workers are one row per name: every test worker gets its own name.
let workerCount = 0;
const workerName = () => `e2e-${RUN}-w${++workerCount}`;
const manifest = (kinds, extra = {}) => ({ name: workerName(), version: '0.0.1', kinds, contract: 1, ...extra });

async function call(method, p, { token, bootstrap, claim, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h['x-worker-token'] = token;
  if (bootstrap) h['x-worker-bootstrap-token'] = bootstrap;
  if (claim) h['x-claim-token'] = claim;
  let payload;
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) payload = body;
    else {
      payload = JSON.stringify(body);
      h['content-type'] = 'application/json';
    }
  }
  const r = await fetch(`${B}/api/v1/pipeline/${p}`, { method, headers: h, body: payload });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    // binary body (input stream) or empty
  }
  return { status: r.status, headers: r.headers, json, buf };
}

async function register(kinds, name = workerName()) {
  const r = await call('POST', 'workers/register', { bootstrap: BOOTSTRAP, body: { manifest: { ...manifest(kinds), name } } });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${r.buf.toString()}`);
  return { id: r.json.workerId, token: r.json.token, kinds, name };
}
const next = (w) => call('POST', 'jobs/next', { token: w.token, body: {} });
const progress = (w, job, pct, claim = job.claimToken) => call('POST', `jobs/${job.id}/progress`, { token: w.token, claim, body: { progress: pct } });
const output = (w, job, buf, claim = job.claimToken) =>
  call('PUT', `jobs/${job.id}/output`, { token: w.token, claim, body: buf, headers: { 'content-type': 'video/mp4', 'x-output-ext': 'mp4' } });
const complete = (w, job, claim = job.claimToken) => call('POST', `jobs/${job.id}/complete`, { token: w.token, claim, body: {} });
const release = (w, job) => call('POST', `jobs/${job.id}/release`, { token: w.token, claim: job.claimToken, body: {} });
const failJob = (w, job, error, retryable) => call('POST', `jobs/${job.id}/fail`, { token: w.token, claim: job.claimToken, body: { error, retryable } });

async function claimOne(w) {
  const r = await next(w);
  if (r.status !== 200) throw new Error(`expected a job, got ${r.status}`);
  return r.json.job;
}

/* ---------------- storage check (both backends) ---------------- */

async function objectExists(key) {
  if ((process.env.STORAGE_BACKEND || 'local') === 's3') {
    const { S3Client, HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION || 'us-east-1',
      forcePathStyle: /^(true|1|yes)$/i.test(process.env.S3_FORCE_PATH_STYLE || ''),
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
    });
    try {
      await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
      return true;
    } catch (err) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return false;
      throw err;
    }
  }
  return existsSync(path.join(process.env.STORAGE_LOCAL_ROOT || './data/media', key));
}

/** Number of stored objects under a key prefix (such as files/<id>/proc/). */
async function objectsUnder(prefix) {
  if ((process.env.STORAGE_BACKEND || 'local') === 's3') {
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION || 'us-east-1',
      forcePathStyle: /^(true|1|yes)$/i.test(process.env.S3_FORCE_PATH_STYLE || ''),
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
    });
    const r = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: prefix }));
    return r.KeyCount ?? 0;
  }
  const dir = path.join(process.env.STORAGE_LOCAL_ROOT || './data/media', prefix);
  return existsSync(dir) ? readdirSync(dir).length : 0;
}

const jobRow = async (id) => (await sql('SELECT status::text AS status, attempts, claimed_by, claim_token, output_key, error FROM pipeline_jobs WHERE id = $1', [id]))[0];
const expire = (id) => sql("UPDATE pipeline_jobs SET heartbeat_at = now() - interval '1 hour' WHERE id = $1", [id]);
/** A requeued job waits 30 s per attempt (run_after); the tests skip the wait. */
const skipDelay = (id) => sql('UPDATE pipeline_jobs SET run_after = NULL WHERE id = $1', [id]);
const LEASE = Number(process.env.SHOTSTASH_PIPELINE_LEASE_SECONDS || 90);
const SWEEP = Number(process.env.SHOTSTASH_PIPELINE_SWEEP_SECONDS || 30);
const MAX_OUTPUT_MB = Number(process.env.SHOTSTASH_PIPELINE_MAX_OUTPUT_MB || 0);

async function waitFor(fn, ms = SWEEP_WAIT_MS) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/* ---------------- people side ---------------- */

const editor = await login('editor@example.com');
const viewer = await login('viewer@example.com');
const sa = await login('superadmin@example.com');
ok(editor.token && viewer.token && sa.token, 'logins');

const proj = await gql(editor.token, '{ projects { id title folders { id name } } }');
const project = proj.data.projects.find((p) => p.title === 'Sample project');
const folder = project.folders[0];
const INIT = 'mutation($i: InitiateUploadInput!){ initiateUpload(input:$i){ id fileId partSize partCount } }';
const COMPLETE_UPLOAD = 'mutation($s: ID!, $m: String){ completeUpload(sessionId:$s, md5Checksum:$m){ id } }';
const JPEG = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#808080' } }).jpeg().toBuffer();
async function upload(name, kind = 'video') {
  const buf =
    kind === 'jpeg'
      ? Buffer.concat([JPEG, randomBytes(16)])
      : Buffer.concat([Buffer.from('000000186674797069736f6d0000020069736f6d6d703431', 'hex'), randomBytes(20000)]);
  const init = (await gql(editor.token, INIT, { i: { filename: name, totalSize: buf.length, projectId: project.id, folderId: folder.id } })).data.initiateUpload;
  await fetch(`${B}/api/v1/uploads/${init.id}/parts/1`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${editor.token}`, 'content-md5': md5b64(buf), 'content-type': 'application/octet-stream' },
    body: buf,
  });
  const done = await gql(editor.token, COMPLETE_UPLOAD, { s: init.id, m: md5hex(buf) });
  return { id: done.data.completeUpload.id, buf };
}
const ENQUEUE = 'mutation($f: ID!, $k: String!){ enqueueJob(fileId:$f, kind:$k){ id kind status state attempts } }';
const enqueue = async (fileId, k, tok = editor.token) => gql(tok, ENQUEUE, { f: fileId, k });
const JOB = 'query($id: ID!){ pipelineJob(id:$id){ id status state progress attempts error seq outputVersion { id kind mimeType size downloadUrl } } }';

const file = await upload(`pipeline-${RUN}.mp4`);
ok(!!file.id, 'uploaded a file to process');

/* ---------------- registration and auth ---------------- */
{
  const r = await call('POST', 'workers/register', { bootstrap: BOOTSTRAP, body: { manifest: manifest([kind('reg')]) } });
  ok(r.status === 201 && typeof r.json?.token === 'string' && r.json.contract === 1 && r.json.heartbeatSeconds === 30, 'register 201 with a token shown once', r.status);
  ok(r.headers.get('x-shotstash-pipeline') === '1', 'X-Shotstash-Pipeline: 1 on the answer', r.headers.get('x-shotstash-pipeline'));
  const row = (await sql('SELECT token_hash, name, kinds FROM pipeline_workers WHERE id = $1', [r.json.workerId]))[0];
  ok(row?.token_hash === sha256(r.json.token) && !JSON.stringify(row).includes(r.json.token), 'only the SHA-256 hash of the token is stored');
  ok((await sql('SELECT 1 FROM pipeline_kinds WHERE name = $1', [kind('reg')])).length === 1, 'registration adds its kind to pipeline_kinds');
  const wrong = await call('POST', 'workers/register', { bootstrap: 'x'.repeat(64), body: { manifest: manifest([kind('reg')]) } });
  ok(wrong.status === 401 && wrong.headers.get('x-shotstash-pipeline') === '1', 'wrong bootstrap token 401 (with the contract header)', wrong.status);
  const none = await call('POST', 'workers/register', { body: { manifest: manifest([kind('reg')]) } });
  ok(none.status === 401, 'no bootstrap token 401', none.status);
  const workerTokenAsBootstrap = await call('POST', 'workers/register', { bootstrap: r.json.token, body: { manifest: manifest([kind('reg')]) } });
  ok(workerTokenAsBootstrap.status === 401, 'a worker token is not a bootstrap token', workerTokenAsBootstrap.status);
  const major2 = await call('POST', 'workers/register', { bootstrap: BOOTSTRAP, body: { manifest: manifest([kind('reg')], { contract: 2 }) } });
  ok(major2.status === 422 && major2.json?.code === 'CONTRACT_UNSUPPORTED', 'contract major 2 at register 422 CONTRACT_UNSUPPORTED', major2.status);
  const hb2 = await call('POST', 'workers/heartbeat', { token: r.json.token, body: { manifest: manifest([kind('reg')], { contract: '2.0' }) } });
  ok(hb2.status === 422 && hb2.json?.code === 'CONTRACT_UNSUPPORTED', 'contract major 2 at heartbeat 422', hb2.status);
  const bad = await call('POST', 'workers/register', { bootstrap: BOOTSTRAP, body: { manifest: manifest(['not-namespaced']) } });
  ok(bad.status === 400 && bad.json?.code === 'INVALID_MANIFEST', 'a kind without a namespace 400 INVALID_MANIFEST', bad.status);

  const noToken = await call('POST', 'jobs/next', { body: {} });
  ok(noToken.status === 401 && noToken.json?.code === 'UNAUTHENTICATED', 'jobs/next without a worker token 401', noToken.status);
  const garbage = await call('POST', 'jobs/next', { token: 'ssw_not-a-token', body: {} });
  ok(garbage.status === 401, 'unknown worker token 401', garbage.status);
  const sessionAsWorker = await call('POST', 'jobs/next', { token: editor.token, body: {} });
  ok(sessionAsWorker.status === 401, 'a user session is not a worker token', sessionAsWorker.status);
  await sql('UPDATE pipeline_workers SET revoked_at = now() WHERE id = $1', [r.json.workerId]);
  const revoked = await call('POST', 'workers/heartbeat', { token: r.json.token, body: { manifest: manifest([kind('reg')]) } });
  ok(revoked.status === 401, 'revoked worker 401', revoked.status);
  const bearer = await fetch(`${B}/api/v1/pipeline/jobs/next`, { method: 'POST', headers: { authorization: `Bearer ${editor.token}` } });
  ok(bearer.status === 401, 'Bearer sessions do not open the worker API', bearer.status);
}

/* ---------------- enqueue: permission and unknown kind ---------------- */
{
  const unknown = await enqueue(file.id, 'foo/bar');
  ok(code(unknown) === 'KIND_UNKNOWN', 'enqueue of an unknown kind KIND_UNKNOWN', JSON.stringify(unknown.errors ?? unknown.data));
  ok(code(await enqueue(file.id, 'not a kind')) === 'KIND_UNKNOWN', 'enqueue of a malformed kind KIND_UNKNOWN');
  const v = await enqueue(file.id, 'shotstash/proxy-720p', viewer.token);
  ok(code(v) === 'FORBIDDEN', 'viewer enqueueJob FORBIDDEN', JSON.stringify(v.errors ?? ''));
  ok(code(await enqueue(file.id, 'shotstash/proxy-720p', null)) === 'UNAUTHENTICATED', 'enqueueJob needs a session');
  ok(code(await enqueue('00000000-0000-4000-8000-000000000000', 'shotstash/proxy-720p')) === 'NOT_FOUND', 'enqueue on a missing file NOT_FOUND');
}

/* ---------------- two workers, one job; kind filter ---------------- */
{
  const a = kind('race');
  const w1 = await register([a]);
  const w2 = await register([a]);
  const other = await register([kind('other')]);
  const q = await enqueue(file.id, a);
  ok(q.data?.enqueueJob?.status === 'queued', 'enqueue queues a job', JSON.stringify(q.errors ?? ''));
  const again = await enqueue(file.id, a);
  ok(again.data?.enqueueJob?.id === q.data.enqueueJob.id, 'enqueueing the same kind again answers the unfinished job');
  const filtered = await next(other);
  ok(filtered.status === 204, 'a worker of another kind gets 204 (kind filter)', filtered.status);
  const [r1, r2] = await Promise.all([next(w1), next(w2)]);
  const statuses = [r1.status, r2.status].sort();
  ok(statuses[0] === 200 && statuses[1] === 204, 'two concurrent claims: exactly one gets the job', statuses.join(','));
  const winner = r1.status === 200 ? r1 : r2;
  ok(winner.json?.job?.id === q.data.enqueueJob.id && winner.json.job.attempt === 1 && typeof winner.json.job.claimToken === 'string', 'the claim answers the job, attempt 1 and a claim token');
  // The file name is random test data and may contain "s3" by chance, so it is left out of the check.
  const { name: _inputName, ...inputFields } = winner.json.job.input ?? {};
  ok(!/files\/|storage|s3|secret/i.test(JSON.stringify(inputFields)), 'the claim carries no storage key or credential', JSON.stringify(winner.json.job.input));
  const row = await jobRow(q.data.enqueueJob.id);
  ok(row.status === 'claimed' && row.attempts === 1, 'job is claimed with one attempt', JSON.stringify(row));
  // Clean up: this job is not used further.
  await failJob(r1.status === 200 ? w1 : w2, winner.json.job, 'e2e cleanup', false);
}

/* ---------------- waiting for a worker ---------------- */
{
  const k = kind('waiting');
  const w = await register([k]);
  // last_seen is written by the app in UTC; set it the same way (the session time zone may differ).
  await sql("UPDATE pipeline_workers SET last_seen = ($2::timestamptz AT TIME ZONE 'UTC') WHERE id = $1", [w.id, new Date(Date.now() - 3600_000).toISOString()]);
  const q = await enqueue(file.id, k);
  ok(q.data?.enqueueJob?.state === 'waiting_for_worker' && q.data.enqueueJob.status === 'queued', 'queued job without a live worker is waiting_for_worker', JSON.stringify(q.data?.enqueueJob));
  await call('POST', 'workers/heartbeat', { token: w.token, body: { manifest: manifest([k]) } });
  const j = await gql(editor.token, JOB, { id: q.data.enqueueJob.id });
  ok(j.data?.pipelineJob?.state === 'queued', 'once the worker is seen the job is plain queued', JSON.stringify(j.data?.pipelineJob));
  await gql(editor.token, 'mutation($id: ID!){ cancelJob(id:$id){ id } }', { id: q.data.enqueueJob.id });
}

/* ---------------- input, output, complete ---------------- */
let doneVersionId = null;
{
  const k = kind('ok');
  const w = await register([k]);
  const stranger = await register([k]);
  const q = await enqueue(file.id, k);
  const job = await claimOne(w);
  ok(job.id === q.data.enqueueJob.id && job.input.size === file.buf.length && job.input.mimeType === 'video/mp4', 'claim describes the input', JSON.stringify(job.input));
  let r = await call('GET', `jobs/${job.id}/input`, { token: w.token, claim: job.claimToken, headers: { range: 'bytes=0-9' } });
  ok(r.status === 206 && r.buf.equals(file.buf.subarray(0, 10)) && r.headers.get('cache-control') === 'no-store', 'input Range 206 with the original bytes and no-store', `${r.status} ${r.headers.get('cache-control')}`);
  ok(r.headers.get('x-shotstash-pipeline') === '1', 'the input stream carries the contract header');
  r = await call('GET', `jobs/${job.id}/input`, { token: w.token, claim: job.claimToken });
  ok(r.status === 200 && r.buf.equals(file.buf), 'whole input 200', r.status);
  r = await call('GET', `jobs/${job.id}/input`, { token: stranger.token, claim: job.claimToken });
  ok(r.status === 409 && r.json?.code === 'CLAIM_STALE', 'another worker cannot read the input (409)', r.status);
  r = await call('GET', `jobs/${job.id}/input`, { token: w.token, claim: 'wrong' });
  ok(r.status === 409 && r.json?.code === 'CLAIM_STALE', 'a wrong claim token cannot read the input (409)', r.status);
  r = await call('GET', `jobs/${job.id}/input`, { token: w.token });
  ok(r.status === 400 && r.json?.code === 'CLAIM_TOKEN_REQUIRED', 'input without a claim token 400', r.status);
  r = await call('GET', 'jobs/00000000-0000-4000-8000-000000000000/input', { token: w.token, claim: 'x' });
  ok(r.status === 404 && r.json?.code === 'JOB_NOT_FOUND', 'unknown job 404', r.status);

  r = await progress(w, job, 40);
  ok(r.status === 200 && r.json?.status === 'running' && r.json.progress === 40, 'progress moves the job to running', r.status);
  const seq1 = r.json?.seq;
  r = await progress(w, job, 60);
  ok(r.json?.seq > seq1, 'every progress report bumps seq', `${seq1} -> ${r.json?.seq}`);
  r = await progress(w, job, 140);
  ok(r.status === 400 && r.json?.code === 'INVALID_BODY', 'progress above 100 400', r.status);
  r = await complete(w, job);
  ok(r.status === 409 && r.json?.code === 'OUTPUT_MISSING', 'complete before an output 409 OUTPUT_MISSING', r.status);
  r = await call('PUT', `jobs/${job.id}/output`, { token: w.token, claim: job.claimToken, body: Buffer.from('x'), headers: { 'content-type': 'video/mp4' } });
  ok(r.status === 400 && r.json?.code === 'INVALID_OUTPUT', 'output without X-Output-Ext 400', r.status);

  const first = randomBytes(3000);
  r = await output(w, job, first);
  ok(r.status === 200 && r.json?.size === 3000, 'output stored', r.status);
  const firstKey = (await jobRow(job.id)).output_key;
  const out = randomBytes(5000);
  r = await output(w, job, out);
  ok(r.status === 200 && r.json?.size === 5000 && r.json.mimeType === 'video/mp4', 'a second output replaces the first', r.status);
  const outKey = (await jobRow(job.id)).output_key;
  ok(firstKey !== outKey && !(await objectExists(firstKey)) && (await objectExists(outKey)), 'the replaced output is deleted from storage', `${firstKey} ${outKey}`);
  ok(new RegExp(`^files/${file.id}/proc/[0-9a-f-]+\\.mp4$`).test(outKey), 'output key is the processed key scheme', outKey);

  r = await complete(stranger, job);
  ok(r.status === 409 && r.json?.code === 'CLAIM_STALE', 'another worker cannot complete (409)', r.status);
  r = await complete(w, job);
  ok(r.status === 200 && r.json?.status === 'done' && r.json.versionId, 'complete 200', r.status);
  doneVersionId = r.json?.versionId;
  const pv = (await sql('SELECT kind, job_id, attempt, mime_type, size::text AS size, storage_key FROM processed_versions WHERE id = $1', [doneVersionId]))[0];
  ok(pv?.job_id === job.id && pv.attempt === 1 && pv.kind === k && pv.mime_type === 'video/mp4' && pv.size === '5000' && pv.storage_key === outKey, 'processed version row with job_id and attempt', JSON.stringify(pv));
  const j = await gql(editor.token, JOB, { id: job.id });
  ok(j.data?.pipelineJob?.status === 'done' && j.data.pipelineJob.progress === 100 && j.data.pipelineJob.outputVersion?.id === doneVersionId, 'pipelineJob shows done with its output version', JSON.stringify(j.data?.pipelineJob));
  const listed = await gql(viewer.token, `{ processedVersions(fileId:"${file.id}") { id kind downloadUrl } }`);
  ok(listed.data?.processedVersions?.some((v) => v.id === doneVersionId && v.kind === k), 'the version is listed for the viewer (viewer info panel)');
  const jobs = await gql(viewer.token, `query { pipelineJob(id:"${job.id}") { id } }`);
  ok(jobs.data?.pipelineJob?.id === job.id, 'viewers can read job state');
  const media = await fetch(`${B}/media/p/${doneVersionId}`, { headers: { cookie: editor.cookie } });
  const bytes = Buffer.from(await media.arrayBuffer());
  ok(media.status === 200 && bytes.equals(out), '/media/p serves the output bytes', media.status);
  r = await progress(w, job, 100);
  ok(r.status === 409 && r.json?.code === 'JOB_TERMINAL', 'a done job refuses further updates 409 JOB_TERMINAL', r.status);
  r = await complete(w, job);
  ok(r.status === 409 && r.json?.code === 'JOB_TERMINAL', 'completing twice 409 JOB_TERMINAL', r.status);
}

/* ---------------- fail: retryable requeue, then failed ---------------- */
{
  const k = kind('fail');
  const w = await register([k]);
  const q = await enqueue(file.id, k);
  let job = await claimOne(w);
  let r = await failJob(w, job, 'temporary trouble', true);
  ok(r.status === 200 && r.json?.status === 'queued' && r.json.attempts === 1, 'retryable failure with attempts left requeues', JSON.stringify(r.json));
  let row = await jobRow(q.data.enqueueJob.id);
  ok(row.status === 'queued' && !row.claim_token && row.error === 'temporary trouble', 'requeued job keeps the error and drops the claim', JSON.stringify(row));
  r = await progress(w, job, 10);
  ok(r.status === 409 && r.json?.code === 'CLAIM_STALE', 'the old claim is stale after a requeue', r.status);
  const delay = (await sql('SELECT EXTRACT(EPOCH FROM run_after - now())::int AS s FROM pipeline_jobs WHERE id = $1', [q.data.enqueueJob.id]))[0];
  ok(delay && delay.s >= 25 && delay.s <= 31, 'a retryable failure sets run_after 30 s per attempt', JSON.stringify(delay));
  r = await next(w);
  ok(r.status === 204, 'run_after delays the retried claim (204 meanwhile)', r.status);
  await skipDelay(q.data.enqueueJob.id);
  job = await claimOne(w);
  ok(job.attempt === 2, 'second claim is attempt 2', job.attempt);
  r = await failJob(w, job, 'the input is broken', false);
  ok(r.status === 200 && r.json?.status === 'failed', 'non-retryable failure fails the job', JSON.stringify(r.json));
  const j = await gql(editor.token, JOB, { id: job.id });
  ok(j.data?.pipelineJob?.status === 'failed' && j.data.pipelineJob.error === 'the input is broken', 'failed job shows its error', JSON.stringify(j.data?.pipelineJob));
}

/* ---------------- cancel race ---------------- */
{
  const k = kind('cancel');
  const w = await register([k]);
  const q = await enqueue(file.id, k);
  const job = await claimOne(w);
  await progress(w, job, 5);
  await output(w, job, randomBytes(1000));
  const pendingKey = (await jobRow(job.id)).output_key;
  const [cancelled, raced] = await Promise.all([
    gql(editor.token, 'mutation($id: ID!){ cancelJob(id:$id){ id status } }', { id: q.data.enqueueJob.id }),
    progress(w, job, 50),
  ]);
  ok(cancelled.data?.cancelJob?.status === 'cancelled', 'cancel wins or follows the racing progress', JSON.stringify(cancelled.errors ?? cancelled.data));
  ok(raced.status === 200 || (raced.status === 409 && raced.json?.code === 'JOB_TERMINAL'), 'the racing progress either landed before or got JOB_TERMINAL', raced.status);
  const after = await progress(w, job, 60);
  ok(after.status === 409 && after.json?.code === 'JOB_TERMINAL', 'progress after cancel 409 JOB_TERMINAL', after.status);
  const hb = await call('POST', 'workers/heartbeat', { token: w.token, body: { manifest: manifest([k]), activeJobIds: [job.id] } });
  ok(hb.status === 200 && hb.json?.lostJobIds?.includes(job.id), 'heartbeat lists the cancelled job as lost', JSON.stringify(hb.json));
  ok((await jobRow(job.id)).status === 'cancelled' && !(await objectExists(pendingKey)), 'job cancelled and its pending output deleted');
  const fin = await complete(w, job);
  ok(fin.status === 409 && fin.json?.code === 'JOB_TERMINAL', 'complete after cancel 409 JOB_TERMINAL', fin.status);
  const twice = await gql(editor.token, 'mutation($id: ID!){ cancelJob(id:$id){ id } }', { id: job.id });
  ok(code(twice) === 'JOB_TERMINAL', 'cancelling a finished job JOB_TERMINAL');
  ok(code(await gql(viewer.token, 'mutation($id: ID!){ cancelJob(id:$id){ id } }', { id: job.id })) === 'FORBIDDEN', 'viewer cancelJob FORBIDDEN');
}

/* ---------------- dead worker: requeue, then fail after 3 expiries ---------------- */
{
  const k = kind('dead');
  const w = await register([k]);
  const q = await enqueue(file.id, k);
  const id = q.data.enqueueJob.id;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const job = await claimOne(w);
    ok(job.id === id && job.attempt === attempt, `claim attempt ${attempt}`, job.attempt);
    await expire(id);
    const expected = attempt < 3 ? 'queued' : 'failed';
    const row = await waitFor(async () => {
      const r = await jobRow(id);
      return r.status === expected ? r : null;
    });
    ok(row && row.attempts === attempt, `missed heartbeats: attempt ${attempt} ends ${expected} (sweeper)`, JSON.stringify(row ?? (await jobRow(id))));
    if (attempt < 3) {
      ok(row && !row.claimed_by && !row.claim_token, 'the expired claim is cleared');
      const ra = (await sql('SELECT run_after IS NOT NULL AND run_after > now() AS delayed FROM pipeline_jobs WHERE id = $1', [id]))[0];
      ok(ra?.delayed, 'a sweeper requeue sets run_after');
      await skipDelay(id);
    }
    else ok(row && /heartbeats/.test(row.error ?? ''), 'third expiry fails the job with the heartbeat error', row?.error);
  }
  const late = await progress(w, { id, claimToken: (await jobRow(id)).claim_token }, 99);
  ok(late.status === 409 && late.json?.code === 'JOB_TERMINAL', 'the last holder learns the failure as JOB_TERMINAL', late.status);
}

/* ---------------- late completion after a requeue ---------------- */
{
  const k = kind('late');
  const w1 = await register([k]);
  const w2 = await register([k]);
  const q = await enqueue(file.id, k);
  const id = q.data.enqueueJob.id;
  const old = await claimOne(w1);
  ok((await output(w1, old, randomBytes(2000))).status === 200, 'old claim uploads an output');
  const staleKey = (await jobRow(id)).output_key;
  ok(await objectExists(staleKey), 'the output object exists before the requeue', staleKey);
  await expire(id);
  ok(await waitFor(async () => (await jobRow(id)).status === 'queued'), 'the sweeper requeues the silent claim');
  await skipDelay(id);
  const fresh = await claimOne(w2);
  ok(fresh.id === id && fresh.attempt === 2, 'another worker claims it (attempt 2)');
  const lateDone = await complete(w1, old);
  ok(lateDone.status === 409 && lateDone.json?.code === 'CLAIM_STALE', 'late completion of the old claim 409 CLAIM_STALE', lateDone.status);
  const lateOut = await output(w1, old, randomBytes(100));
  ok(lateOut.status === 409 && lateOut.json?.code === 'CLAIM_STALE', 'late output of the old claim 409 CLAIM_STALE', lateOut.status);
  ok(!(await objectExists(staleKey)), 'the old claim output object is deleted', staleKey);
  ok((await sql('SELECT 1 FROM processed_versions WHERE job_id = $1', [id])).length === 0, 'no processed version from the stale claim');
  const fin = await output(w2, fresh, randomBytes(700));
  const done = await complete(w2, fresh);
  ok(fin.status === 200 && done.status === 200, 'the new claim completes');
  const pv = (await sql('SELECT attempt FROM processed_versions WHERE job_id = $1', [id]))[0];
  ok(pv?.attempt === 2, 'its version records attempt 2', JSON.stringify(pv));
}

/* ---------------- heartbeats keep a claim alive ---------------- */
{
  const k = kind('hb');
  const w = await register([k]);
  await enqueue(file.id, k);
  const job = await claimOne(w);
  // Ten seconds before the lease runs out: without a heartbeat the next sweeps would requeue it.
  await sql(`UPDATE pipeline_jobs SET heartbeat_at = now() - make_interval(secs => $2) WHERE id = $1`, [job.id, LEASE - 10]);
  const hb = await call('POST', 'workers/heartbeat', { token: w.token, body: { manifest: manifest([k]), activeJobIds: [job.id] } });
  ok(hb.status === 200 && Array.isArray(hb.json?.lostJobIds) && hb.json.lostJobIds.length === 0, 'heartbeat with the held job: lostJobIds empty', JSON.stringify(hb.json));
  await new Promise((r) => setTimeout(r, (12 + 2 * SWEEP) * 1000));
  const row = await jobRow(job.id);
  ok(row.status === 'claimed' && row.attempts === 1 && row.claimed_by === w.id, 'after the sweeps the job is still claimed, attempt 1', JSON.stringify(row));
  await failJob(w, job, 'e2e cleanup', false);
}

/* ---------------- double enqueue, release, workers by name ---------------- */
{
  const k = kind('double');
  const w = await register([k]);
  const [a, b] = await Promise.all([enqueue(file.id, k), enqueue(file.id, k)]);
  const rows = await sql("SELECT id FROM pipeline_jobs WHERE media_file_id = $1 AND kind = $2", [file.id, k]);
  ok(a.data?.enqueueJob?.id && a.data.enqueueJob.id === b.data?.enqueueJob?.id && rows.length === 1, 'two concurrent enqueues make one job', JSON.stringify([a.errors ?? a.data, b.errors ?? b.data, rows.length]));

  const job = await claimOne(w);
  ok((await output(w, job, randomBytes(500))).status === 200, 'output before a release');
  const key = (await jobRow(job.id)).output_key;
  const r = await release(w, job);
  ok(r.status === 200 && r.json?.status === 'queued' && r.json.attempts === 0, 'release puts the job back without spending an attempt', JSON.stringify(r.json));
  const row = (await sql('SELECT status::text AS status, attempts, claim_token, run_after FROM pipeline_jobs WHERE id = $1', [job.id]))[0];
  ok(row.status === 'queued' && row.attempts === 0 && !row.claim_token && row.run_after === null, 'released row: queued, attempts 0, no claim, no delay', JSON.stringify(row));
  ok(!(await objectExists(key)), 'release deletes the uploaded output');
  const again = await claimOne(w);
  ok(again.id === job.id && again.attempt === 1, 'the released job is claimed again at once as attempt 1', again.attempt);
  const stale = await release(w, job);
  ok(stale.status === 409 && stale.json?.code === 'CLAIM_STALE', 'releasing with the old claim 409 CLAIM_STALE', stale.status);
  const noClaim = await call('POST', `jobs/${job.id}/release`, { token: w.token, body: {} });
  ok(noClaim.status === 400 && noClaim.json?.code === 'CLAIM_TOKEN_REQUIRED', 'release without a claim token 400', noClaim.status);
  await failJob(w, again, 'e2e cleanup', false);

  // One row per name: registering again rotates the token on the same row.
  const name = `e2e-${RUN}-named`;
  const first = await register([k], name);
  const second = await register([k], name);
  const named = await sql('SELECT id FROM pipeline_workers WHERE name = $1', [name]);
  ok(first.id === second.id && named.length === 1, 'registering one name twice keeps one row', JSON.stringify(named));
  ok((await next(first)).status === 401, 'the rotated-out token stops working');
  ok([200, 204].includes((await next(second)).status), 'the new token works');

  // Revocation (super admin): token refused, name refused.
  const listed = await gql(sa.token, '{ pipelineWorkers { id name live revokedAt } }');
  ok(listed.data?.pipelineWorkers?.some((x) => x.id === second.id && x.live === true), 'pipelineWorkers lists the worker as live (super admin)', JSON.stringify(listed.errors ?? ''));
  ok(code(await gql(editor.token, '{ pipelineWorkers { id } }')) === 'FORBIDDEN', 'pipelineWorkers FORBIDDEN for an editor');
  ok(code(await gql(editor.token, 'mutation($id: ID!){ revokeWorker(id:$id){ id } }', { id: second.id })) === 'FORBIDDEN', 'revokeWorker FORBIDDEN for an editor');
  const rv = await gql(sa.token, 'mutation($id: ID!){ revokeWorker(id:$id){ id revokedAt live } }', { id: second.id });
  ok(rv.data?.revokeWorker?.revokedAt && rv.data.revokeWorker.live === false, 'revokeWorker marks it revoked', JSON.stringify(rv.errors ?? rv.data));
  ok((await next(second)).status === 401, 'a revoked worker token 401');
  const reReg = await call('POST', 'workers/register', { bootstrap: BOOTSTRAP, body: { manifest: { ...manifest([k]), name } } });
  ok(reReg.status === 403 && reReg.json?.code === 'WORKER_REVOKED', 'a revoked name cannot register again 403 WORKER_REVOKED', reReg.status);
}

/* ---------------- request limits and kinds ---------------- */
{
  const k = kind('limits');
  const w = await register([k]);
  await enqueue(file.id, k);
  const job = await claimOne(w);
  let r = await call('PUT', `jobs/${job.id}/output`, { token: w.token, claim: job.claimToken, body: Buffer.from('<p>x</p>'), headers: { 'content-type': 'text/html', 'x-output-ext': 'html' } });
  ok(r.status === 400 && r.json?.code === 'INVALID_OUTPUT', 'an output with a disallowed Content-Type 400 INVALID_OUTPUT', r.status);
  r = await call('PUT', `jobs/${job.id}/output`, { token: w.token, claim: job.claimToken, body: Buffer.alloc(0), headers: { 'content-type': 'video/mp4', 'x-output-ext': 'mp4' } });
  ok(r.status === 400 && r.json?.code === 'INVALID_OUTPUT', 'an empty output 400 INVALID_OUTPUT', r.status);

  // A JSON body over 64 KiB sent without Content-Length (chunked).
  const big = JSON.stringify({ progress: 1, pad: 'x'.repeat(70 * 1024) });
  const chunked = new ReadableStream({
    start(ctl) {
      ctl.enqueue(new TextEncoder().encode(big));
      ctl.close();
    },
  });
  const res = await fetch(`${B}/api/v1/pipeline/jobs/${job.id}/progress`, {
    method: 'POST',
    headers: { 'x-worker-token': w.token, 'x-claim-token': job.claimToken, 'content-type': 'application/json' },
    body: chunked,
    duplex: 'half',
  });
  const body = await res.json().catch(() => null);
  ok(res.status === 413 && body?.code === 'BODY_TOO_LARGE', 'a JSON body over 64 KiB without Content-Length 413 BODY_TOO_LARGE', res.status);

  if (MAX_OUTPUT_MB === 1) {
    const prefix = `files/${file.id}/proc/`;
    const before = await objectsUnder(prefix);
    const tooBig = randomBytes(1024 * 1024 + 4096);
    r = await output(w, job, tooBig);
    ok(r.status === 413 && r.json?.code === 'OUTPUT_TOO_LARGE', 'an output over 1 MiB (Content-Length) 413', r.status);
    const streamed = new ReadableStream({
      start(ctl) {
        for (let i = 0; i < 5; i++) ctl.enqueue(randomBytes(300 * 1024));
        ctl.close();
      },
    });
    const sr = await fetch(`${B}/api/v1/pipeline/jobs/${job.id}/output`, {
      method: 'PUT',
      headers: { 'x-worker-token': w.token, 'x-claim-token': job.claimToken, 'content-type': 'video/mp4', 'x-output-ext': 'mp4' },
      body: streamed,
      duplex: 'half',
    });
    const sb = await sr.json().catch(() => null);
    ok(sr.status === 413 && sb?.code === 'OUTPUT_TOO_LARGE', 'a streamed output over 1 MiB (no Content-Length) 413', sr.status);
    ok((await objectsUnder(prefix)) === before && !(await jobRow(job.id)).output_key, 'no object is left by the refused outputs', `${before} -> ${await objectsUnder(prefix)}`);
  } else {
    console.log('SKIP output size limit rows: run the server with SHOTSTASH_PIPELINE_MAX_OUTPUT_MB=1');
  }
  await failJob(w, job, 'e2e cleanup', false);

  const jpeg = await upload(`photo-${RUN}.jpg`, 'jpeg');
  const na = await enqueue(jpeg.id, 'shotstash/proxy-720p');
  ok(code(na) === 'KIND_NOT_APPLICABLE', 'a video kind on a JPEG KIND_NOT_APPLICABLE', JSON.stringify(na.errors ?? na.data));

  // Story 5.4: the Process menu lists only the kinds that apply.
  const KINDS = 'query($f: ID!){ availableKinds(fileId:$f){ kind label live } }';
  const forVideo = (await gql(editor.token, KINDS, { f: file.id })).data?.availableKinds ?? [];
  ok(forVideo[0]?.kind === 'shotstash/proxy-720p', 'availableKinds: the proxy comes first for a video', forVideo.map((k) => k.kind).join(','));
  const forPhoto = (await gql(editor.token, KINDS, { f: jpeg.id })).data?.availableKinds ?? [];
  ok(!forPhoto.some((k) => k.kind === 'shotstash/proxy-720p'), 'availableKinds: no proxy entry on a photo', forPhoto.map((k) => k.kind).join(','));
  ok(code(await gql(viewer.token, KINDS, { f: file.id })) === 'FORBIDDEN', 'availableKinds for a viewer FORBIDDEN');
}

/* ---------------- trash cancels jobs; complete answers FILE_GONE; purge cleans up ---------------- */
{
  const k = kind('trash');
  const w = await register([k, kind('trash-queued')]);
  const doomed = await upload(`trash-${RUN}.mp4`);
  const q = await enqueue(doomed.id, k);
  const queuedToo = await enqueue(doomed.id, kind('trash-queued'));
  // Story 5.4 deferred rows: MediaFile.jobs newest first; currentJob is the newest open job.
  const listed = await gql(editor.token, `query($id: ID!){ folder(id:$id){ files { id jobs { id createdAt } currentJob { id state } } } }`, { id: folder.id });
  const mine = listed.data?.folder?.files?.find((f) => f.id === doomed.id);
  ok(
    mine?.jobs?.length === 2 && mine.jobs[0].id === queuedToo.data?.enqueueJob?.id && mine.jobs[1].id === q.data?.enqueueJob?.id,
    'MediaFile.jobs lists the newest job first',
    JSON.stringify(mine?.jobs?.map((j) => j.id) ?? listed.errors),
  );
  ok(mine?.currentJob?.id === queuedToo.data?.enqueueJob?.id, 'MediaFile.currentJob is the newest unfinished job', JSON.stringify(mine?.currentJob));
  const job = await claimOne(w);
  ok((await output(w, job, randomBytes(800))).status === 200, 'output before the trash');
  const key = (await jobRow(job.id)).output_key;
  const t = await gql(editor.token, `mutation { moveToTrash(fileId:"${doomed.id}") }`);
  ok(t.data?.moveToTrash === true, 'trash the file', JSON.stringify(t.errors ?? ''));
  const row = await jobRow(q.data.enqueueJob.id);
  ok(row.status === 'cancelled' && row.error === 'file trashed', 'trashing cancels the claimed job with "file trashed"', JSON.stringify(row));
  const qrow = queuedToo.data?.enqueueJob?.id ? await jobRow(queuedToo.data.enqueueJob.id) : null;
  ok(qrow === null || (qrow.status === 'cancelled' && qrow.error === 'file trashed'), 'trashing cancels queued jobs too', JSON.stringify(qrow ?? queuedToo.errors));
  ok(!(await objectExists(key)), 'the cancelled job output is deleted');
  const done = await complete(w, job);
  ok(done.status === 409 && done.json?.code === 'FILE_GONE', 'complete for a trashed file 409 FILE_GONE', `${done.status} ${done.json?.code}`);
  ok((await sql('SELECT 1 FROM processed_versions WHERE job_id = $1', [job.id])).length === 0, 'no processed version for a trashed file');
  const c = await gql(editor.token, 'mutation($id: ID!){ cancelJob(id:$id){ id } }', { id: job.id });
  ok(code(c) === 'NOT_FOUND', 'cancelJob on a trashed file answers NOT_FOUND', JSON.stringify(c.errors ?? c.data));
  const trashedJob = await gql(editor.token, JOB, { id: job.id });
  ok(trashedJob.data && trashedJob.data.pipelineJob === null && !trashedJob.errors, 'pipelineJob of a trashed file is null', JSON.stringify(trashedJob));

  // Purge of a file whose job holds an uploaded output: object and job row go.
  const gone = await upload(`purge-${RUN}.mp4`);
  const pq = await enqueue(gone.id, k);
  const pj = await claimOne(w);
  ok(pj.id === pq.data.enqueueJob.id, 'claim the job of the file to purge');
  await output(w, pj, randomBytes(900));
  const pkey = (await jobRow(pj.id)).output_key;
  ok(pkey && (await objectExists(pkey)), 'its output is stored', pkey);
  // Mark the file trashed in the database (the GraphQL trash would cancel the job first), then purge it.
  await sql('UPDATE media_files SET "trashedAt" = now() WHERE id = $1', [gone.id]);
  const purge = await gql(sa.token, `mutation { permanentDelete(fileId:"${gone.id}") }`);
  ok(purge.data?.permanentDelete === true, 'purge the file', JSON.stringify(purge.errors ?? ''));
  ok(!(await objectExists(pkey)), 'the purge deletes the job output object');
  ok((await sql('SELECT 1 FROM pipeline_jobs WHERE id = $1', [pj.id])).length === 0, 'the purge deletes the job row');
  const late = await complete(w, pj);
  ok([404, 409].includes(late.status) && ['JOB_NOT_FOUND', 'FILE_GONE'].includes(late.json?.code), 'complete after the purge answers 404 or FILE_GONE, never 500', `${late.status} ${late.json?.code}`);
}

/* ---------------- currentJob after a job finished (Story 5.4) ---------------- */
{
  const k = kind('current');
  const w = await register([k]);
  const cur = async (id) =>
    ((await gql(editor.token, 'query($id: ID!){ folder(id:$id){ files { id currentJob { id state } } } }', { id: folder.id })).data?.folder?.files ?? []).find((x) => x.id === id)?.currentJob ?? null;
  const failedFile = await upload(`current-failed-${RUN}.mp4`);
  await enqueue(failedFile.id, k);
  const fj = await claimOne(w);
  await failJob(w, fj, 'e2e current', false);
  ok((await cur(failedFile.id))?.state === 'failed', 'currentJob: a recent failure shows when nothing is open');
  // Timestamps are stored as UTC without a zone (as Prisma writes them), whatever the session zone.
  await sql("UPDATE pipeline_jobs SET finished_at = (now() AT TIME ZONE 'UTC') - interval '25 hours' WHERE id = $1", [fj.id]);
  ok((await cur(failedFile.id)) === null, 'currentJob: a failure older than 24 h is not shown');
  const doneFile = await upload(`current-done-${RUN}.mp4`);
  await enqueue(doneFile.id, k);
  const dj = await claimOne(w);
  await output(w, dj, randomBytes(500));
  ok((await complete(w, dj)).status === 200, 'a job for currentJob completes');
  ok((await cur(doneFile.id)) === null, 'currentJob: a done job is not shown');
}

/* ---------------- status page figures ---------------- */
{
  // A kind whose only worker is revoked: a new job waits for a worker.
  const lonely = kind('lonely');
  const lw = await register([lonely]);
  await gql(sa.token, 'mutation($id: ID!){ revokeWorker(id:$id){ id } }', { id: lw.id });
  const figures = async () => (await (await fetch(`${B}/api/v1/status`, { headers: { authorization: `Bearer ${sa.token}` } })).json()).jobs;
  const before = await figures();
  const lonelyFile = await upload(`lonely-${RUN}.mp4`);
  const lq = await enqueue(lonelyFile.id, lonely);
  const after = await figures();
  ok(
    after.waitingForWorker === before.waitingForWorker + 1 && after.queued === before.queued,
    'status: a job of a kind without a live worker counts as waiting for worker, not queued',
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
  );
  await gql(editor.token, 'mutation($id: ID!){ cancelJob(id:$id){ id } }', { id: lq.data?.enqueueJob?.id });

  const r = await fetch(`${B}/api/v1/status`, { headers: { authorization: `Bearer ${sa.token}` } });
  const body = await r.json().catch(() => ({}));
  ok(r.status === 200 && Number.isInteger(body.workers) && body.workers >= 1 && Number.isInteger(body.queuedJobs), 'status reports live workers and queued jobs', JSON.stringify({ workers: body.workers, queuedJobs: body.queuedJobs }));
  const states = ['queued', 'waitingForWorker', 'claimed', 'running', 'done24h', 'failed24h', 'cancelled24h'];
  ok(body.jobs && states.every((k) => Number.isInteger(body.jobs[k])) && body.jobs.cancelled24h >= 1, 'status reports queue figures by state', JSON.stringify(body.jobs));
  const ws = await gql(sa.token, '{ pipelineWorkers { id name version kinds live lastSeen } }');
  ok(ws.data?.pipelineWorkers?.some((x) => x.live && x.kinds.length), 'the status page lists workers (name, version, kinds, live, last seen)');
  const r2 = await fetch(`${B}/api/v1/status`, { headers: { authorization: `Bearer ${editor.token}` } });
  ok(r2.status === 404, 'status for anyone but a super admin 404', r2.status);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
