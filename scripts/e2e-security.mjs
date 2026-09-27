// Local end-to-end check of Stories 2.1-2.4 (route auth, cookie media,
// signed shares, permissions). NOT part of CI.
//
//   npm run dev:db; npx prisma migrate deploy; npx tsx prisma/seed.ts; npm run dev
//   npm run e2e:security            # E2E_BASE_URL defaults to http://localhost:3005
//
// Refuses to run unless the base URL and DATABASE_URL both point at
// localhost / 127.0.0.1. It creates uploads, share links and a trashed and
// purged file in that database. Login limits (10 per 15 min per IP and per
// email) mean a second run within 15 minutes needs a server restart.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

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

const sa = await login('superadmin@example.com');
ok(sa.status === 200 && sa.token, 'login REST 200 + token');
ok(/HttpOnly/i.test(sa.sc) && /SameSite=Lax/i.test(sa.sc) && /Path=\/media/i.test(sa.sc) && !/Secure/i.test(sa.sc), 'cookie attributes', sa.sc);
const bad = await login('superadmin@example.com', 'wrong-password');
ok(bad.status === 401, 'wrong password 401');
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
async function upload(tok, path, name) {
  const buf = FIXTURES[path];
  const init = await gql(tok, 'mutation($i: InitiateUploadInput!){ initiateUpload(input:$i){ id chunkSize totalChunks } }', { i: { filename: name, totalSize: buf.length, projectId: project.id, folderId: folder.id } });
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
const purge = await gql(admin.token, `mutation { permanentDelete(fileId:"${pic.id}") }`);
ok(purge.data?.permanentDelete === true, 'admin permanentDelete allowed (link revoked first)', JSON.stringify(purge.errors ?? ''));

// deactivation
const ro = await gql(sa.token, `mutation { deactivateUser(id:"${crew.user.id}") { id active } }`);
ok(ro.data?.deactivateUser?.active === false, 'SA deactivates crew');
ok(code(await gql(crew.token, '{ projects { id } }')) === 'UNAUTHENTICATED', 'deactivated user rejected');
await gql(sa.token, `mutation { reactivateUser(id:"${crew.user.id}") { id } }`);

// logout
r = await fetch(`${B}/api/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${viewer.token}` } });
ok(r.status === 200 && /shotstash_session=;/.test(r.headers.get('set-cookie') || ''), 'logout clears cookie', r.headers.get('set-cookie'));
ok(code(await gql(viewer.token, '{ projects { id } }')) === 'UNAUTHENTICATED', 'old token fails GraphQL');
r = await fetch(`${B}/media/i/${vid.id}`, { headers: { cookie: viewer.cookie } });
ok(r.status === 401, 'old token fails media', r.status);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
