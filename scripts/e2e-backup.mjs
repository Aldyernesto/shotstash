// Story 7.4: backup and restore rehearsal (docs/content/docs/backup.mdx). NOT part of `npm test`.
//
// Two halves around the documented procedure, which the CI docker job runs
// between them (pg_dump, copy ./data/media, `docker compose down -v`, restore):
//
//   node scripts/e2e-backup.mjs snapshot <state.json>   uploads a synthetic file and a generated
//                                                       PNG into a new project, waits for the
//                                                       thumbnail, creates a public share link,
//                                                       writes the facts
//   node scripts/e2e-backup.mjs verify <state.json>     after the restore: the same account signs
//                                                       in, the project is there, the file
//                                                       downloads with the same bytes, the
//                                                       thumbnail is served and the share link
//                                                       still opens (its signed URLs need the
//                                                       same secrets, so .env was restored too)
//
// E2E_BASE_URL (default http://localhost:3005); E2E_EMAIL (comma-separated
// list tried in order, default superadmin@example.com) and E2E_PASSWORD
// (default shotstash-dev, the dev seed). Localhost only; writes test data.
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

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
    if (!r.ok) continue;
    const body = await r.json().catch(() => ({}));
    if (!body.token) continue;
    const media = r.headers.getSetCookie().find((c) => c.startsWith('shotstash_session='));
    return { email: email.trim(), token: body.token, cookie: media ? media.split(';')[0] : '' };
  }
  return null;
}

/** A 64x64 RGB gradient as a PNG, made without dependencies. */
function png() {
  const W = 64;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(W, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows = [];
  for (let y = 0; y < W; y++) {
    const row = Buffer.alloc(1 + W * 3);
    for (let x = 0; x < W; x++) row.set([x * 4, y * 4, 160], 1 + x * 3);
    rows.push(row);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

async function uploadBytes(token, projectId, folderId, filename, bytes) {
  const md5 = createHash('md5').update(bytes).digest('hex');
  const init = await gql(token, 'mutation($i: InitiateUploadInput!){ initiateUpload(input:$i){ id fileId partSize partCount } }', {
    i: { filename, totalSize: bytes.length, projectId, folderId },
  });
  const upload = init.data?.initiateUpload;
  ok(upload?.id, `upload of ${filename} started`, JSON.stringify(init.errors ?? ''));
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
  ok(done.data?.completeUpload?.md5Checksum === md5, `${filename} completed with the right MD5`, JSON.stringify(done.errors ?? ''));
  return { fileId: upload?.fileId, md5, size: bytes.length };
}

async function fetchMd5(url, headers = {}) {
  const r = await fetch(url.startsWith('http') ? url : `${B}${url}`, { headers });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, type: r.headers.get('content-type') || '', size: buf.length, md5: createHash('md5').update(buf).digest('hex') };
}

/** The first file of a public share link, with its signed URLs. */
async function shareFirstFile(slug) {
  const r = await fetch(`${B}/s/${slug}/items?offset=0&limit=12`);
  const body = r.ok ? await r.json() : null;
  return { status: r.status, file: body?.files?.[0] ?? null };
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
  const bin = await uploadBytes(token, project?.id, folderId, `rehearsal-${run}.bin`, bytes);
  const before = await download(cookie, bin.fileId);
  ok(before.status === 200 && before.md5 === bin.md5 && before.size === SIZE, 'downloads before the backup', `${before.status} ${before.size}`);

  // A picture: it gets a thumbnail, and a public share link of its section.
  const image = await uploadBytes(token, project?.id, folderId, `rehearsal-${run}.png`, png());
  let thumbUrl = null;
  for (let i = 0; i < 30 && !thumbUrl; i++) {
    const f = await gql(token, 'query($id: ID!){ folder(id:$id){ files { id thumbnailUrl } } }', { id: folderId });
    thumbUrl = f.data?.folder?.files?.find((x) => x.id === image.fileId)?.thumbnailUrl ?? null;
    if (!thumbUrl) await new Promise((r) => setTimeout(r, 1000));
  }
  const thumb = thumbUrl ? await fetchMd5(thumbUrl, { cookie }) : { status: 0, type: '' };
  ok(thumb.status === 200 && thumb.type.startsWith('image/'), 'thumbnail served before the backup', `${thumbUrl} ${thumb.status}`);
  const link = await gql(token, 'mutation($i: ShareLinkInput!){ createShareLink(input:$i){ slug } }', { i: { folderId, mode: 'PUBLIC' } });
  const slug = link.data?.createShareLink?.slug;
  const shared = slug ? await shareFirstFile(slug) : { status: 0 };
  const sharedBytes = shared.file?.downloadUrl ? await fetchMd5(shared.file.downloadUrl) : { status: 0 };
  ok(shared.status === 200 && sharedBytes.status === 200, 'share link opens before the backup', JSON.stringify(link.errors ?? shared.status));

  writeFileSync(
    statePath,
    JSON.stringify(
      { email: session.email, projectId: project?.id, title: project?.title, fileId: bin.fileId, md5: bin.md5, size: SIZE, thumbUrl, thumbMd5: thumb.md5, slug },
      null,
      2,
    ),
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

  const thumb = state.thumbUrl ? await fetchMd5(state.thumbUrl, { cookie: session.cookie }) : { status: 0 };
  ok(thumb.status === 200 && thumb.md5 === state.thumbMd5, 'the thumbnail is served with the same bytes', `${thumb.status}`);

  const shared = state.slug ? await shareFirstFile(state.slug) : { status: 0 };
  const sharedBytes = shared.file?.downloadUrl ? await fetchMd5(shared.file.downloadUrl) : { status: 0 };
  ok(shared.status === 200 && sharedBytes.status === 200, 'the share link from before the backup still opens and its signed URL works', `${shared.status} ${sharedBytes.status}`);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
