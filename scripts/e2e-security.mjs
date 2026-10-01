// Local end-to-end check of Stories 2.1-2.8 (route auth, cookie media,
// signed shares, permissions, holes, limits, headers, health, trash
// lifecycle), 4.1-4.3 (storage keys, parts, resume, dedup, cancel,
// expiry) and 4.4-4.6 (versioned thumbnails, processed versions, Trash
// thumbnails, STORE ZIPs, inactive links 404). Runs in the CI e2e job.
//
//   npm run dev:db; npx prisma migrate deploy; npx tsx prisma/seed.ts
//   EMAIL_TRANSPORT=log npm run dev   # reset-limit rows are skipped without an email transport
//   npm run e2e:security            # E2E_BASE_URL defaults to http://localhost:3005
//
// Refuses to run unless the base URL and DATABASE_URL both point at
// localhost / 127.0.0.1. It creates uploads, share links and a trashed and
// purged file in that database. Login limits (10 per 15 min per IP and per
// email) mean a second run within 15 minutes needs a server restart.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import pg from 'pg';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const B = process.env.E2E_BASE_URL || 'http://localhost:3005';
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
if (!LOCAL.has(hostOf(B))) {
  console.error(`e2e:security refuses to run: base URL ${B} is not localhost.`);
  process.exit(2);
}
if (!LOCAL.has(hostOf(process.env.DATABASE_URL || ''))) {
  console.error('e2e:security refuses to run: DATABASE_URL does not point at localhost.');
  process.exit(2);
}

// Every upload gets unique bytes: identical bytes in one project are a
// duplicate (Story 4.3). The clip starts with an ISO media header, so its
// sniffed type is video/mp4.
const JPEG = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#808080' } }).jpeg().toBuffer();
const FIXTURES = {
  'clip.mp4': () => Buffer.concat([Buffer.from('000000186674797069736f6d0000020069736f6d6d703431', 'hex'), randomBytes(17180)]),
  'photo.jpg': () => Buffer.concat([JPEG, randomBytes(16)]),
};
const md5hex = (buf) => createHash('md5').update(buf).digest('hex');
const md5b64 = (buf) => createHash('md5').update(buf).digest('base64');
const putPart = (tok, sessionId, n, buf, md5 = md5b64(buf)) =>
  fetch(`${B}/api/v1/uploads/${sessionId}/parts/${n}`, {
    method: 'PUT',
    headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), 'content-md5': md5, 'content-type': 'application/octet-stream' },
    body: buf,
  });
const INIT = 'mutation($i: InitiateUploadInput!){ initiateUpload(input:$i){ id fileId partSize partCount } }';
const COMPLETE = 'mutation($s: ID!, $m: String){ completeUpload(sessionId:$s, md5Checksum:$m){ id thumbnailUrl downloadUrl md5Checksum duplicateOf } }';

let fails = 0;
const ok = (cond, label, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!cond) fails++; };

async function login(email, password = 'shotstash-dev') {
  const r = await fetch(`${B}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = await r.json().catch(() => null);
  const sc = r.headers.get('set-cookie') || '';
  const cookie = sc.split(';')[0];
  return { status: r.status, token: body?.token, user: body?.user, sc, cookie };
}
async function gql(token, query, variables) {
  const r = await fetch(`${B}/api/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  return r.json();
}
const code = (res) => res.errors?.[0]?.extensions?.code;
/**
 * Which inactive-link message the 404 page renders: the `kind` prop of the
 * ShareInvalid element in the page's server payload (the page also carries
 * the whole message bundle, so matching message text would prove nothing).
 */
function inactiveKind(html) {
  const m = /\{\\?"kind\\?":\\?"([a-z-]+)\\?"\}/.exec(html);
  return m ? m[1] : null;
}
/** Central directory of a ZIP (ZIP64 sizes are not needed for these small archives). */
function zipEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count && buf.readUInt32LE(off) === 0x02014b50; i++) {
    const nameLen = buf.readUInt16LE(off + 28);
    out.push({
      method: buf.readUInt16LE(off + 10),
      compressed: buf.readUInt32LE(off + 20),
      size: buf.readUInt32LE(off + 24),
      name: buf.subarray(off + 46, off + 46 + nameLen).toString('utf8'),
    });
    off += 46 + nameLen + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
  }
  return out.filter((e) => !e.name.endsWith('/'));
}
/** Per-run suffix so rows that count per user or per email can run again. */
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

const sa = await login('superadmin@example.com');
ok(sa.status === 200 && sa.token, 'login REST 200 + token');
ok(/HttpOnly/i.test(sa.sc) && /SameSite=Lax/i.test(sa.sc) && /Path=\/media/i.test(sa.sc) && !/Secure/i.test(sa.sc), 'cookie attributes', sa.sc);
const bad = await login('superadmin@example.com', 'wrong-password');
ok(bad.status === 401, 'wrong password 401');

// ---- Story 3.1: stable login error codes (GraphQL). The login limit is 10
// per 15 min per IP; the rows below that spend it are balanced by reading
// counts from the database and creating test accounts as the super admin.
const gqlLogin = (email, password) =>
  gql(null, 'mutation($e:String!,$p:String!){ login(email:$e, password:$p) { success errorCode } }', { e: email, p: password });
const badGql = await gqlLogin('superadmin@example.com', 'wrong-password');
ok(badGql.data?.login?.success === false && badGql.data.login.errorCode === 'INVALID_CREDENTIALS', 'GraphQL login wrong password INVALID_CREDENTIALS', JSON.stringify(badGql));
{
  // A Google-only account has no password; create one when the seed has none.
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(
    `INSERT INTO users (id, name, email, "passwordHash", role, "accountStatus", "updatedAt")
     VALUES ($1, 'Google Only', 'google-only@example.com', NULL, 'EDITOR', 'ACTIVE', now())
     ON CONFLICT (email) DO UPDATE SET "passwordHash" = NULL`,
    [randomUUID()],
  );
  await db.end();
}
const googleOnly = await gqlLogin('google-only@example.com', 'any-password-123');
ok(googleOnly.data?.login?.success === false && googleOnly.data.login.errorCode === 'GOOGLE_ONLY_ACCOUNT', 'GraphQL login on a Google-only account GOOGLE_ONLY_ACCOUNT', JSON.stringify(googleOnly));
const admin = await login('admin@example.com');
const editor = await login('editor@example.com');
const viewer = await login('viewer@example.com');
const crew = await login('crew@example.com');

const me = await gql(editor.token, '{ me { id role permissions } }');
ok(me.data.me.permissions.includes('upload') && !me.data.me.permissions.includes('trash.purge'), 'editor permissions', JSON.stringify(me.data.me.permissions));
const vme = await gql(viewer.token, '{ me { permissions } }');
ok(!vme.data.me.permissions.includes('upload'), 'viewer permissions', JSON.stringify(vme.data.me.permissions));

// ---- upload as editor
const proj = await gql(editor.token, '{ projects { id title folders { id name } } }');
const project = proj.data.projects.find((p) => p.title === 'Sample project');
const folder = project.folders[0];
/** Upload of given bytes into any Project and Section (initiate, parts, complete). */
async function uploadTo(tok, name, buf, projectId, folderId) {
  const init = await gql(tok, INIT, { i: { filename: name, totalSize: buf.length, projectId, folderId } });
  if (init.errors) return { init, done: init };
  const s = init.data.initiateUpload;
  let pr;
  for (let n = 1; n <= s.partCount; n++) pr = await putPart(tok, s.id, n, buf.subarray((n - 1) * s.partSize, n * s.partSize));
  const done = await gql(tok, COMPLETE, { s: s.id, m: md5hex(buf) });
  return { init, session: s, partStatus: pr?.status, done, buf };
}
async function upload(tok, path, name, folderId = folder.id, buf = FIXTURES[path]()) {
  const init = await gql(tok, INIT, { i: { filename: name, totalSize: buf.length, projectId: project.id, folderId } });
  if (init.errors) return { init };
  const s = init.data.initiateUpload;
  const pr = await putPart(tok, s.id, 1, buf);
  const done = await gql(tok, COMPLETE, { s: s.id, m: md5hex(buf) });
  return { init, session: s, partStatus: pr.status, done, buf };
}
const up1 = await upload(editor.token, 'clip.mp4', 'clip.mp4');
ok(up1.partStatus === 200 && up1.done.data?.completeUpload?.id, 'editor uploads video', JSON.stringify(up1.done.errors ?? ''));
ok(up1.session.partSize === 16 * 1024 * 1024 && up1.session.partCount === 1, 'server decides the part size (16 MiB) and count', JSON.stringify(up1.session));
const up2 = await upload(editor.token, 'photo.jpg', 'photo.jpg');
ok(up2.done.data?.completeUpload?.id, 'editor uploads photo');
const vid = up1.done.data.completeUpload;
const pic = up2.done.data.completeUpload;
ok(!/token=/.test(JSON.stringify([vid, pic])), 'no token in media URLs', JSON.stringify(vid));
const vup = await upload(viewer.token, 'photo.jpg', 'v.jpg');
ok(code(vup.init) === 'FORBIDDEN', 'viewer initiateUpload FORBIDDEN');

// ---- Stories 4.1-4.3: parts, resume, checksums, dedup, cancel, expiry
// One short-lived connection per query: the PGlite dev database serves one
// connection at a time, so a client held open would block the server.
const db43 = {
  async query(text, params) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      return await c.query(text, params);
    } finally {
      await c.end();
    }
  },
};
{
  const row = (await db43.query('SELECT storage_key, status, "md5Checksum" FROM media_files WHERE id = $1', [vid.id])).rows[0];
  ok(row?.storage_key === `files/${vid.id}/original.mp4` && row.status === 'ready' && row.md5Checksum === md5hex(up1.buf), 'hierarchy-free key from the sniffed type, ready, MD5 of the bytes', JSON.stringify(row));
}
const init3 = await gql(editor.token, INIT, { i: { filename: 'x.jpg', totalSize: 10, projectId: project.id, folderId: folder.id } });
const sid = init3.data.initiateUpload.id;
let r = await putPart(null, sid, 1, Buffer.alloc(10));
ok(r.status === 401, 'part without session 401', r.status);
r = await putPart(crew.token, sid, 1, Buffer.alloc(10));
ok(r.status === 403, "part into another user's session 403", r.status);
r = await putPart(editor.token, sid, 1, Buffer.alloc(10), md5b64(Buffer.alloc(11)));
ok(r.status === 400 && (await r.json()).code === 'PART_CHECKSUM_MISMATCH', 'wrong part MD5 400 PART_CHECKSUM_MISMATCH', r.status);
r = await putPart(editor.token, sid, 1, Buffer.alloc(12));
ok(r.status === 400 && (await r.json()).code === 'PART_SIZE_MISMATCH', 'part longer than its size 400', r.status);
r = await putPart(editor.token, sid, 2, Buffer.alloc(10));
ok(r.status === 400 && (await r.json()).code === 'INVALID_PART_NUMBER', 'part number out of range 400', r.status);
r = await fetch(`${B}/api/v1/uploads/${sid}/parts/1`, { method: 'PUT', headers: { authorization: `Bearer ${editor.token}` }, body: Buffer.alloc(10) });
ok(r.status === 400 && (await r.json()).code === 'PART_CHECKSUM_REQUIRED', 'part without Content-MD5 400', r.status);
ok((await gql(viewer.token, `{ uploadSession(id:"${sid}") { id } }`)).errors, "viewer cannot read an upload session");
ok(code(await gql(crew.token, `{ uploadSession(id:"${sid}") { id } }`)) === 'FORBIDDEN', "another user's upload session FORBIDDEN");
// cancel: bytes and row go away, later parts are refused
ok((await gql(editor.token, `mutation { cancelUpload(sessionId:"${sid}") }`)).data?.cancelUpload === true, 'cancel an upload');
r = await putPart(editor.token, sid, 1, Buffer.alloc(10));
ok(r.status === 409 && (await r.json()).code === 'UPLOAD_SESSION_CLOSED', 'part after cancel 409', r.status);
ok((await db43.query('SELECT 1 FROM media_files WHERE id = $1', [init3.data.initiateUpload.fileId])).rowCount === 0, 'cancel removes the uploading row');
r = await fetch(`${B}/api/upload/chunk`, { method: 'POST', headers: { authorization: `Bearer ${editor.token}` } });
ok(r.status === 404, 'old chunk route is gone', r.status);

// resume: two parts, the second sent after asking what the server has
{
  const big = randomBytes(16 * 1024 * 1024 + 4321);
  const i = await gql(editor.token, INIT, { i: { filename: `resume-${RUN}.bin`, totalSize: big.length, projectId: project.id, folderId: folder.id } });
  const s = i.data.initiateUpload;
  ok(s.partCount === 2, 'a 16 MiB + 4 KiB file is two parts', s.partCount);
  const inProgress = await db43.query('SELECT status FROM media_files WHERE id = $1', [s.fileId]);
  ok(inProgress.rows[0]?.status === 'uploading', 'the file row exists as uploading from initiate on');
  const listed = await gql(editor.token, `{ folder(id:"${folder.id}") { files { id } } }`);
  ok(!listed.data.folder.files.some((f) => f.id === s.fileId), 'an uploading file is not listed');
  ok((await putPart(editor.token, s.id, 1, big.subarray(0, s.partSize))).status === 200, 'part 1 stored');
  ok((await putPart(editor.token, s.id, 1, big.subarray(0, s.partSize))).status === 200, 'part 1 again (idempotent)');
  const early = await gql(editor.token, COMPLETE, { s: s.id, m: md5hex(big) });
  ok(code(early) === 'MISSING_PARTS', 'completing with a part missing MISSING_PARTS', JSON.stringify(early.errors?.[0]?.extensions ?? ''));
  const state = await gql(editor.token, `{ uploadSession(id:"${s.id}") { status confirmedParts partCount } }`);
  ok(JSON.stringify(state.data?.uploadSession?.confirmedParts) === '[1]' && state.data.uploadSession.status === 'IN_PROGRESS', 'resume lists confirmed parts', JSON.stringify(state.data));
  ok((await putPart(editor.token, s.id, 2, big.subarray(s.partSize))).status === 200, 'only the missing part is sent');
  const fin = await gql(editor.token, COMPLETE, { s: s.id, m: md5hex(big) });
  ok(fin.data?.completeUpload?.md5Checksum === md5hex(big), 'resumed upload completes with the right MD5', JSON.stringify(fin.errors ?? ''));
  const again = await gql(editor.token, COMPLETE, { s: s.id, m: md5hex(big) });
  ok(again.data?.completeUpload?.id === s.fileId, 'completing twice answers the same file');
  r = await fetch(`${B}/media/d/${s.fileId}`, { headers: { cookie: editor.cookie, range: `bytes=${s.partSize - 5}-${s.partSize + 4}` } });
  const across = Buffer.from(await r.arrayBuffer());
  ok(r.status === 206 && across.equals(big.subarray(s.partSize - 5, s.partSize + 5)), 'Range across the part boundary', r.status);
}

// whole-file checksum mismatch: bytes and row removed
{
  const buf = randomBytes(2048);
  const i = await gql(editor.token, INIT, { i: { filename: `bad-${RUN}.bin`, totalSize: buf.length, projectId: project.id, folderId: folder.id } });
  const s = i.data.initiateUpload;
  await putPart(editor.token, s.id, 1, buf);
  const res = await gql(editor.token, COMPLETE, { s: s.id, m: md5hex(randomBytes(4)) });
  ok(code(res) === 'CHECKSUM_MISMATCH', 'wrong whole-file MD5 CHECKSUM_MISMATCH');
  ok((await db43.query('SELECT 1 FROM media_files WHERE id = $1', [s.fileId])).rowCount === 0, 'the damaged upload leaves no row');
}

// dedup: advisory check by name and size, then by MD5; initiate refuses; upload anyway; race
{
  const same = FIXTURES['photo.jpg']();
  const first = await upload(editor.token, 'photo.jpg', `dup-${RUN}.jpg`, folder.id, same);
  ok(first.done.data?.completeUpload?.id, 'first copy uploaded');
  const byName = await gql(editor.token, `query($p: ID!, $c: [DuplicateCandidateInput!]!){ checkDuplicates(projectId:$p, candidates:$c){ match existingFileId } }`, { p: project.id, c: [{ name: `dup-${RUN}.jpg`, size: same.length }, { name: 'other.jpg', size: 1 }] });
  ok(byName.data?.checkDuplicates?.length === 1 && byName.data.checkDuplicates[0].match === 'name', 'duplicate check by name and size', JSON.stringify(byName));
  const byMd5 = await gql(editor.token, `query($p: ID!, $c: [DuplicateCandidateInput!]!){ checkDuplicates(projectId:$p, candidates:$c){ match existingFileId } }`, { p: project.id, c: [{ name: 'renamed.jpg', size: same.length, md5: md5hex(same) }] });
  ok(byMd5.data?.checkDuplicates?.[0]?.match === 'exact' && byMd5.data.checkDuplicates[0].existingFileId === first.done.data.completeUpload.id, 'duplicate check by MD5 finds the same bytes');
  const refused = await gql(editor.token, INIT, { i: { filename: 'renamed.jpg', totalSize: same.length, projectId: project.id, folderId: folder.id, md5Checksum: md5hex(same) } });
  ok(code(refused) === 'DUPLICATE_FILE' && refused.errors[0].extensions.existingFileId === first.done.data.completeUpload.id, 'initiate with a known MD5 DUPLICATE_FILE (skip is the default)');
  const anyway = await gql(editor.token, INIT, { i: { filename: 'renamed.jpg', totalSize: same.length, projectId: project.id, folderId: folder.id, md5Checksum: md5hex(same), allowDuplicate: true } });
  const sa2 = anyway.data?.initiateUpload;
  await putPart(editor.token, sa2.id, 1, same);
  const kept = await gql(editor.token, COMPLETE, { s: sa2.id, m: md5hex(same) });
  ok(kept.data?.completeUpload?.duplicateOf === first.done.data.completeUpload.id, 'upload anyway: second file ready with duplicateOf');
  // race: two uploads of new identical bytes, neither opted in
  const twin = FIXTURES['photo.jpg']();
  const a = (await gql(editor.token, INIT, { i: { filename: `twin-a-${RUN}.jpg`, totalSize: twin.length, projectId: project.id, folderId: folder.id } })).data.initiateUpload;
  const b = (await gql(editor.token, INIT, { i: { filename: `twin-b-${RUN}.jpg`, totalSize: twin.length, projectId: project.id, folderId: folder.id } })).data.initiateUpload;
  await putPart(editor.token, a.id, 1, twin);
  await putPart(editor.token, b.id, 1, twin);
  const [ra, rb] = await Promise.all([gql(editor.token, COMPLETE, { s: a.id, m: md5hex(twin) }), gql(editor.token, COMPLETE, { s: b.id, m: md5hex(twin) })]);
  const winner = ra.data?.completeUpload ? ra : rb;
  const loser = ra.data?.completeUpload ? rb : ra;
  ok(winner.data?.completeUpload?.id && code(loser) === 'DUPLICATE_FILE' && loser.errors[0].extensions.existingFileId === winner.data.completeUpload.id, 'race: second identical upload DUPLICATE_FILE with the existing id', `${code(ra)} ${code(rb)}`);
  const loserFile = ra.data?.completeUpload ? b.fileId : a.fileId;
  ok((await db43.query('SELECT 1 FROM media_files WHERE id = $1', [loserFile])).rowCount === 0, 'race: the loser row and bytes are removed');
}

// restore, purge, move and completion retries keep one original per project
{
  const fileRow = async (id) => (await db43.query('SELECT status, duplicate_of, "trashedAt" FROM media_files WHERE id = $1', [id])).rows[0];
  // restore a trashed file whose twin was uploaded meanwhile
  const bytes = FIXTURES['photo.jpg']();
  const t1 = (await upload(editor.token, 'photo.jpg', `restore-a-${RUN}.jpg`, folder.id, bytes)).done.data.completeUpload;
  ok((await gql(editor.token, `mutation { moveToTrash(fileId:"${t1.id}") }`)).data?.moveToTrash === true, 'trash an original');
  const t2 = (await upload(editor.token, 'photo.jpg', `restore-b-${RUN}.jpg`, folder.id, bytes)).done.data?.completeUpload;
  ok(t2?.id && !t2.duplicateOf, 'the same bytes upload as a new original while the first is in the Trash');
  const restored = await gql(editor.token, `mutation { restoreFile(fileId:"${t1.id}") { id duplicateOf } }`);
  ok(restored.data?.restoreFile?.duplicateOf === t2.id, 'restoring the trashed twin succeeds and marks it as a duplicate', JSON.stringify(restored.errors ?? restored.data));

  // purge an original that has an upload-anyway duplicate: the survivor becomes the original
  const pb = FIXTURES['photo.jpg']();
  const orig = (await upload(editor.token, 'photo.jpg', `purge-a-${RUN}.jpg`, folder.id, pb)).done.data.completeUpload;
  const ai = (await gql(editor.token, INIT, { i: { filename: `purge-b-${RUN}.jpg`, totalSize: pb.length, projectId: project.id, folderId: folder.id, md5Checksum: md5hex(pb), allowDuplicate: true } })).data.initiateUpload;
  await putPart(editor.token, ai.id, 1, pb);
  const dupe = (await gql(editor.token, COMPLETE, { s: ai.id, m: md5hex(pb) })).data?.completeUpload;
  ok(dupe?.duplicateOf === orig.id, 'upload anyway creates a duplicate of the original');
  await gql(editor.token, `mutation { moveToTrash(fileId:"${orig.id}") }`);
  const purged = await gql(admin.token, `mutation { permanentDelete(fileId:"${orig.id}") }`);
  ok(purged.data?.permanentDelete === true, 'purging an original with a duplicate succeeds', JSON.stringify(purged.errors ?? ''));
  ok((await fileRow(dupe.id))?.duplicate_of === null, 'the surviving duplicate is promoted to original');
  const again = await gql(editor.token, INIT, { i: { filename: `purge-c-${RUN}.jpg`, totalSize: pb.length, projectId: project.id, folderId: folder.id, md5Checksum: md5hex(pb) } });
  ok(code(again) === 'DUPLICATE_FILE' && again.errors[0].extensions.existingFileId === dupe.id, 'a new identical upload is flagged against the promoted file');

  // move a file into a project that already holds its bytes
  const other = (await gql(editor.token, 'mutation($i: CreateProjectInput!){ createProject(input:$i){ id } }', { i: { title: `Move target ${RUN}` } })).data.createProject.id;
  const otherFolder = (await gql(editor.token, 'mutation($p: ID!, $n: String!){ createFolder(projectId:$p, name:$n){ id } }', { p: other, n: `Inbox ${RUN}` })).data.createFolder.id;
  const mb = FIXTURES['photo.jpg']();
  const inOther = (await gql(editor.token, INIT, { i: { filename: `move-a-${RUN}.jpg`, totalSize: mb.length, projectId: other, folderId: otherFolder } })).data.initiateUpload;
  await putPart(editor.token, inOther.id, 1, mb);
  const otherFile = (await gql(editor.token, COMPLETE, { s: inOther.id, m: md5hex(mb) })).data.completeUpload;
  const here = (await upload(editor.token, 'photo.jpg', `move-b-${RUN}.jpg`, folder.id, mb)).done.data.completeUpload;
  const moved = await gql(editor.token, `mutation { moveFile(fileId:"${here.id}", targetFolderId:"${otherFolder}") { id duplicateOf } }`);
  ok(moved.data?.moveFile?.duplicateOf === otherFile.id, 'moving a file into a project with identical bytes succeeds (marked duplicate)', JSON.stringify(moved.errors ?? moved.data));
  await gql(admin.token, `mutation { deleteProject(id:"${other}") }`);

  // a stale completion claim is taken over by a retry
  const sb = randomBytes(4096);
  const st = (await gql(editor.token, INIT, { i: { filename: `stale-${RUN}.bin`, totalSize: sb.length, projectId: project.id, folderId: folder.id } })).data.initiateUpload;
  await putPart(editor.token, st.id, 1, sb);
  await db43.query(`UPDATE upload_sessions SET status = 'COMPLETING', completing_at = TIMESTAMP '2000-01-01 00:00:00' WHERE id = $1`, [st.id]);
  const took = await gql(editor.token, COMPLETE, { s: st.id, m: md5hex(sb) });
  ok(took.data?.completeUpload?.md5Checksum === md5hex(sb), 'a completion claim older than 15 min is taken over', JSON.stringify(took.errors ?? ''));
  const fresh = (await gql(editor.token, INIT, { i: { filename: `busy-${RUN}.bin`, totalSize: sb.length, projectId: project.id, folderId: folder.id } })).data.initiateUpload;
  await putPart(editor.token, fresh.id, 1, sb);
  await db43.query(`UPDATE upload_sessions SET status = 'COMPLETING', completing_at = now() WHERE id = $1`, [fresh.id]);
  ok(code(await gql(editor.token, COMPLETE, { s: fresh.id, m: md5hex(sb) })) === 'UPLOAD_SESSION_CLOSED', 'a fresh completion claim is not taken over');
  await db43.query(`UPDATE upload_sessions SET status = 'IN_PROGRESS', completing_at = NULL WHERE id = $1`, [fresh.id]);
  await gql(editor.token, `mutation { cancelUpload(sessionId:"${fresh.id}") }`);

  // completion resumes after a failure right after assembly (development servers only)
  const rb = randomBytes(8192);
  const rs = (await gql(editor.token, INIT, { i: { filename: `__fail_after_assembly__${RUN}.bin`, totalSize: rb.length, projectId: project.id, folderId: folder.id } })).data.initiateUpload;
  await putPart(editor.token, rs.id, 1, rb);
  const first = await gql(editor.token, COMPLETE, { s: rs.id, m: md5hex(rb) });
  if (code(first) === 'STORAGE_UNAVAILABLE') {
    const st2 = await db43.query('SELECT status, backend_upload_id FROM upload_sessions WHERE id = $1', [rs.id]);
    ok(st2.rows[0]?.status === 'IN_PROGRESS' && st2.rows[0]?.backend_upload_id === null, 'after a post-assembly failure the session is open and already assembled', JSON.stringify(st2.rows[0]));
    const second = await gql(editor.token, COMPLETE, { s: rs.id, m: md5hex(rb) });
    ok(second.data?.completeUpload?.md5Checksum === md5hex(rb), 'the retry skips assembly and completes', JSON.stringify(second.errors ?? ''));
    r = await fetch(`${B}/media/d/${rs.fileId}`, { headers: { cookie: editor.cookie } });
    ok(r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(rb), 'the resumed completion serves the right bytes');
  } else {
    ok(first.data?.completeUpload?.id, 'completion (failure hook inactive on a production server)');
    console.log('SKIP completion retry after assembly (the failure hook runs on development servers only)');
  }
}

// expiry: a session past 24 h is refused and the sweeper removes it
{
  const buf = randomBytes(64);
  const s = (await gql(editor.token, INIT, { i: { filename: `old-${RUN}.bin`, totalSize: buf.length, projectId: project.id, folderId: folder.id } })).data.initiateUpload;
  await db43.query(`UPDATE upload_sessions SET "expiresAt" = TIMESTAMP '2000-01-01 00:00:00' WHERE id = $1`, [s.id]);
  r = await putPart(editor.token, s.id, 1, buf);
  ok(r.status === 410 && (await r.json()).code === 'UPLOAD_SESSION_EXPIRED', 'part into an expired session 410', r.status);
  const sweep = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'scripts/sweep-uploads.ts'], { encoding: 'utf8', shell: process.platform === 'win32' });
  ok(sweep.status === 0 && /"expired":\s*[1-9]/.test(sweep.stdout), 'sweeper expires old sessions', (sweep.stdout || sweep.stderr).trim().slice(-200));
  const after = await db43.query('SELECT status FROM upload_sessions WHERE id = $1', [s.id]);
  ok(after.rows[0]?.status === 'EXPIRED', 'session marked EXPIRED', after.rows[0]?.status);
  ok((await db43.query('SELECT 1 FROM media_files WHERE id = $1', [s.fileId])).rowCount === 0, 'the uploading row is removed');
}

// ---- media
r = await fetch(`${B}/media/t/${pic.id}`);
ok(r.status === 401 && (await r.json()).code === 'UNAUTHENTICATED', 'media no cookie 401');
r = await fetch(`${B}/media/i/${pic.id}`, { headers: { cookie: editor.cookie } });
const vary = (r.headers.get('vary') || '').split(',').map((v) => v.trim().toLowerCase());
ok(r.status === 200 && r.headers.get('cache-control') === 'private, max-age=3600' && vary.includes('cookie'), 'inline with cookie 200 + cache headers', `${r.status} ${r.headers.get('cache-control')}`);
r = await fetch(`${B}/media/t/${vid.id}`, { headers: { cookie: editor.cookie } });
ok(r.status === 200 || r.status === 404, 'thumbnail with cookie', r.status);
r = await fetch(`${B}/media/d/${vid.id}`, { headers: { cookie: viewer.cookie, range: 'bytes=0-99' } });
ok(r.status === 206 && r.headers.get('content-range')?.startsWith('bytes 0-99/') && (await r.arrayBuffer()).byteLength === 100, 'download Range 206 (viewer)', r.headers.get('content-range'));
r = await fetch(`${B}/media/d/${vid.id}`, { headers: { cookie: editor.cookie, range: 'bytes=999999999-' } });
ok(r.status === 416 && /^bytes \*\/\d+$/.test(r.headers.get('content-range') || ''), 'bad range 416', r.headers.get('content-range'));
r = await fetch(`${B}/media/d/${vid.id}`, { method: 'HEAD', headers: { cookie: editor.cookie } });
ok(r.status === 200 && r.headers.get('content-length') === String(up1.buf.length), 'HEAD size', r.headers.get('content-length'));
r = await fetch(`${B}/media/z?projectId=${project.id}&folderId=${folder.id}`, { headers: { cookie: editor.cookie } });
ok(r.status === 200 && r.headers.get('content-type') === 'application/zip', 'dashboard zip', r.status);
{
  // Story 4.6: streamed (no Content-Length), every entry STORE (method 0).
  const noLength = r.headers.get('content-length') === null;
  const zip = Buffer.from(await r.arrayBuffer());
  const entries = zipEntries(zip);
  ok(noLength, 'zip has no Content-Length', r.headers.get('content-length'));
  ok(entries.length >= 2 && entries.every((e) => e.method === 0 && e.compressed === e.size), 'zip entries stored uncompressed', JSON.stringify(entries.slice(0, 4)));
  ok(entries.some((e) => e.name.endsWith('clip.mp4') && e.size === up1.buf.length), 'zip entry has the declared size');
}

// ---- Story 4.4: versioned thumbnails and processed versions
const db44 = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db44.connect();
const picRow = (await gql(editor.token, `{ folder(id:"${folder.id}") { files { id thumbnailUrl previewUrl processedVersions { id } } } }`)).data.folder.files.find((f) => f.id === pic.id);
ok(/^\/media\/t\/[0-9a-f-]+\?v=\d+$/.test(picRow?.thumbnailUrl || ''), 'photo thumbnail URL carries its version', picRow?.thumbnailUrl);
r = await fetch(`${B}${picRow.thumbnailUrl}`, { headers: { cookie: editor.cookie } });
{
  const cc = r.headers.get('cache-control');
  const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
  ok(r.status === 200 && cc === 'private, max-age=31536000, immutable', 'current thumbnail version is immutable for a year', `${r.status} ${cc}`);
  // The 64x48 source keeps its 4:3 aspect (never enlarged, never cropped).
  ok(meta.format === 'jpeg' && meta.width === 64 && meta.height === 48, 'thumbnail keeps the source aspect ratio', `${meta.width}x${meta.height}`);
}
r = await fetch(`${B}/media/t/${pic.id}?v=987`, { headers: { cookie: editor.cookie } });
ok(r.status === 200 && r.headers.get('cache-control') === 'private, max-age=3600', 'stale thumbnail version gets the short policy', r.headers.get('cache-control'));
ok(Array.isArray(picRow.processedVersions) && picRow.previewUrl === null, 'a JPEG has no processed versions and no preview');
// A processed version row pointing at existing bytes (the pipeline that
// produces them is Epic 5): served through /media/p with the file's permission.
const versionId = randomUUID();
{
  const key = (await db44.query('SELECT storage_key, size FROM media_files WHERE id = $1', [pic.id])).rows[0];
  await db44.query(
    "INSERT INTO processed_versions (id, media_file_id, kind, storage_key, mime_type, size, attempt, created_at) VALUES ($1, $2, 'preview', $3, 'image/jpeg', $4, 1, now())",
    [versionId, pic.id, key.storage_key, key.size],
  );
}
const listedVersions = (await gql(editor.token, `{ folder(id:"${folder.id}") { files { id previewUrl processedVersions { id kind mimeType size downloadUrl } } } }`)).data.folder.files.find((f) => f.id === pic.id);
ok(listedVersions.processedVersions.length === 1 && listedVersions.processedVersions[0].downloadUrl === `/media/p/${versionId}` && listedVersions.previewUrl === `/media/p/${versionId}`, 'MediaFile.processedVersions and previewUrl', JSON.stringify(listedVersions.processedVersions));
{
  const byFile = await gql(viewer.token, `{ processedVersions(fileId:"${pic.id}") { id kind downloadUrl } }`);
  ok(byFile.data?.processedVersions?.length === 1 && byFile.data.processedVersions[0].kind === 'preview', 'processedVersions(fileId) for the viewer', JSON.stringify(byFile.errors ?? ''));
  ok(code(await gql(null, `{ processedVersions(fileId:"${pic.id}") { id } }`)) === 'UNAUTHENTICATED', 'processedVersions needs a session');
}
r = await fetch(`${B}/media/p/${versionId}`, { headers: { cookie: editor.cookie } });
ok(r.status === 200 && /^attachment;/.test(r.headers.get('content-disposition') || '') && /\.preview\.jpg/.test(r.headers.get('content-disposition') || ''), 'processed version 200 attachment', `${r.status} ${r.headers.get('content-disposition')}`);
r = await fetch(`${B}/media/p/${versionId}`, { headers: { cookie: viewer.cookie, range: 'bytes=0-9' } });
ok(r.status === 206 && (await r.arrayBuffer()).byteLength === 10, 'processed version Range 206 (viewer)', r.status);
r = await fetch(`${B}/media/p/${versionId}`, { method: 'HEAD', headers: { cookie: viewer.cookie } });
ok(r.status === 200 && Number(r.headers.get('content-length')) > 0, 'processed version HEAD', r.status);
r = await fetch(`${B}/media/p/${versionId}`);
ok(r.status === 401, 'processed version without a session 401', r.status);
r = await fetch(`${B}/media/p/${randomUUID()}`, { headers: { cookie: editor.cookie } });
ok(r.status === 404, 'unknown processed version 404', r.status);
for (const old of [`/api/thumbnail/${pic.id}`, `/api/download?projectId=${project.id}&fileIds=${pic.id}&token=${editor.token}`, `/api/cover/x`]) {
  r = await fetch(`${B}${old}`);
  ok(r.status === 404, `old route 404 ${old.split('?')[0]}`, r.status);
}
// cookie never authorises GraphQL
const cg = await fetch(`${B}/api/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `shotstash_session=${editor.token}` }, body: JSON.stringify({ query: '{ me { id } }' }) });
ok((await cg.json()).data.me === null, 'cookie does not authenticate /api/graphql');

// ---- roles
const viewerDenied = [
  ['createFolder', `mutation { createFolder(projectId:"${project.id}", name:"x") { id } }`],
  ['moveToTrash', `mutation { moveToTrash(fileId:"${pic.id}") }`],
  ['createShareLink', `mutation { createShareLink(input:{fileId:"${pic.id}", mode:PUBLIC}) { id } }`],
];
for (const [n, q] of viewerDenied) ok(code(await gql(viewer.token, q)) === 'FORBIDDEN', `viewer ${n} FORBIDDEN`);
ok(code(await gql(editor.token, `mutation { permanentDelete(fileId:"${pic.id}") }`)) === 'FORBIDDEN', 'editor permanentDelete FORBIDDEN');

// ---- instance status (Story 6.1): super admin only, 404 for everyone else
r = await fetch(`${B}/api/v1/status`, { headers: { authorization: `Bearer ${viewer.token}` } });
ok(r.status === 404, 'viewer /api/v1/status 404', r.status);
r = await fetch(`${B}/api/v1/status`, { headers: { authorization: `Bearer ${sa.token}` } });
const statusBody = await r.json().catch(() => ({}));
ok(
  r.status === 200 && typeof statusBody.version === 'string' && typeof statusBody.storage?.reachable === 'boolean' &&
    statusBody.storage?.backend === (process.env.STORAGE_BACKEND || 'local') && typeof statusBody.database === 'boolean' && typeof statusBody.cache === 'boolean',
  'super admin /api/v1/status 200 with version, storage, database, cache',
  `${r.status} ${JSON.stringify(statusBody)}`,
);
const saId = sa.user.id;
ok(code(await gql(admin.token, `mutation { updateUserRole(userId:"${saId}", role:EDITOR) { id } }`)) === 'FORBIDDEN', 'admin updateUserRole on SA FORBIDDEN');
ok(code(await gql(admin.token, `mutation { deactivateUser(id:"${saId}") { id } }`)) === 'FORBIDDEN', 'admin deactivateUser on SA FORBIDDEN');
ok(code(await gql(sa.token, `mutation { updateUserRole(userId:"${saId}", role:ADMIN) { id } }`)) === 'FORBIDDEN', 'last SA demoting self FORBIDDEN');
const unauth = await gql(null, '{ projects { id } }');
ok(code(unauth) === 'UNAUTHENTICATED', 'projects without session UNAUTHENTICATED');

// ---- shares
const pub = await gql(editor.token, `mutation { createShareLink(input:{folderId:"${folder.id}", mode:PUBLIC}) { id slug accessCode } }`);
const pubLink = pub.data.createShareLink;
ok(pubLink.accessCode === null, 'PUBLIC link has no code');
let html = await (await fetch(`${B}/s/${pubLink.slug}`)).text();
const signed = [...new Set(html.match(/\/media\/s\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [])];
ok(signed.length > 0 && html.includes('clip.mp4'), 'public page renders with signed URLs', signed.length);
r = await fetch(`${B}${signed[0]}`);
ok(r.status === 200 && r.headers.get('cache-control') === 'private, max-age=300', 'signed URL 200', `${r.status} ${r.headers.get('cache-control')}`);
const [p, s] = signed[0].slice(8).split('.');
r = await fetch(`${B}/media/s/${p}.${s.slice(0, -2)}xx`);
ok(r.status === 404, 'tampered signed URL 404');
r = await fetch(`${B}/s/${pubLink.slug}/sign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zip: true }) });
const zipBody = await r.json();
ok(r.status === 200 && zipBody.zipUrl, 'share zip url minted');
r = await fetch(`${B}${zipBody.zipUrl}`);
ok(r.status === 200 && r.headers.get('content-type') === 'application/zip', 'share zip 200');

const priv = await gql(editor.token, `mutation { createShareLink(input:{fileId:"${vid.id}", mode:PRIVATE}) { id slug accessCode } }`);
const pl = priv.data.createShareLink;
ok(/^[A-Z2-9]{6}$/.test(pl.accessCode || ''), 'PRIVATE link returns one-time code', pl.accessCode);
const again = await gql(editor.token, `{ shareLinksForTarget(fileId:"${vid.id}") { slug accessCode } }`);
ok(again.data.shareLinksForTarget.every((l) => l.accessCode === null), 'code not readable later');
html = await (await fetch(`${B}/s/${pl.slug}`)).text();
ok(!html.includes('clip.mp4') && !/\/media\/s\//.test(html), 'private page leaks no names or media');
r = await fetch(`${B}/s/${pl.slug}/sign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileIds: [vid.id] }) });
ok(r.status === 401, 'sign without share cookie 401', r.status);
r = await fetch(`${B}/s/${pl.slug}/unlock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pl.accessCode.toLowerCase() }) });
const unlockSc = r.headers.get('set-cookie') || '';
const ub = await r.json();
ok(r.status === 200 && ub.state === 'ok' && new RegExp(`shotstash_share_${pl.slug}=`).test(unlockSc) && new RegExp(`Path=/s/${pl.slug}`, 'i').test(unlockSc) && /HttpOnly/i.test(unlockSc), 'unlock sets share cookie', unlockSc);
const shareCookie = unlockSc.split(';')[0];
r = await fetch(`${B}/s/${pl.slug}/sign`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: shareCookie }, body: JSON.stringify({ fileIds: [vid.id] }) });
const sb = await r.json();
ok(r.status === 200 && sb.files[vid.id]?.inlineUrl, 'sign with cookie mints URLs');
r = await fetch(`${B}${sb.files[vid.id].inlineUrl}`, { headers: { range: 'bytes=0-9' } });
ok(r.status === 206, 'signed video Range 206', r.status);
const priv2 = await gql(editor.token, `mutation { createShareLink(input:{fileId:"${pic.id}", mode:PRIVATE}) { id slug } }`);
const p2 = priv2.data.createShareLink;
r = await fetch(`${B}/s/${p2.slug}/sign`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `shotstash_share_${p2.slug}=${shareCookie.split('=')[1]}` }, body: JSON.stringify({ fileIds: [pic.id] }) });
ok(r.status === 401, 'cookie of another slug 401', r.status);
let statuses = [];
for (let i = 0; i < 5; i++) {
  const x = await fetch(`${B}/s/${pl.slug}/unlock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'AAAAAA' }) });
  statuses.push(x.status);
}
ok(statuses.slice(0, 4).every((x) => x === 401) && statuses[4] === 429, 'wrong code 401, 6th attempt 429', statuses.join(','));

// revoke then everything dies
ok((await gql(viewer.token, `mutation { revokeShareLink(id:"${pubLink.id}") }`)).errors, 'viewer cannot revoke');
const rv = await gql(editor.token, `mutation { revokeShareLink(id:"${pubLink.id}") }`);
ok(rv.data?.revokeShareLink === true, 'editor revokes own link');
r = await fetch(`${B}${signed[0]}`);
ok(r.status === 404, 'signed URL 404 after revoke', r.status);
r = await fetch(`${B}/s/${pubLink.slug}`);
ok(r.status === 404 && inactiveKind(await r.text()) === 'revoked', 'revoked page 404 with its message', r.status);
r = await fetch(`${B}/s/${pubLink.slug}/sign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zip: true }) });
{
  const b = await r.json().catch(() => ({}));
  ok(r.status === 410 && b.state === 'revoked', 'sign on a revoked link 410 revoked', `${r.status} ${b.state}`);
}
r = await fetch(`${B}/s/${pubLink.slug}/items?offset=0`);
{
  const b = await r.json().catch(() => ({}));
  ok(r.status === 410 && b.state === 'revoked', 'items on a revoked link 410 revoked', `${r.status} ${b.state}`);
}
{
  // Story 4.6: an expired link answers 404 with its own message.
  const exp = (await gql(editor.token, `mutation { createShareLink(input:{folderId:"${folder.id}", mode:PUBLIC, expiresInHours:24}) { id slug } }`)).data.createShareLink;
  // A UTC wall-clock string: the column has no time zone, and the database session may not be UTC.
  const past = new Date(Date.now() - 60_000).toISOString().replace('Z', '');
  await db44.query('UPDATE share_links SET "expiresAt" = $2 WHERE id = $1', [exp.id, past]);
  r = await fetch(`${B}/s/${exp.slug}`);
  const body = await r.text();
  ok(r.status === 404 && inactiveKind(body) === 'expired' && !/\/media\/s\//.test(body), 'expired page 404 with its message, no content', `${r.status} ${inactiveKind(body)}`);
  r = await fetch(`${B}/s/${pl.slug}`);
  ok(r.status === 200, 'private link without its code stays 200 (unlock form)', r.status);
  r = await fetch(`${B}/s/no-such-link-${RUN}`);
  ok(r.status === 404 && inactiveKind(await r.text()) === 'not-found', 'unknown link 404', r.status);
}

// trash: signed URL and cookie media 404
ok((await gql(editor.token, `mutation { moveToTrash(fileId:"${vid.id}") }`)).data?.moveToTrash === true, 'editor moves to trash');
r = await fetch(`${B}${sb.files[vid.id].inlineUrl}`);
ok(r.status === 404, 'trashed target signed 404', r.status);
r = await fetch(`${B}/media/d/${vid.id}`, { headers: { cookie: editor.cookie } });
ok(r.status === 404, 'trashed file media 404', r.status);
html = await (await fetch(`${B}/s/${pl.slug}`)).text();
ok(!/\/media\/s\//.test(html), 'page for trashed target shows no media');
ok((await gql(editor.token, `mutation { restoreFile(fileId:"${vid.id}") { id } }`)).data?.restoreFile, 'editor restores');
ok(code(await gql(admin.token, `mutation { permanentDelete(fileId:"${pic.id}") }`)) === 'NOT_IN_TRASH', 'permanentDelete needs the Trash first');
ok((await gql(editor.token, `mutation { moveToTrash(fileId:"${pic.id}") }`)).data?.moveToTrash === true, 'editor trashes photo');
// Story 4.4/4.5: a trashed parent hides its processed versions; the
// thumbnail stays visible to Trash viewers only.
r = await fetch(`${B}/media/p/${versionId}`, { headers: { cookie: editor.cookie } });
ok(r.status === 404, 'processed version of a trashed file 404', r.status);
r = await fetch(`${B}${picRow.thumbnailUrl}`, { headers: { cookie: editor.cookie } });
ok(r.status === 200 && r.headers.get('content-type') === 'image/jpeg', 'trashed file thumbnail for a Trash viewer (editor)', r.status);
ok(r.headers.get('cache-control') === 'private, max-age=3600', 'a trashed file thumbnail is never cached as immutable', r.headers.get('cache-control'));
r = await fetch(`${B}/media/t/${pic.id}`, { headers: { cookie: admin.cookie } });
ok(r.status === 200, 'trashed file thumbnail for an admin', r.status);
r = await fetch(`${B}/media/t/${pic.id}`, { headers: { cookie: viewer.cookie } });
ok(r.status === 404, 'trashed file thumbnail 404 for a viewer (no Trash)', r.status);
r = await fetch(`${B}/media/i/${pic.id}`, { headers: { cookie: editor.cookie } });
ok(r.status === 404, 'trashed file original stays 404', r.status);
{
  const trashRows = (await gql(editor.token, '{ allTrashedFiles { id thumbnailUrl } }')).data.allTrashedFiles;
  ok(!!trashRows.find((f) => f.id === pic.id)?.thumbnailUrl, 'Trash row carries the thumbnail URL');
}
const purge = await gql(admin.token, `mutation { permanentDelete(fileId:"${pic.id}") }`);
ok(purge.data?.permanentDelete === true, 'admin permanentDelete allowed (link revoked first)', JSON.stringify(purge.errors ?? ''));
r = await fetch(`${B}/s/${p2.slug}`);
ok(r.status === 404 && inactiveKind(await r.text()) === 'gone', 'link to purged file 404 with the gone message', r.status);

// deactivation deletes sessions: the old token stays dead after reactivation
const ro = await gql(sa.token, `mutation { deactivateUser(id:"${crew.user.id}") { id active } }`);
ok(ro.data?.deactivateUser?.active === false, 'SA deactivates crew');
ok(code(await gql(crew.token, '{ projects { id } }')) === 'UNAUTHENTICATED', 'deactivated user rejected');
r = await fetch(`${B}/media/i/${vid.id}`, { headers: { cookie: crew.cookie } });
ok(r.status === 401, 'deactivated user media 401', r.status);
await gql(sa.token, `mutation { reactivateUser(id:"${crew.user.id}") { id } }`);
ok(code(await gql(crew.token, '{ projects { id } }')) === 'UNAUTHENTICATED', 'old session gone even after reactivation');

// ================= Stories 2.5-2.8 =================

// ---- security headers and health
r = await fetch(`${B}/api/ping`);
ok(r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('referrer-policy') === 'strict-origin-when-cross-origin' && !!r.headers.get('permissions-policy') && r.headers.get('x-frame-options') === 'DENY', 'security headers on an API response');
ok(!r.headers.get('strict-transport-security'), 'no HSTS over plain http');
r = await fetch(`${B}/`);
ok(r.headers.get('x-frame-options') === 'DENY' && r.headers.get('x-content-type-options') === 'nosniff', 'security headers on a page');
r = await fetch(`${B}/media/t/${vid.id}`);
ok(r.headers.get('x-frame-options') === 'DENY', 'security headers on media 401');
r = await fetch(`${B}/api/health`);
const health = await r.json();
ok(['ok', 'version', 'db', 'cache', 'storage', 'setupRequired', 'schemeMismatch'].every((k) => k in health) && health.setupRequired === false && health.db === true && health.schemeMismatch === false, 'health body', JSON.stringify(health));
ok(r.status === (health.ok ? 200 : 503), 'health status matches ok (503 when a dependency is down)', r.status);

// ---- projects list carries no chats
const pc = await gql(viewer.token, '{ projects { id chats { id } } }');
ok(pc.errors?.length && !pc.data, 'projects { chats } is a schema error', JSON.stringify(pc.errors?.[0]?.message ?? ''));
const pchat = await gql(viewer.token, `{ project(id:"${project.id}") { chats { id } } }`);
ok(Array.isArray(pchat.data?.project?.chats), 'project(id){ chats } works for a viewer');

// ---- chat fan-out: only the mentioned active user is notified
const unread = async (tok) => (await gql(tok, '{ unreadNotificationCount }')).data?.unreadNotificationCount;
const before = { viewer: await unread(viewer.token), admin: await unread(admin.token) };
const sent = await gql(editor.token, `mutation { sendMessage(projectId:"${project.id}", message:"hi @Viewer") { id } }`);
ok(sent.data?.sendMessage?.id, 'editor sends a chat message', JSON.stringify(sent.errors ?? ''));
await new Promise((res) => setTimeout(res, 500));
ok((await unread(viewer.token)) === before.viewer + 1, 'mentioned viewer notified');
ok((await unread(admin.token)) === before.admin, 'unmentioned admin not notified');
ok(code(await gql(editor.token, 'mutation { sendMessage(projectId:"00000000-0000-4000-8000-000000000000", message:"x") { id } }')) === 'NOT_FOUND', 'sendMessage to a missing project NOT_FOUND');

// ---- inactive / pending mentioned users are not notified
const dvi = await gql(sa.token, `mutation { deactivateUser(id:"${viewer.user.id}") { id } }`);
ok(dvi.data?.deactivateUser, 'viewer deactivated for fan-out check');
await gql(editor.token, `mutation { sendMessage(projectId:"${project.id}", message:"again @Viewer") { id } }`);
await gql(sa.token, `mutation { reactivateUser(id:"${viewer.user.id}") { id } }`);
await new Promise((res) => setTimeout(res, 500));
{
  // Read from the database: a fresh viewer login here would spend the login limit.
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  // Story 5.5: unreadNotificationCount leaves out notifications of a Project that no longer exists.
  const n = (
    await db.query(
      'SELECT count(*)::int AS n FROM notifications n WHERE n."userId" = $1 AND n.read = false AND (n.project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = n.project_id))',
      [viewer.user.id],
    )
  ).rows[0].n;
  await db.end();
  ok(n === before.viewer + 1, 'inactive mentioned user not notified', n);
}

// ---- Google path (needs a real Google id token): skipped locally
console.log('SKIP Google email_verified linking (covered by code review; needs a Google-signed id token)');

// ---- password length and pending accounts
// Created as the super admin: same password rule, no login-limit cost.
const shortReg = await gql(sa.token, 'mutation { register(input:{name:"S", email:"short-pw@example.com", password:"123456789", role:EDITOR}) { success errorCode } }');
ok(shortReg.data?.register?.success === false && shortReg.data?.register?.errorCode === 'PASSWORD_TOO_SHORT', 'register with 9 chars PASSWORD_TOO_SHORT', JSON.stringify(shortReg));
const pendEmail = `pending-${Date.now()}@example.com`;
const taken = await gql(sa.token, 'mutation { register(input:{name:"Taken", email:"editor@example.com", password:"long-enough-password", role:EDITOR}) { success errorCode } }');
ok(taken.data?.register?.success === false && taken.data.register.errorCode === 'EMAIL_TAKEN', 'register with an existing email EMAIL_TAKEN', JSON.stringify(taken));
const pend = await gql(null, `mutation { register(input:{name:"Pending", email:"${pendEmail}", password:"pending-password"}) { success token } }`);
ok(pend.data?.register?.success && pend.data.register.token, 'public register returns a PENDING session');
ok(code(await gql(pend.data.register.token, '{ projects { id } }')) === 'FORBIDDEN', 'PENDING account cannot list projects');
ok((await gql(pend.data.register.token, '{ me { accountStatus } }')).data?.me?.accountStatus === 'PENDING', 'PENDING account reads me');
// reject revokes sessions: a later approval does not revive the old token
const pendId = (await gql(pend.data.register.token, '{ me { id } }')).data.me.id;
ok((await gql(sa.token, `mutation { rejectUser(userId:"${pendId}") { id accountStatus } }`)).data?.rejectUser?.accountStatus === 'REJECTED', 'SA rejects pending account');
// Only PENDING sign-ups can be decided: approving a rejected one is refused.
ok(code(await gql(sa.token, `mutation { approveUser(userId:"${pendId}", role:VIEWER) { id accountStatus } }`)) === 'ALREADY_HANDLED', 'approve after reject ALREADY_HANDLED');
ok(code(await gql(pend.data.register.token, '{ projects { id } }')) === 'UNAUTHENTICATED', 'rejected account: old token UNAUTHENTICATED');
{
  // Two fresh PENDING sign-ups straight in the database (a public register
  // would spend the login limit).
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const ids = [randomUUID(), randomUUID()];
  for (const [i, id] of ids.entries()) {
    await db.query(
      `INSERT INTO users (id, name, email, "passwordHash", role, "accountStatus", active, "updatedAt")
       VALUES ($1, $2, $3, NULL, 'VIEWER', 'PENDING', false, now())`,
      [id, `Pending ${i} ${RUN}`, `pending-${i}-${RUN}@example.com`],
    );
  }
  await db.end();
  const approve = (id) => gql(sa.token, `mutation { approveUser(userId:"${id}", role:VIEWER) { id accountStatus } }`);
  ok((await approve(ids[0])).data?.approveUser?.accountStatus === 'ACTIVE', 'SA approves a pending sign-up');
  ok(code(await approve(ids[0])) === 'ALREADY_HANDLED', 'approve twice: second ALREADY_HANDLED');
  ok((await approve(ids[1])).data?.approveUser?.accountStatus === 'ACTIVE', 'SA approves another pending sign-up');
  ok(code(await gql(sa.token, `mutation { rejectUser(userId:"${ids[1]}") { id accountStatus } }`)) === 'ALREADY_HANDLED', 'reject after approve ALREADY_HANDLED');
}
const longMsg = await gql(editor.token, `mutation { sendMessage(projectId:"${project.id}", message:"${'x'.repeat(5001)}") { id } }`);
ok(code(longMsg) === 'MESSAGE_TOO_LONG', 'chat message over 5000 characters MESSAGE_TOO_LONG');

// ---- password reset flood (needs EMAIL_TRANSPORT=log on the server)
const avail = (await gql(null, '{ passwordResetAvailable }')).data?.passwordResetAvailable;
if (avail) {
  const floodEmail = `flood-${RUN}@example.com`;
  const codes = [];
  for (let i = 0; i < 6; i++) {
    const x = await gql(null, `mutation { requestPasswordReset(email:"${floodEmail}") { success errorCode } }`);
    codes.push(x.data?.requestPasswordReset?.errorCode ?? 'OK');
  }
  // An earlier run within the hour may already have used this IP's bucket,
  // so the first refusal can come sooner; the 6th is always refused.
  const firstLimited = codes.indexOf('RATE_LIMITED');
  ok(codes[5] === 'RATE_LIMITED' && firstLimited >= 0 && codes.slice(firstLimited).every((c) => c === 'RATE_LIMITED') && codes.slice(0, firstLimited).every((c) => c === 'OK'), '6th reset request within 1 h RATE_LIMITED', codes.join(','));
} else {
  console.log('SKIP reset flood (password reset unavailable: start the server with EMAIL_TRANSPORT=log)');
}

// ---- share creation flood: 61st link within 1 h by one user
const floodEmail2 = `share-flood-${RUN}@example.com`;
const mkFlood = await gql(sa.token, `mutation { register(input:{name:"Flood ${RUN}", email:"${floodEmail2}", password:"flood-password-1", role:EDITOR}) { success message } }`);
ok(mkFlood.data?.register?.success, 'per-run flood user created', JSON.stringify(mkFlood.data?.register?.message ?? mkFlood.errors ?? ''));
const flooder = await login(floodEmail2, 'flood-password-1');
const shareTarget = await gql(flooder.token, `mutation { createFolder(projectId:"${project.id}", name:"Flood ${RUN}") { id } }`);
const floodFolder = shareTarget.data.createFolder.id;
ok(code(await gql(flooder.token, `mutation { createShareLink(input:{folderId:"00000000-0000-4000-8000-000000000000", mode:PUBLIC}) { id } }`)) === 'NOT_FOUND', 'invalid target refused before a rate-limit slot is used');
let created = 0;
let floodCode = null;
for (let i = 0; i < 61; i++) {
  const x = await gql(flooder.token, `mutation { createShareLink(input:{folderId:"${floodFolder}", mode:PUBLIC}) { id } }`);
  if (x.data?.createShareLink?.id) created++;
  else { floodCode = code(x); break; }
}
ok(created === 60 && floodCode === 'RATE_LIMITED', '61st createShareLink RATE_LIMITED', `${created} ${floodCode}`);

// ---- trash cascade / restore / purge
const mk = async (name, parentId) => (await gql(editor.token, `mutation { createFolder(projectId:"${project.id}", name:"${name}"${parentId ? `, parentId:"${parentId}"` : ''}) { id } }`)).data.createFolder.id;
const secS = await mk('Cascade');
const secS1 = await mk('Inner', secS);
const secS2 = await mk('Own', secS);
const inFile = (await upload(editor.token, 'photo.jpg', 'inner.jpg', secS1)).done.data.completeUpload;
const ownFile = (await upload(editor.token, 'photo.jpg', 'own.jpg', secS2)).done.data.completeUpload;
ok(inFile?.id && ownFile?.id, 'files uploaded into nested Sections');
const link = (await gql(editor.token, `mutation { createShareLink(input:{folderId:"${secS1}", mode:PUBLIC}) { id slug } }`)).data.createShareLink;
html = await (await fetch(`${B}/s/${link.slug}`)).text();
const innerSigned = (html.match(/\/media\/s\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [])[0];
ok(!!innerSigned, 'share of inner Section renders media');
// S2 trashed on its own first, then the parent S
ok((await gql(editor.token, `mutation { moveFolderToTrash(folderId:"${secS2}") }`)).data?.moveFolderToTrash === true, 'trash inner Section on its own');
ok((await gql(editor.token, `mutation { moveFolderToTrash(folderId:"${secS}") }`)).data?.moveFolderToTrash === true, 'trash parent Section');
ok((await gql(editor.token, `{ folder(id:"${secS1}") { id } }`)).data?.folder === null, 'cascaded Section hidden from folder(id)');
r = await fetch(`${B}/media/i/${inFile.id}`, { headers: { cookie: editor.cookie } });
ok(r.status === 404, 'cascaded file media 404', r.status);
r = await fetch(`${B}${innerSigned}`);
ok(r.status === 404, 'cascaded file signed URL 404', r.status);
r = await fetch(`${B}/s/${link.slug}`);
ok(r.status === 404 && inactiveKind(await r.text()) === 'section-gone', 'share page of trashed target 404 with its message', r.status);
const search = await gql(editor.token, `{ searchFiles(query:"inner") { id } }`);
ok(!(search.data?.searchFiles ?? []).some((f) => f.id === inFile.id), 'search hides cascaded file');
const trashList = await gql(editor.token, '{ allTrashedFolders { id } allTrashedFiles { id } }');
const troots = trashList.data.allTrashedFolders.map((f) => f.id);
ok(troots.includes(secS) && troots.includes(secS2) && !troots.includes(secS1) && !trashList.data.allTrashedFiles.some((f) => f.id === inFile.id), 'Trash lists roots only');
ok(code(await gql(editor.token, `mutation { restoreFolder(folderId:"${secS1}") { id } }`)) === 'ANCESTOR_TRASHED', 'restoring a cascaded child refused');
ok(code(await gql(editor.token, `mutation { restoreFolder(folderId:"${secS2}") { id } }`)) === 'ANCESTOR_TRASHED', 'restoring a root inside a trashed Section refused');
ok(code(await gql(editor.token, `mutation { createFolder(projectId:"${project.id}", name:"x", parentId:"${secS1}") { id } }`)) === 'NOT_FOUND', 'createFolder into trashed Section NOT_FOUND');
ok(code(await gql(editor.token, `mutation { createShareLink(input:{fileId:"${inFile.id}", mode:PUBLIC}) { id } }`)) === 'NOT_FOUND', 'createShareLink on trashed file NOT_FOUND');
ok(code(await gql(editor.token, `mutation { moveFile(fileId:"${vid.id}", targetFolderId:"${secS1}") { id } }`)) === 'NOT_FOUND', 'moveFile into trashed Section NOT_FOUND');
ok((await gql(editor.token, `mutation { restoreFolder(folderId:"${secS}") { id } }`)).data?.restoreFolder?.id === secS, 'restore parent Section');
ok((await gql(editor.token, `{ folder(id:"${secS1}") { id } }`)).data?.folder?.id === secS1, 'cascaded Section restored');
r = await fetch(`${B}/media/i/${inFile.id}`, { headers: { cookie: editor.cookie } });
ok(r.status === 200, 'cascaded file media back', r.status);
r = await fetch(`${B}/s/${link.slug}`);
ok(r.status === 200, 'share link works again after restore', r.status);
ok((await gql(editor.token, `{ folder(id:"${secS2}") { id } }`)).data?.folder === null, 'Section trashed on its own stays in Trash');
// purge the parent (with S2 still in Trash inside it)
ok((await gql(editor.token, `mutation { moveFolderToTrash(folderId:"${secS}") }`)).data?.moveFolderToTrash === true, 'trash parent again');
ok(code(await gql(editor.token, `mutation { permanentDeleteFolder(folderId:"${secS}") }`)) === 'FORBIDDEN', 'editor cannot purge');
const pf = await gql(admin.token, `mutation { permanentDeleteFolder(folderId:"${secS}") }`);
ok(pf.data?.permanentDeleteFolder === true, 'admin purges Section', JSON.stringify(pf.errors ?? ''));
r = await fetch(`${B}/s/${link.slug}`);
ok(r.status === 404 && inactiveKind(await r.text()) === 'gone', 'purged target share page 404 with the gone message', r.status);
const listed = (await gql(admin.token, '{ shareLinks { id } }')).data.shareLinks.some((l) => l.id === link.id);
ok(!listed, 'purged link no longer listed');
{
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const row = await db.query('SELECT revoked_reason FROM share_links WHERE id = $1', [link.id]);
  await db.end();
  ok(row.rows[0]?.revoked_reason === 'target_deleted', 'purged link revoked with target_deleted', row.rows[0]?.revoked_reason);
}
ok((await gql(editor.token, `{ folder(id:"${secS2}") { id } }`)).data?.folder === null && (await gql(admin.token, '{ allTrashedFolders { id } }')).data.allTrashedFolders.every((f) => f.id !== secS2), 'nested trashed Section purged with its parent');
r = await fetch(`${B}/media/i/${ownFile.id}`, { headers: { cookie: editor.cookie } });
ok(r.status === 404, 'purged file media 404', r.status);

// ---- Story 4.4: a HEIC upload keeps its original and gets a preview version
{
  const heifEnc = spawnSync('heif-enc', ['--version'], { encoding: 'utf8' });
  if (heifEnc.error) {
    console.log('SKIP HEIC upload rows: heif-enc not installed (apt install libheif-examples)');
  } else {
    const dir = mkdtempSync(path.join(tmpdir(), 'e2e-heic-'));
    try {
      // A synthetic photo (never a real one), unique per run.
      const noise = await sharp(randomBytes(96 * 64 * 3), { raw: { width: 96, height: 64, channels: 3 } }).jpeg().toBuffer();
      writeFileSync(path.join(dir, 'in.jpg'), noise);
      const enc = spawnSync('heif-enc', ['-q', '60', '-o', path.join(dir, 'out.heic'), path.join(dir, 'in.jpg')], { encoding: 'utf8' });
      ok(enc.status === 0, 'heif-enc made a synthetic HEIC', (enc.stderr || '').slice(-200));
      const heic = readFileSync(path.join(dir, 'out.heic'));
      const name = `IMG_${RUN}.HEIC`;
      const up = await uploadTo(editor.token, name, heic, project.id, folder.id);
      const f = up.done.data?.completeUpload;
      ok(!!f?.id, 'HEIC upload completes', JSON.stringify(up.done.errors ?? ''));
      const row = (await gql(editor.token, `{ folder(id:"${folder.id}") { files { id mimeType originalName md5Checksum thumbnailUrl previewUrl } } }`)).data.folder.files.find((x) => x.id === f.id);
      const versions = (await gql(editor.token, `{ processedVersions(fileId:"${f.id}") { id kind mimeType } }`)).data.processedVersions;
      const dbRow = (await db44.query('SELECT storage_key, thumb_version FROM media_files WHERE id = $1', [f.id])).rows[0];
      ok(row?.mimeType === 'image/heic' && row.originalName === name, 'HEIC keeps its type and name', `${row?.mimeType} ${row?.originalName}`);
      ok(dbRow?.storage_key === `files/${f.id}/original.heic`, 'HEIC original key unchanged', dbRow?.storage_key);
      ok(row?.md5Checksum === md5hex(heic), 'md5Checksum is the MD5 of the uploaded bytes');
      ok(versions.length === 1 && versions[0].kind === 'preview' && versions[0].mimeType === 'image/jpeg', 'exactly one preview version (JPEG)', JSON.stringify(versions));
      ok(row?.previewUrl === `/media/p/${versions[0]?.id}`, 'previewUrl set', row?.previewUrl);
      ok(dbRow?.thumb_version > 0 && row.thumbnailUrl === `/media/t/${f.id}?v=${dbRow.thumb_version}`, 'HEIC thumbnail made', row?.thumbnailUrl);
      r = await fetch(`${B}${row.thumbnailUrl}`, { headers: { cookie: editor.cookie } });
      ok(r.status === 200 && r.headers.get('content-type') === 'image/jpeg', 'HEIC thumbnail 200 image/jpeg', r.status);
      r = await fetch(`${B}/media/d/${f.id}`, { headers: { cookie: editor.cookie } });
      ok(md5hex(Buffer.from(await r.arrayBuffer())) === md5hex(heic), 'the stored original is byte for byte the upload');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ---- Story 4.5: the search index follows every lifecycle change (with
// Elasticsearch on the CI local leg; the database answers the same without it)
{
  const esOn = !!process.env.ELASTICSEARCH_NODE_URL;
  console.log(`search index rows: ${esOn ? 'Elasticsearch' : 'database only'}`);
  const findIn = async (query, projectId, id, want = true) => {
    for (let i = 0; i < 40; i++) {
      const res = await gql(editor.token, 'query($q: String!, $p: ID){ searchFiles(query:$q, projectId:$p) { id } }', { q: query, p: projectId });
      const hit = (res.data?.searchFiles ?? []).some((x) => x.id === id);
      if (hit === want) return true;
      await new Promise((done) => setTimeout(done, 250));
    }
    return false;
  };
  const p2 = (await gql(editor.token, `mutation { createProject(input:{title:"Search ${RUN}"}) { id } }`)).data.createProject.id;
  const p2Section = (await gql(editor.token, `mutation { createFolder(projectId:"${p2}", name:"Index") { id } }`)).data.createFolder.id;
  const word = `Ärger${RUN}`;
  const a = (await uploadTo(editor.token, `${word}.jpg`, FIXTURES['photo.jpg'](), project.id, folder.id)).done.data.completeUpload;
  ok(await findIn(word.toLowerCase(), project.id, a.id), 'search finds a new upload (non-ASCII name, other case)');
  await gql(editor.token, `mutation { moveFile(fileId:"${a.id}", targetFolderId:"${p2Section}") { id } }`);
  ok(await findIn(word, p2, a.id), 'search finds a file moved to another Project there');
  ok(await findIn(word, project.id, a.id, false), 'and no longer in the old Project');
  const copy = (await gql(editor.token, `mutation { copyFile(fileId:"${a.id}", targetFolderId:"${folder.id}") { id } }`)).data?.copyFile;
  ok(!!copy?.id && (await findIn(word, project.id, copy.id)), 'search finds a copy');
  const sec = (await gql(editor.token, `mutation { createFolder(projectId:"${project.id}", name:"Moving ${RUN}") { id } }`)).data.createFolder.id;
  const m = (await uploadTo(editor.token, `Möve${RUN}.jpg`, FIXTURES['photo.jpg'](), project.id, sec)).done.data.completeUpload;
  await gql(editor.token, `mutation { moveFolder(folderId:"${sec}", targetProjectId:"${p2}") { id } }`);
  ok(await findIn(`möve${RUN}`, p2, m.id), 'search finds a file of a Section moved to another Project');
  ok((await gql(editor.token, `mutation { moveFolderToTrash(folderId:"${sec}") }`)).data?.moveFolderToTrash === true, 'trash the moved Section');
  ok(await findIn(`möve${RUN}`, p2, m.id, false), 'a trashed Section leaves search');
  ok((await gql(editor.token, `mutation { restoreFolder(folderId:"${sec}") { id } }`)).data?.restoreFolder?.id === sec, 'restore it');
  ok(await findIn(`möve${RUN}`, p2, m.id), 'a restored Section is found again');
}

// ---- Story 4.5: a trashed Section's rep thumbnails come from its nested files only
{
  const top = (await gql(editor.token, `mutation { createFolder(projectId:"${project.id}", name:"Nest ${RUN}") { id } }`)).data.createFolder.id;
  const inner = (await gql(editor.token, `mutation { createFolder(projectId:"${project.id}", name:"Inner", parentId:"${top}") { id } }`)).data.createFolder.id;
  const early = (await gql(editor.token, `mutation { createFolder(projectId:"${project.id}", name:"Early", parentId:"${top}") { id } }`)).data.createFolder.id;
  const nested = (await uploadTo(editor.token, 'nested.jpg', FIXTURES['photo.jpg'](), project.id, inner)).done.data.completeUpload;
  const earlyFile = (await uploadTo(editor.token, 'early.jpg', FIXTURES['photo.jpg'](), project.id, early)).done.data.completeUpload;
  await gql(editor.token, `mutation { moveFolderToTrash(folderId:"${early}") }`);
  await gql(editor.token, `mutation { moveFolderToTrash(folderId:"${top}") }`);
  const rows = (await gql(editor.token, '{ allTrashedFolders { id repFiles(limit: 3) { id thumbnailUrl } } }')).data.allTrashedFolders;
  const reps = rows.find((x) => x.id === top)?.repFiles ?? [];
  ok(reps.some((x) => x.id === nested.id && x.thumbnailUrl), 'trashed Section rep thumbnails come from its nested sub-Section', JSON.stringify(reps));
  ok(!reps.some((x) => x.id === earlyFile.id), 'a sub-Section trashed on its own earlier contributes nothing');
}

// logout
r = await fetch(`${B}/api/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${flooder.token}` } });
ok(r.status === 200 && /shotstash_session=;/.test(r.headers.get('set-cookie') || ''), 'logout clears cookie', r.headers.get('set-cookie'));
ok(code(await gql(flooder.token, '{ projects { id } }')) === 'UNAUTHENTICATED', 'old token fails GraphQL');
r = await fetch(`${B}/media/i/${vid.id}`, { headers: { cookie: flooder.cookie } });
ok(r.status === 401, 'old token fails media', r.status);

await db44.end();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
