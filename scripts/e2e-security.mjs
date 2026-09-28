// Local end-to-end check of Stories 2.1-2.8 (route auth, cookie media,
// signed shares, permissions, holes, limits, headers, health, trash
// lifecycle). NOT part of CI.
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
import { randomBytes, randomUUID } from 'node:crypto';
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

const FIXTURES = {
  'clip.mp4': randomBytes(17204),
  'photo.jpg': await sharp({ create: { width: 64, height: 48, channels: 3, background: '#808080' } }).jpeg().toBuffer(),
};

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
async function upload(tok, path, name, folderId = folder.id) {
  const buf = FIXTURES[path];
  const init = await gql(tok, 'mutation($i: InitiateUploadInput!){ initiateUpload(input:$i){ id chunkSize totalChunks } }', { i: { filename: name, totalSize: buf.length, projectId: project.id, folderId } });
  if (init.errors) return { init };
  const s = init.data.initiateUpload;
  const fd = new FormData();
  fd.append('sessionId', s.id); fd.append('chunkIndex', '0'); fd.append('file', new Blob([buf]), name);
  const cr = await fetch(`${B}/api/upload/chunk`, { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: fd });
  const done = await gql(tok, 'mutation($s: ID!){ completeUpload(sessionId:$s){ id thumbnailUrl downloadUrl } }', { s: s.id });
  return { init, session: s, chunkStatus: cr.status, done };
}
const up1 = await upload(editor.token, 'clip.mp4', 'clip.mp4');
ok(up1.chunkStatus === 200 && up1.done.data?.completeUpload?.id, 'editor uploads video', JSON.stringify(up1.done.errors ?? ''));
const up2 = await upload(editor.token, 'photo.jpg', 'photo.jpg');
ok(up2.done.data?.completeUpload?.id, 'editor uploads photo');
const vid = up1.done.data.completeUpload;
const pic = up2.done.data.completeUpload;
ok(!/token=/.test(JSON.stringify([vid, pic])), 'no token in media URLs', JSON.stringify(vid));
const vup = await upload(viewer.token, 'photo.jpg', 'v.jpg');
ok(code(vup.init) === 'FORBIDDEN', 'viewer initiateUpload FORBIDDEN');

// chunk without session / other's session
const init3 = await gql(editor.token, 'mutation($i: InitiateUploadInput!){ initiateUpload(input:$i){ id } }', { i: { filename: 'x.jpg', totalSize: 10, projectId: project.id, folderId: folder.id } });
const sid = init3.data.initiateUpload.id;
const fd = () => { const f = new FormData(); f.append('sessionId', sid); f.append('chunkIndex', '0'); f.append('file', new Blob([Buffer.alloc(10)]), 'x'); return f; };
let r = await fetch(`${B}/api/upload/chunk`, { method: 'POST', body: fd() });
ok(r.status === 401, 'chunk without session 401', r.status);
r = await fetch(`${B}/api/upload/chunk`, { method: 'POST', headers: { authorization: `Bearer ${crew.token}` }, body: fd() });
ok(r.status === 403, "chunk into another user's session 403", r.status);

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
ok(r.status === 200 && r.headers.get('content-length') === String(FIXTURES['clip.mp4'].length), 'HEAD size', r.headers.get('content-length'));
r = await fetch(`${B}/media/z?projectId=${project.id}&folderId=${folder.id}`, { headers: { cookie: editor.cookie } });
ok(r.status === 200 && r.headers.get('content-type') === 'application/zip', 'dashboard zip', r.status);
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
ok(r.status === 404, 'revoked page 404', r.status);

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
const purge = await gql(admin.token, `mutation { permanentDelete(fileId:"${pic.id}") }`);
ok(purge.data?.permanentDelete === true, 'admin permanentDelete allowed (link revoked first)', JSON.stringify(purge.errors ?? ''));
r = await fetch(`${B}/s/${p2.slug}`);
ok(r.status === 404, 'link to purged file 404', r.status);

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
  const n = (await db.query('SELECT count(*)::int AS n FROM notifications WHERE "userId" = $1 AND read = false', [viewer.user.id])).rows[0].n;
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
ok(r.status === 404, 'share page of trashed target 404', r.status);
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
ok(r.status === 404, 'purged target share page 404', r.status);
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

// logout
r = await fetch(`${B}/api/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${flooder.token}` } });
ok(r.status === 200 && /shotstash_session=;/.test(r.headers.get('set-cookie') || ''), 'logout clears cookie', r.headers.get('set-cookie'));
ok(code(await gql(flooder.token, '{ projects { id } }')) === 'UNAUTHENTICATED', 'old token fails GraphQL');
r = await fetch(`${B}/media/i/${vid.id}`, { headers: { cookie: flooder.cookie } });
ok(r.status === 401, 'old token fails media', r.status);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
