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
import { existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

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

const manifest = (kinds, extra = {}) => ({ name: 'e2e-worker', version: '0.0.1', kinds, contract: 1, ...extra });

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

async function register(kinds) {
  const r = await call('POST', 'workers/register', { bootstrap: BOOTSTRAP, body: { manifest: manifest(kinds) } });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${r.buf.toString()}`);
  return { id: r.json.workerId, token: r.json.token, kinds };
}
const next = (w) => call('POST', 'jobs/next', { token: w.token, body: {} });
const progress = (w, job, pct, claim = job.claimToken) => call('POST', `jobs/${job.id}/progress`, { token: w.token, claim, body: { progress: pct } });
const output = (w, job, buf, claim = job.claimToken) =>
  call('PUT', `jobs/${job.id}/output`, { token: w.token, claim, body: buf, headers: { 'content-type': 'video/mp4', 'x-output-ext': 'mp4' } });
const complete = (w, job, claim = job.claimToken) => call('POST', `jobs/${job.id}/complete`, { token: w.token, claim, body: {} });
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

const jobRow = async (id) => (await sql('SELECT status::text AS status, attempts, claimed_by, claim_token, output_key, error FROM pipeline_jobs WHERE id = $1', [id]))[0];
const expire = (id) => sql("UPDATE pipeline_jobs SET heartbeat_at = now() - interval '1 hour' WHERE id = $1", [id]);

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
async function upload(name) {
  const buf = Buffer.concat([Buffer.from('000000186674797069736f6d0000020069736f6d6d703431', 'hex'), randomBytes(20000)]);
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
  ok(!/files\/|storage|s3|secret/i.test(JSON.stringify(winner.json.job.input)), 'the claim carries no storage key or credential', JSON.stringify(winner.json.job.input));
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
    if (attempt < 3) ok(row && !row.claimed_by && !row.claim_token, 'the expired claim is cleared');
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

/* ---------------- status page figures ---------------- */
{
  const r = await fetch(`${B}/api/v1/status`, { headers: { authorization: `Bearer ${sa.token}` } });
  const body = await r.json().catch(() => ({}));
  ok(r.status === 200 && Number.isInteger(body.workers) && body.workers >= 1 && Number.isInteger(body.queuedJobs), 'status reports live workers and queued jobs', JSON.stringify({ workers: body.workers, queuedJobs: body.queuedJobs }));
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
