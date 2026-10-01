// Story 5.3: the reference worker end to end. Uploads a sample video,
// queues `shotstash/proxy-720p`, waits for the running worker to finish it
// and downloads the processed version. Runs in the CI docker job against the
// compose stack (the worker container does the transcode).
//
//   E2E_SAMPLE=sample.mp4 E2E_OUT=proxy.mp4 node scripts/e2e-worker.mjs
//
// E2E_BASE_URL (default http://localhost:3005), E2E_EMAIL and E2E_PASSWORD
// (default the seeded editor), E2E_TIMEOUT_SECONDS (default 300). Writes the
// proxy to E2E_OUT and prints its version as JSON on the last line. Refuses
// to run unless the base URL points at localhost.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const B = process.env.E2E_BASE_URL || 'http://localhost:3005';
let host = '';
try {
  host = new URL(B).hostname;
} catch {
  // reported below
}
if (!LOCAL.has(host)) {
  console.error(`e2e-worker refuses to run: base URL ${B} is not localhost.`);
  process.exit(2);
}
const SAMPLE = process.env.E2E_SAMPLE;
const OUT = process.env.E2E_OUT;
if (!SAMPLE || !OUT) {
  console.error('Set E2E_SAMPLE (a video to upload) and E2E_OUT (where the proxy goes).');
  process.exit(2);
}
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_SECONDS || 300) * 1000;
const RUN = Date.now().toString(36);

async function gql(token, query, variables) {
  const r = await fetch(`${B}/api/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = await r.json();
  if (body.errors) throw new Error(`${query.slice(0, 40)}: ${JSON.stringify(body.errors)}`);
  return body.data;
}

// E2E_EMAIL may list several accounts, tried in order: in CI, e2e:setup
// races two owners and either one may win, so the step passes both.
let login;
let session;
for (const email of (process.env.E2E_EMAIL || 'editor@example.com').split(',')) {
  login = await fetch(`${B}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password: process.env.E2E_PASSWORD || 'shotstash-dev' }),
  });
  session = await login.json().catch(() => null);
  if (login.status === 200 && session) break;
  console.error(`login as ${email.trim()}: ${login.status} ${session?.code ?? ''}`);
}
if (login.status !== 200 || !session) throw new Error(`login failed: ${login.status} ${session?.code ?? ''}`);
const token = session.token;
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

const project = (await gql(token, 'mutation($i: CreateProjectInput!){ createProject(input:$i){ id } }', { i: { title: `Worker check ${RUN}` } })).createProject;
const folder = (await gql(token, 'mutation($p: ID!, $n: String!){ createFolder(projectId:$p, name:$n){ id } }', { p: project.id, n: 'Clips' })).createFolder;

const buf = readFileSync(SAMPLE);
const init = (
  await gql(token, 'mutation($i: InitiateUploadInput!){ initiateUpload(input:$i){ id partSize partCount } }', {
    i: { filename: path.basename(SAMPLE), totalSize: buf.length, projectId: project.id, folderId: folder.id },
  })
).initiateUpload;
for (let n = 1; n <= init.partCount; n++) {
  const part = buf.subarray((n - 1) * init.partSize, n * init.partSize);
  const r = await fetch(`${B}/api/v1/uploads/${init.id}/parts/${n}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-md5': createHash('md5').update(part).digest('base64'), 'content-type': 'application/octet-stream' },
    body: part,
  });
  if (r.status !== 200) throw new Error(`part ${n}: ${r.status}`);
}
const file = (
  await gql(token, 'mutation($s: ID!, $m: String){ completeUpload(sessionId:$s, md5Checksum:$m){ id mimeType } }', {
    s: init.id,
    m: createHash('md5').update(buf).digest('hex'),
  })
).completeUpload;
console.log(`uploaded ${file.id} (${file.mimeType}, ${buf.length} bytes)`);

const job = (await gql(token, 'mutation($f: ID!){ enqueueJob(fileId:$f, kind:"shotstash/proxy-720p"){ id state } }', { f: file.id })).enqueueJob;
console.log(`queued job ${job.id} (${job.state})`);

const end = Date.now() + TIMEOUT_MS;
let last = '';
let done = null;
while (Date.now() < end) {
  const j = (
    await gql(token, 'query($id: ID!){ pipelineJob(id:$id){ status state progress attempts error outputVersion { id kind mimeType size downloadUrl } } }', { id: job.id })
  ).pipelineJob;
  const line = `${j.state} ${j.progress}% attempt ${j.attempts}`;
  if (line !== last) console.log(line);
  last = line;
  if (j.status === 'done') {
    done = j;
    break;
  }
  if (j.status === 'failed' || j.status === 'cancelled') throw new Error(`job ${j.status}: ${j.error}`);
  await new Promise((r) => setTimeout(r, 2000));
}
if (!done) throw new Error(`job not done within ${TIMEOUT_MS / 1000} s (last: ${last})`);

const v = done.outputVersion;
if (!v || v.kind !== 'shotstash/proxy-720p' || v.mimeType !== 'video/mp4') throw new Error(`unexpected version ${JSON.stringify(v)}`);
const media = await fetch(`${B}${v.downloadUrl}`, { headers: { cookie } });
if (media.status !== 200) throw new Error(`${v.downloadUrl}: ${media.status}`);
const bytes = Buffer.from(await media.arrayBuffer());
writeFileSync(OUT, bytes);
console.log(JSON.stringify({ versionId: v.id, kind: v.kind, mimeType: v.mimeType, size: bytes.length, status: media.status }));
