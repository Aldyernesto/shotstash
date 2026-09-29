// Story 4.3: interrupted upload harness. NOT part of `npm test`.
//
// Uploads a synthetic file (generated on the fly, never written to disk)
// through a local TCP proxy that cuts every open connection twice, the way
// a dropped Wi-Fi or a flaky mobile link does. After each cut the client
// behaves like a reloaded browser: it asks the server which parts it
// already has (uploadSession) and sends only the missing ones. The run
// passes when the upload completes, the server's MD5 check passes, the
// downloaded bytes hash to the same MD5 and only missing parts were re-sent.
//
//   npm run dev                          # or the Docker stack
//   npm run e2e:upload                   # 256 MiB by default
//   E2E_UPLOAD_MB=1024 npm run e2e:upload        # the CI run (1 GiB)
//   E2E_UPLOAD_MB=20480 npm run e2e:upload       # the documented 20 GiB manual run
//
// E2E_BASE_URL (default http://localhost:3005); E2E_EMAIL (comma-separated
// list tried in order, default superadmin@example.com) and E2E_PASSWORD
// (default shotstash-dev, the dev seed). Localhost only.
import 'dotenv/config';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const B = process.env.E2E_BASE_URL || 'http://localhost:3005';
const base = new URL(B);
if (!LOCAL.has(base.hostname)) {
  console.error(`e2e:upload refuses to run: base URL ${B} is not localhost.`);
  process.exit(2);
}
const MB = Number(process.env.E2E_UPLOAD_MB || 256);
const SIZE = Math.round(MB * 1024 * 1024);
const CUTS = [0.3, 0.65];
const PARALLEL = 3;
const TRIES = 5;

let fails = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label} ${extra}`);
  if (!cond) fails++;
};

/* ---------------- synthetic bytes ---------------- */

const SEED = randomBytes(16);
/** Deterministic bytes of part `n` (1-based): AES-CTR keystream, the same every time. */
function partBytes(n, partSize) {
  const start = (n - 1) * partSize;
  const len = Math.max(0, Math.min(partSize, SIZE - start));
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(n, 0);
  return createCipheriv('aes-128-ctr', SEED, iv).update(Buffer.alloc(len));
}

/* ---------------- API ---------------- */

async function gql(token, query, variables) {
  const r = await fetch(`${B}/api/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

async function login() {
  const password = process.env.E2E_PASSWORD || 'shotstash-dev';
  for (const email of (process.env.E2E_EMAIL || 'superadmin@example.com').split(',')) {
    const r = await fetch(`${B}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (r.ok) {
      const body = await r.json();
      return { token: body.token, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
    }
  }
  throw new Error('login failed: set E2E_EMAIL and E2E_PASSWORD');
}

/* ---------------- the cutting proxy ---------------- */

function startProxy(totalBytes) {
  const sockets = new Set();
  let forwarded = 0;
  let cuts = 0;
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(base.port || 80), base.hostname === 'localhost' ? '127.0.0.1' : base.hostname);
    sockets.add(client);
    sockets.add(upstream);
    const drop = () => {
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('close', drop);
    upstream.on('close', drop);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('data', (chunk) => {
      forwarded += chunk.length;
      if (cuts < CUTS.length && forwarded >= CUTS[cuts] * totalBytes) {
        cuts++;
        console.log(`  proxy: cutting ${sockets.size / 2} connection(s) at ${(forwarded / 1048576).toFixed(0)} MiB (cut ${cuts})`);
        for (const s of sockets) s.destroy();
        return;
      }
      if (!upstream.write(chunk)) client.pause();
    });
    upstream.on('drain', () => client.resume());
    upstream.pipe(client);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, cuts: () => cuts, close: () => server.close() })),
  );
}

function putPartVia(port, token, sessionId, n, bytes) {
  const md5 = createHash('md5').update(bytes).digest('base64');
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'PUT',
        path: `/api/v1/uploads/${sessionId}/parts/${n}`,
        headers: { authorization: `Bearer ${token}`, 'content-md5': md5, 'content-length': bytes.length, host: base.host },
        agent: false,
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => (res.statusCode === 200 ? resolve() : reject(Object.assign(new Error(`HTTP ${res.statusCode} ${text}`), { status: res.statusCode }))));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(bytes);
  });
}

/* ---------------- run ---------------- */

const started = Date.now();
const { token, cookie } = await login();
const RUN = Date.now().toString(36);
const proj = await gql(token, 'mutation($i: CreateProjectInput!){ createProject(input:$i){ id } }', { i: { title: `Upload harness ${RUN}` } });
const projectId = proj.data?.createProject?.id;
const folder = await gql(token, 'mutation($p: ID!, $n: String!){ createFolder(projectId:$p, name:$n){ id } }', { p: projectId, n: `Harness ${RUN}` });
const folderId = folder.data?.createFolder?.id;
ok(projectId && folderId, 'project and Section for the harness', JSON.stringify(proj.errors ?? folder.errors ?? ''));

const init = await gql(
  token,
  'mutation($i: InitiateUploadInput!){ initiateUpload(input:$i){ id fileId partSize partCount } }',
  { i: { filename: `harness-${RUN}.bin`, totalSize: SIZE, projectId, folderId } },
);
const session = init.data?.initiateUpload;
ok(session?.id && session.partCount === Math.max(1, Math.ceil(SIZE / session.partSize)), 'initiate answers part size and count', JSON.stringify(init.errors ?? session));
console.log(`  ${MB} MiB in ${session.partCount} parts of ${session.partSize / 1048576} MiB`);

// Whole-file MD5 in part order (the client computes it while reading).
const whole = createHash('md5');
for (let n = 1; n <= session.partCount; n++) whole.update(partBytes(n, session.partSize));
const md5 = whole.digest('hex');

const proxy = await startProxy(SIZE);
let sentParts = 0;
let rounds = 0;
for (;;) {
  rounds++;
  const s = await gql(token, 'query($id: ID!){ uploadSession(id:$id){ status confirmedParts partCount } }', { id: session.id });
  const have = new Set(s.data.uploadSession.confirmedParts);
  const missing = [];
  for (let n = 1; n <= session.partCount; n++) if (!have.has(n)) missing.push(n);
  if (!missing.length) break;
  if (rounds > 1) console.log(`  resume: ${have.size} parts on the server, sending the ${missing.length} missing`);
  let cut = false;
  const queue = [...missing];
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (queue.length && !cut) {
        const n = queue.shift();
        const bytes = partBytes(n, session.partSize);
        for (let attempt = 0; ; attempt++) {
          try {
            sentParts++;
            await putPartVia(proxy.port, token, session.id, n, bytes);
            break;
          } catch (err) {
            // A dropped connection: stop like a reloaded page and resume.
            if (!err.status) {
              cut = true;
              return;
            }
            if (attempt >= TRIES - 1 || err.status < 500) throw err;
            await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          }
        }
      }
    }),
  );
  if (rounds > 10) throw new Error('too many rounds');
  if (cut) await new Promise((r) => setTimeout(r, 300));
}
proxy.close();
ok(proxy.cuts() === CUTS.length, `the proxy cut the connections ${CUTS.length} times`, proxy.cuts());
ok(rounds === CUTS.length + 1 || rounds === CUTS.length + 2, 'the client resumed after every cut', `${rounds} rounds`);
ok(sentParts <= session.partCount + CUTS.length * PARALLEL, 'only missing parts were sent again', `${sentParts} sends for ${session.partCount} parts`);

const done = await gql(token, 'mutation($s: ID!, $m: String){ completeUpload(sessionId:$s, md5Checksum:$m){ id md5Checksum size } }', { s: session.id, m: md5 });
ok(done.data?.completeUpload?.md5Checksum === md5, 'completes with the right MD5', JSON.stringify(done.errors ?? ''));
ok(Number(done.data?.completeUpload?.size) === SIZE, 'size recorded', done.data?.completeUpload?.size);

// Download (not through the proxy) and hash.
const dl = await fetch(`${B}/media/d/${session.fileId}`, { headers: { cookie } });
const back = createHash('md5');
let bytes = 0;
for await (const chunk of dl.body) {
  back.update(chunk);
  bytes += chunk.length;
}
ok(dl.status === 200 && bytes === SIZE && back.digest('hex') === md5, 'downloaded bytes hash to the same MD5', `${dl.status} ${bytes}`);

// Clean up: the harness project goes away with its bytes.
await gql(token, 'mutation($id: ID!){ deleteProject(id:$id) }', { id: projectId });
console.log(`  ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
