// Story 7.4: backup and restore rehearsal (docs/content/docs/backup.mdx). NOT part of `npm test`.
//
// Two halves around the documented procedure, which the CI docker job runs
// between them (pg_dump, copy ./data/media, `docker compose down -v`, restore):
//
//   node scripts/e2e-backup.mjs snapshot <state.json>   uploads a synthetic file into a new
//                                                       project, downloads it, writes the facts
//   node scripts/e2e-backup.mjs verify <state.json>     after the restore: the same account signs
//                                                       in, the project is there and the file
//                                                       downloads with the same bytes
//
// E2E_BASE_URL (default http://localhost:3005); E2E_EMAIL (comma-separated
// list tried in order, default superadmin@example.com) and E2E_PASSWORD
// (default shotstash-dev, the dev seed). Localhost only; writes test data.
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const B = process.env.E2E_BASE_URL || 'http://localhost:3005';
if (!LOCAL.has(new URL(B).hostname)) {
  console.error(`e2e:backup refuses to run: base URL ${B} is not localhost.`);
  process.exit(2);
}
const [mode, statePath] = process.argv.slice(2);
if (!['snapshot', 'verify'].includes(mode) || !statePath) {
  console.error('usage: node scripts/e2e-backup.mjs snapshot|verify <state.json>');
  process.exit(2);
}

let fails = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label} ${extra}`);
  if (!cond) fails++;
};

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
      return { email: email.trim(), token: body.token, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
    }
  }
  return null;
}

async function download(cookie, fileId) {
  const r = await fetch(`${B}/media/d/${fileId}`, { headers: { cookie } });
  const hash = createHash('md5');
  let size = 0;
  if (r.body) {
    for await (const chunk of r.body) {
      hash.update(chunk);
      size += chunk.length;
    }
  }
  return { status: r.status, size, md5: hash.digest('hex') };
}

if (mode === 'snapshot') {
  const session = await login();
  ok(session, 'signs in before the backup');
  if (!session) process.exit(1);
  const { token, cookie } = session;

  const run = randomBytes(3).toString('hex');
  const proj = await gql(token, 'mutation($i: CreateProjectInput!){ createProject(input:$i){ id title } }', {
    i: { title: `Backup rehearsal ${run}` },
  });
  const project = proj.data?.createProject;
  const folder = await gql(token, 'mutation($p: ID!, $n: String!){ createFolder(projectId:$p, name:$n){ id } }', {
    p: project?.id,
    n: 'Before the backup',
  });
  const folderId = folder.data?.createFolder?.id;
  ok(project?.id && folderId, 'project and section created', JSON.stringify(proj.errors ?? folder.errors ?? ''));

  // 20 MiB of deterministic bytes: more than one 16 MiB part.
  const SIZE = 20 * 1024 * 1024;
  const bytes = createCipheriv('aes-128-ctr', randomBytes(16), Buffer.alloc(16)).update(Buffer.alloc(SIZE));
  const md5 = createHash('md5').update(bytes).digest('hex');
  const init = await gql(token, 'mutation($i: InitiateUploadInput!){ initiateUpload(input:$i){ id fileId partSize partCount } }', {
    i: { filename: `rehearsal-${run}.bin`, totalSize: SIZE, projectId: project?.id, folderId },
  });
  const upload = init.data?.initiateUpload;
  ok(upload?.id, 'upload started', JSON.stringify(init.errors ?? ''));
  for (let n = 1; n <= (upload?.partCount ?? 0); n++) {
    const part = bytes.subarray((n - 1) * upload.partSize, n * upload.partSize);
    const r = await fetch(`${B}/api/v1/uploads/${upload.id}/parts/${n}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-md5': createHash('md5').update(part).digest('base64') },
      body: part,
    });
    ok(r.status === 200, `part ${n} of ${upload.partCount} stored`, r.status === 200 ? '' : await r.text());
  }
  const done = await gql(token, 'mutation($s: ID!, $m: String){ completeUpload(sessionId:$s, md5Checksum:$m){ id md5Checksum } }', {
    s: upload?.id,
    m: md5,
  });
  ok(done.data?.completeUpload?.md5Checksum === md5, 'upload completed with the right MD5', JSON.stringify(done.errors ?? ''));

  const before = await download(cookie, upload?.fileId);
  ok(before.status === 200 && before.md5 === md5 && before.size === SIZE, 'downloads before the backup', `${before.status} ${before.size}`);

  writeFileSync(
    statePath,
    JSON.stringify({ email: session.email, projectId: project?.id, title: project?.title, fileId: upload?.fileId, md5, size: SIZE }, null, 2),
  );
} else {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const session = await login();
  ok(session, 'signs in after the restore');
  if (!session) process.exit(1);
  ok(session.email === state.email, 'with the same account', session.email);

  const p = await gql(session.token, 'query($id: ID!){ project(id:$id){ id title } }', { id: state.projectId });
  ok(p.data?.project?.title === state.title, 'the project is back', JSON.stringify(p.errors ?? p.data?.project ?? null));

  const after = await download(session.cookie, state.fileId);
  ok(after.status === 200 && after.size === state.size && after.md5 === state.md5, 'the file downloads with the same bytes', `${after.status} ${after.size} ${after.md5}`);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
