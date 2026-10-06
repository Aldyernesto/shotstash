// End-to-end check of demo mode (Story 8.2) against an app process started
// with SHOTSTASH_DEMO_MODE=true and SHOTSTASH_CORS_ORIGINS=<E2E_CORS_ORIGIN>,
// after `node dist/demo.js seed`, on the same database as a normal process
// (E2E_OTHER_BASE_URL). CI runs it in the e2e job:
//
//   node dist/demo.js seed
//   PORT=3008 node dist/server.js            (demo env)
//   E2E_BASE_URL=http://127.0.0.1:3008 E2E_OTHER_BASE_URL=http://127.0.0.1:3005 npm run e2e:demo
//
// Needs the development accounts (prisma/seed.ts), DATABASE_URL on localhost
// (it reads rows directly) and the demo env (it runs `node dist/demo.js reset`).
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const B = process.env.E2E_BASE_URL || 'http://localhost:3008';
const OTHER = process.env.E2E_OTHER_BASE_URL || 'http://localhost:3005';
const PASSWORD = process.env.E2E_DEMO_PASSWORD || process.env.DEMO_ADMIN_PASSWORD || '';
const ALLOWED = process.env.E2E_CORS_ORIGIN || 'https://docs.example.test';
const REFUSED = 'https://elsewhere.example.test';
const DEV_PASSWORD = 'shotstash-dev';
const DEMO = ['demo-admin@example.com', 'demo-editor@example.com', 'demo-viewer@example.com'];
const PROJECT_ID = 'd0000000-0000-4000-8000-000000000001';

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
for (const url of [B, OTHER, process.env.DATABASE_URL ?? '']) {
  if (!LOCAL.has(hostOf(url))) {
    console.error(`e2e:demo refuses to run: ${url || 'DATABASE_URL'} is not localhost.`);
    process.exit(2);
  }
}
if (PASSWORD.length < 10) {
  console.error('e2e:demo needs E2E_DEMO_PASSWORD (the DEMO_ADMIN_PASSWORD of the demo process).');
  process.exit(2);
}

let fails = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label} ${extra}`);
  if (!cond) fails++;
};
const json = (o) => JSON.stringify(o ?? null).slice(0, 300);

// Prisma writes timestamp(3) columns in UTC without a zone: read them as UTC.
pg.types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));
let db = null;
const q = async (sql, params = []) => {
  if (!db) {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
  }
  return (await db.query(sql, params)).rows;
};
/** Closes the direct connection (small local databases accept few connections). */
const closeDb = async () => {
  await db?.end();
  db = null;
};

// A keep-alive socket the server closed during a long pause (the reset) fails
// once with ECONNRESET; one retry on a fresh socket is enough.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  try {
    return await realFetch(url, init);
  } catch (err) {
    if (err?.cause?.code !== 'ECONNRESET' && err?.cause?.code !== 'UND_ERR_SOCKET') throw err;
    return realFetch(url, init);
  }
};

async function login(email, password, base = B) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await r.json().catch(() => ({}));
  const media = r.headers.getSetCookie().find((c) => c.startsWith('shotstash_session='));
  return { status: r.status, token: body.token ?? null, cookie: media ? media.split(';')[0] : '' };
}

async function gql(token, query, variables, base = B) {
  const r = await fetch(`${base}/api/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}
const code = (res) => res.errors?.[0]?.extensions?.code ?? null;

async function md5Of(url, cookie) {
  const r = await fetch(`${B}${url}`, { headers: { cookie } });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, md5: createHash('md5').update(buf).digest('hex'), size: buf.length };
}

const PROJECT_QUERY = `query($p: ID!){ project(id:$p){ id title folders { id name } chats { id }
  files { id originalName mimeType md5Checksum thumbnailUrl downloadUrl } } }`;

/** Rows of the demo Project as the database has them. */
async function projectRows() {
  const [row] = await q(
    `select (select count(*) from media_files where "projectId" = $1)::int as files,
            (select count(*) from folders where "projectId" = $1)::int as folders,
            (select count(*) from project_chats where "projectId" = $1)::int as chats,
            (select count(*) from share_links s join folders f on f.id = s."folderId" where f."projectId" = $1)::int as shares`,
    [PROJECT_ID],
  );
  return row;
}

/* ---------------- config: demo process and normal process ---------------- */

const cfg = await (await fetch(`${B}/api/v1/config`)).json();
ok(cfg.features?.demo === true, 'config: features.demo is true');
ok(cfg.features?.signup === false, 'config: sign-up is off in demo mode');
ok(cfg.demo?.password === PASSWORD && cfg.demo?.accounts?.map((a) => a.email).join() === DEMO.join(), 'config: demo accounts and password are published', json(cfg.demo?.accounts));
const otherCfg = await (await fetch(`${OTHER}/api/v1/config`)).json();
ok(otherCfg.features?.demo === false && otherCfg.demo === null, 'config: a normal instance publishes no demo data');
const off = await fetch(`${OTHER}/api/v1/demo/session`, { method: 'POST' });
ok(off.status === 404, 'demo session endpoint answers 404 without demo mode', String(off.status));

/* ---------------- before: what must survive a reset ---------------- */

const [settingsBefore] = await q('select id, setup_completed_at from instance_settings');
const othersBefore = await q(
  `select id, email, role, "passwordHash", active, read_only from users where email <> all($1::text[]) order by email`,
  [DEMO],
);
ok(!!settingsBefore && othersBefore.some((u) => u.role === 'SUPER_ADMIN'), 'setup is done and a super admin exists');

/* ---------------- seeded data, read by every demo account ---------------- */

const sessions = {};
for (const email of DEMO) {
  const s = await login(email, PASSWORD);
  ok(s.status === 200 && s.token, `sign-in works for ${email}`, String(s.status));
  sessions[email] = s;
  const me = await gql(s.token, '{ me { email readOnly features { demo signup } } }');
  ok(me.data?.me?.readOnly === true && me.data.me.features.demo === true, `${email} is read-only and sees demo mode`, json(me.data ?? me.errors));
}
const viewer = sessions['demo-viewer@example.com'];
const editor = sessions['demo-editor@example.com'];
const admin = sessions['demo-admin@example.com'];

const seeded = (await gql(viewer.token, PROJECT_QUERY, { p: PROJECT_ID })).data?.project;
ok(seeded?.files?.length === 10, 'demo Project has 10 files', String(seeded?.files?.length));
ok(seeded?.folders?.length === 3 && seeded?.chats?.length === 3, 'demo Project has 3 sections and a discussion');
const media = seeded?.files ?? [];
ok(media.filter((f) => f.mimeType === 'video/mp4').length === 3 && media.some((f) => f.mimeType === 'application/pdf'), 'clips and a document are there');
ok(media.filter((f) => f.thumbnailUrl).length === 9, 'every still and clip has a thumbnail', String(media.filter((f) => f.thumbnailUrl).length));
for (const f of media) {
  const got = await md5Of(f.downloadUrl, viewer.cookie);
  if (got.status !== 200 || got.md5 !== f.md5Checksum) ok(false, `bytes of ${f.originalName}`, `${got.status} ${got.md5}`);
}
ok(true, 'every original downloads with its MD5');
const thumb = media.find((f) => f.thumbnailUrl);
ok((await md5Of(thumb.thumbnailUrl, viewer.cookie)).status === 200, 'a thumbnail loads');
const clip = media.find((f) => f.originalName.includes('harbor-wide'));
const versions = (await gql(viewer.token, 'query($f: ID!){ processedVersions(fileId:$f){ kind mimeType downloadUrl } }', { f: clip?.id })).data?.processedVersions ?? [];
ok(versions.length === 1 && versions[0].kind === 'shotstash/proxy-720p', 'the wide clip has one 720p proxy', json(versions));
ok(versions[0] && (await md5Of(versions[0].downloadUrl, viewer.cookie)).status === 200, 'the proxy loads');
const [share] = await q(`select s.slug from share_links s join folders f on f.id = s."folderId" where f."projectId" = $1 and s.revoked_at is null`, [PROJECT_ID]);
const sharePage = share ? await fetch(`${B}/s/${share.slug}/items?offset=0&limit=12`) : null;
const shareBody = sharePage?.ok ? await sharePage.json() : null;
ok(shareBody?.files?.length === 6, 'the public share link shows the six stills', String(sharePage?.status));

/* ---------------- every write class is refused for demo accounts ---------------- */

const rowsBefore = await projectRows();
const folderId = seeded?.folders?.[0]?.id;
const fileId = media[0]?.id;
const writes = [
  ['createProject', 'mutation { createProject(input:{ title:"x" }) { id } }'],
  ['updateProject', `mutation { updateProject(id:"${PROJECT_ID}", input:{ title:"x" }) { id } }`],
  ['createFolder', `mutation { createFolder(projectId:"${PROJECT_ID}", name:"x") { id } }`],
  ['renameFolder', `mutation { renameFolder(folderId:"${folderId}", name:"x") { id } }`],
  ['moveToTrash', `mutation { moveToTrash(fileId:"${fileId}") }`],
  ['permanentDelete', `mutation { permanentDelete(fileId:"${fileId}") }`],
  ['createShareLink', `mutation { createShareLink(input:{ fileId:"${fileId}", mode:PUBLIC }) { id } }`],
  ['sendMessage', `mutation { sendMessage(projectId:"${PROJECT_ID}", message:"x") { id } }`],
  ['enqueueJob', `mutation { enqueueJob(fileId:"${clip?.id}", kind:"shotstash/proxy-720p") { id } }`],
  ['initiateUpload', `mutation { initiateUpload(input:{ filename:"x.jpg", totalSize:10, projectId:"${PROJECT_ID}", folderId:"${folderId}" }) { id } }`],
  ['updateProfile', 'mutation { updateProfile(name:"x") { id } }'],
  ['markNotificationsRead', 'mutation { markNotificationsRead }'],
];
for (const who of [admin, editor]) {
  for (const [name, mutation] of writes) {
    const r = await gql(who.token, mutation);
    if (code(r) !== 'FORBIDDEN') ok(false, `${name} is refused`, json(r));
  }
}
ok(true, 'every GraphQL write is refused with FORBIDDEN (demo admin and editor)');

const form = new FormData();
form.append('kind', 'user');
form.append('file', new Blob([Buffer.from('not an image')], { type: 'image/jpeg' }), 'a.jpg');
const cover = await fetch(`${B}/api/upload/cover`, { method: 'POST', headers: { authorization: `Bearer ${editor.token}` }, body: form });
ok(cover.status === 403, 'avatar upload is refused', String(cover.status));

// An upload session of the super admin: a demo account may not send its parts.
const owner = await login('superadmin@example.com', DEV_PASSWORD);
const init = await gql(owner.token, 'mutation($i: InitiateUploadInput!){ initiateUpload(input:$i){ id } }', {
  i: { filename: 'owner-only.bin', totalSize: 16, projectId: PROJECT_ID, folderId },
});
const ownerSession = init.data?.initiateUpload?.id;
const part = Buffer.alloc(16, 7);
const put = await fetch(`${B}/api/v1/uploads/${ownerSession}/parts/1`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${editor.token}`, 'content-md5': createHash('md5').update(part).digest('base64') },
  body: part,
});
ok(ownerSession && put.status === 403, 'upload parts are refused for a demo account', `${put.status}`);
await gql(owner.token, 'mutation($s: ID!){ cancelUpload(sessionId:$s) }', { s: ownerSession });
ok(JSON.stringify(await projectRows()) === JSON.stringify(rowsBefore), 'nothing was written', json(await projectRows()));

const reg = await gql(null, 'mutation { register(input:{ name:"New", email:"new-demo-user@example.com", password:"long-enough-pw" }) { success errorCode } }');
ok(reg.data?.register?.errorCode === 'FEATURE_DISABLED', 'sign-up answers FEATURE_DISABLED', json(reg));

/* ---------------- the try-it session and CORS ---------------- */

const pre = await fetch(`${B}/api/graphql`, {
  method: 'OPTIONS',
  headers: { origin: ALLOWED, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' },
});
ok(
  pre.status === 204 && pre.headers.get('access-control-allow-origin') === ALLOWED && !pre.headers.get('access-control-allow-credentials') &&
    /authorization/i.test(pre.headers.get('access-control-allow-headers') ?? ''),
  'CORS preflight from the allowed origin',
  `${pre.status} ${pre.headers.get('access-control-allow-origin')}`,
);
const preRefused = await fetch(`${B}/api/graphql`, { method: 'OPTIONS', headers: { origin: REFUSED, 'access-control-request-method': 'POST' } });
ok(!preRefused.headers.get('access-control-allow-origin'), 'no CORS headers for another origin (preflight)');
const cfgAllowed = await fetch(`${B}/api/v1/config`, { headers: { origin: ALLOWED } });
ok(cfgAllowed.headers.get('access-control-allow-origin') === ALLOWED, 'CORS: the allowed origin is echoed on a request');
const cfgRefused = await fetch(`${B}/api/v1/config`, { headers: { origin: REFUSED } });
ok(!cfgRefused.headers.get('access-control-allow-origin'), 'no CORS headers for another origin (request)');
const otherPre = await fetch(`${OTHER}/api/graphql`, { method: 'OPTIONS', headers: { origin: ALLOWED, 'access-control-request-method': 'POST' } });
ok(!otherPre.headers.get('access-control-allow-origin'), 'no CORS at all on an instance without SHOTSTASH_CORS_ORIGINS');
const media404 = await fetch(`${B}/media/d/${fileId}`, { headers: { origin: ALLOWED, cookie: viewer.cookie } });
ok(!media404.headers.get('access-control-allow-origin'), 'CORS covers /api only, never /media');

const refusedSession = await fetch(`${B}/api/v1/demo/session`, { method: 'POST', headers: { origin: REFUSED } });
ok(refusedSession.status === 403, 'demo session refused for another origin', String(refusedSession.status));
const before = Date.now();
const tryIt = await fetch(`${B}/api/v1/demo/session`, { method: 'POST', headers: { origin: ALLOWED } });
const tryBody = await tryIt.json().catch(() => ({}));
const minutes = (new Date(tryBody.expiresAt).getTime() - before) / 60000;
ok(tryIt.status === 200 && tryBody.token && minutes > 58 && minutes < 61, 'demo session: a 60-minute token', `${tryIt.status} ${minutes.toFixed(1)}`);
ok(tryIt.headers.get('access-control-allow-origin') === ALLOWED, 'demo session answer carries the CORS header');
const tryMe = await gql(tryBody.token, '{ me { email readOnly } projects { id } }');
ok(tryMe.data?.me?.email === 'demo-viewer@example.com' && tryMe.data.me.readOnly === true && tryMe.data.projects.length >= 1, 'the try-it token reads', json(tryMe.data ?? tryMe.errors));
ok(code(await gql(tryBody.token, `mutation { createFolder(projectId:"${PROJECT_ID}", name:"x") { id } }`)) === 'FORBIDDEN', 'the try-it token cannot write');
const [row] = await q('select "expiresAt" from sessions where token = $1', [tryBody.token]);
ok(row && new Date(row.expiresAt).getTime() === new Date(tryBody.expiresAt).getTime(), 'the try-it session does not slide');

/* ---------------- reset restores what was changed or deleted ---------------- */

const victim = media.find((f) => f.mimeType === 'image/jpeg');
ok((await gql(owner.token, `mutation { moveToTrash(fileId:"${victim.id}") }`)).data?.moveToTrash === true, 'the owner trashes a demo file');
ok((await gql(owner.token, `mutation { permanentDelete(fileId:"${victim.id}") }`)).data?.permanentDelete === true, 'the owner deletes it for good');
const renamed = await gql(owner.token, `mutation { updateProject(id:"${PROJECT_ID}", input:{ title:"Changed" }) { id title } }`);
ok(renamed.data?.updateProject?.title === 'Changed', 'the owner renames the demo Project', json(renamed.errors));
await q(`delete from users where email = 'demo-viewer@example.com'`);
ok((await md5Of(victim.downloadUrl, admin.cookie)).status === 404, 'the deleted file is gone');

await closeDb();
const reset = spawnSync(process.execPath, ['dist/demo.js', 'reset'], { encoding: 'utf8', env: process.env });
console.log(reset.stdout.trim());
ok(reset.status === 0, 'node dist/demo.js reset', reset.stderr.slice(0, 300));

ok((await gql(viewer.token, '{ me { id } }')).data?.me == null, 'demo sessions were removed');
const fresh = await login('demo-viewer@example.com', PASSWORD);
ok(fresh.status === 200, 'the deleted demo account is back');
const restored = (await gql(fresh.token, PROJECT_QUERY, { p: PROJECT_ID })).data?.project;
ok(restored?.title === 'Coastline promo' && restored.files.length === 10, 'the demo Project is restored', `${restored?.title} ${restored?.files?.length}`);
let bytesOk = true;
for (const f of restored?.files ?? []) {
  const got = await md5Of(f.downloadUrl, fresh.cookie);
  if (got.status !== 200 || got.md5 !== f.md5Checksum) bytesOk = false;
}
ok(bytesOk, 'restored files download with their MD5');
ok(!restored?.files.some((f) => media.some((m) => m.id === f.id)), 'old rows were replaced, not kept');
if ((process.env.STORAGE_BACKEND ?? 'local') === 'local') {
  const root = process.env.STORAGE_LOCAL_ROOT || './data/media';
  const left = media.filter((f) => existsSync(path.join(root, 'files', f.id)));
  ok(left.length === 0, 'bytes of the old rows are gone from storage', left.map((f) => f.id).join(' '));
}

const [settingsAfter] = await q('select id, setup_completed_at from instance_settings');
ok(JSON.stringify(settingsAfter) === JSON.stringify(settingsBefore), 'instance_settings is unchanged');
const othersAfter = await q(
  `select id, email, role, "passwordHash", active, read_only from users where email <> all($1::text[]) order by email`,
  [DEMO],
);
ok(JSON.stringify(othersAfter) === JSON.stringify(othersBefore), 'the super admin and every other account are unchanged');
ok((await login('superadmin@example.com', DEV_PASSWORD)).status === 200, 'the owner still signs in');

/* ---------------- rate limit of the try-it endpoint ---------------- */

let limited = null;
for (let i = 0; i < 12 && !limited; i++) {
  const r = await fetch(`${B}/api/v1/demo/session`, { method: 'POST' });
  if (r.status === 429) limited = r;
}
ok(limited && Number(limited.headers.get('retry-after')) > 0, 'demo sessions are rate limited per IP (429)');

await closeDb();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
