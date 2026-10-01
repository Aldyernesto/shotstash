// End-to-end check of Story 5.5 (and the live part of 5.4): realtime through
// Dragonfly against running app processes, with a graphql-ws client.
//
//   WORKER_BOOTSTRAP_TOKEN=<token> npm run dev            (needs Dragonfly)
//   WORKER_BOOTSTRAP_TOKEN=<token> npm run e2e:realtime
//
// Optional E2E_BASE_URL_2: a second app process on the same database and
// Dragonfly (CI starts one on port 3006); subscribers there must receive
// changes made through the first process. Without it that row is skipped.
//
// Needs the seeded development accounts and refuses to run unless the base
// URLs and DATABASE_URL point at localhost. It creates throwaway accounts,
// a throwaway Project and a throwaway job kind.
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';
import { createClient } from 'graphql-ws';

const { createSeqGate, compareChat } = await import('../src/lib/realtimeSeq.ts');

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const B = process.env.E2E_BASE_URL || 'http://localhost:3005';
const B2 = process.env.E2E_BASE_URL_2 || '';
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
for (const url of [B, ...(B2 ? [B2] : [])]) {
  if (!LOCAL.has(hostOf(url))) {
    console.error(`e2e:realtime refuses to run: base URL ${url} is not localhost.`);
    process.exit(2);
  }
}
if (!LOCAL.has(hostOf(process.env.DATABASE_URL || ''))) {
  console.error('e2e:realtime refuses to run: DATABASE_URL does not point at localhost.');
  process.exit(2);
}
const BOOTSTRAP = process.env.WORKER_BOOTSTRAP_TOKEN || '';

let fails = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label} ${extra}`);
  if (!cond) fails++;
};
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5hex = (buf) => createHash('md5').update(buf).digest('hex');
const md5b64 = (buf) => createHash('md5').update(buf).digest('base64');

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
  return { status: r.status, token: body?.token, id: body?.user?.id };
}
async function gql(token, query, variables, base = B) {
  const r = await fetch(`${base}/api/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}
const code = (res) => res.errors?.[0]?.extensions?.code;

/* ---------------- graphql-ws client ---------------- */

const opened = [];

/**
 * Subscribes through `base` with `token`. Collects every payload with its
 * arrival time; `ended()` reports completion or an error.
 */
async function subscribe(base, token, query, variables = {}) {
  let connected;
  const ready = new Promise((r) => (connected = r));
  const client = createClient({
    url: `${base.replace(/^http/, 'ws')}/api/graphql`,
    webSocketImpl: WebSocket,
    connectionParams: { authorization: `Bearer ${token}` },
    lazy: false,
    retryAttempts: 0,
    on: { connected: () => connected() },
  });
  const items = [];
  let end = null;
  const dispose = client.subscribe(
    { query, variables },
    {
      next: (value) => items.push({ at: Date.now(), value }),
      error: (err) => {
        end = { error: err };
      },
      complete: () => {
        end = end ?? { complete: true };
      },
    },
  );
  await Promise.race([ready, sleep(5000)]);
  // The server subscribes to the channel when the operation starts; give it a moment.
  await sleep(700);
  const sub = {
    items,
    ended: () => end,
    async waitFor(pred, ms = 5000) {
      const until = Date.now() + ms;
      for (;;) {
        const hit = items.find((i) => pred(i.value));
        if (hit) return hit;
        if (end || Date.now() > until) return null;
        await sleep(50);
      }
    },
    async waitEnd(ms = 5000) {
      const until = Date.now() + ms;
      while (!end && Date.now() < until) await sleep(50);
      return end;
    },
    async close() {
      try {
        dispose();
      } catch {}
      await client.dispose();
    },
  };
  opened.push(sub);
  return sub;
}

/**
 * Repeats `trigger` until `sub` receives an item matching `match` (the
 * server starts listening on the channel a moment after the operation
 * starts, and nothing tells the client when). Answers the matched item.
 */
async function primed(sub, trigger, match, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const marker = await trigger(i);
    const hit = await sub.waitFor((v) => match(v, marker), 1200);
    if (hit) return hit;
  }
  return null;
}
const chatIs = (v, m) => !!m && v.data?.projectEvents?.chat?.id === m.id;

/* ---------------- setup ---------------- */

const editor = await login('editor@example.com');
const sa = await login('superadmin@example.com');
const viewer = await login('viewer@example.com');
ok(editor.token && sa.token && viewer.token, 'logins');
const proj = await gql(editor.token, '{ projects { id title folders { id name } } }');
const project = proj.data.projects.find((p) => p.title === 'Sample project');
const folder = project.folders[0];

/** A throwaway active account created by the super admin. */
async function account(label, role = 'VIEWER') {
  const name = `${label}${RUN}`;
  const email = `${label.toLowerCase()}-${RUN}@example.com`;
  const password = `realtime-${RUN}-password`;
  const res = await gql(sa.token, 'mutation($i: CreateUserInput!){ register(input:$i){ success errorCode user { id } } }', {
    i: { name, email, password, role },
  });
  if (!res.data?.register?.success) throw new Error(`could not create ${label}: ${JSON.stringify(res)}`);
  const s = await login(email, password);
  return { id: res.data.register.user.id, name, handle: name, token: s.token };
}

const CHAT = 'id seq message createdAt sender { id }';
const send = (tok, message, projectId = project.id) =>
  gql(tok, `mutation($p: ID!, $m: String!){ sendMessage(projectId:$p, message:$m){ ${CHAT} } }`, { p: projectId, m: message });
const PROJECT_EVENTS = `subscription($p: ID!){ projectEvents(projectId:$p){ type id seq chat { ${CHAT} } job { id state status progress seq } } }`;

/* ---------------- mentions arrive live, within 2 s ---------------- */

const target = await account('MentionTarget');
const people = await gql(editor.token, 'query($p: ID!, $q: String){ mentionPeople(projectId:$p, query:$q){ id name handle role } }', { p: project.id, q: target.handle });
ok(people.data?.mentionPeople?.some((p) => p.id === target.id && p.handle === target.handle), 'mentionPeople offers a person with access, by handle', JSON.stringify(people.errors ?? ''));
ok(!(people.data?.mentionPeople ?? []).some((p) => p.id === editor.id), 'mentionPeople leaves out the asker');

const bell = await subscribe(B, target.token, 'subscription { notificationReceived { id type data } }');
const t0 = Date.now();
const mention = await send(editor.token, `hi @${target.handle}, look at this`);
ok(mention.data?.sendMessage?.id, 'editor mentions the target', JSON.stringify(mention.errors ?? ''));
const got = await bell.waitFor((v) => v.data?.notificationReceived?.type === 'chat_mention', 4000);
ok(!!got, 'mention notification arrives through the subscription');
ok(got && got.at - t0 < 2000, 'mention notification within 2 s', got ? `${got.at - t0} ms` : '');

// Without access (deactivated): no notification at all.
const gone = await account('NoAccess');
await gql(sa.token, 'mutation($id: ID!){ deactivateUser(id:$id){ id } }', { id: gone.id });
await send(editor.token, `ping @${gone.handle}`);
await sleep(600);
const goneRows = await sql('SELECT count(*)::int AS n FROM notifications WHERE "userId" = $1', [gone.id]);
ok(goneRows[0].n === 0, 'a mentioned account without access gets no notification', goneRows[0].n);

/* ---------------- mention read filter ---------------- */

const p2 = await gql(editor.token, 'mutation($i: CreateProjectInput!){ createProject(input:$i){ id } }', { i: { title: `Realtime ${RUN}` } });
const p2id = p2.data?.createProject?.id;
ok(!!p2id, 'throwaway Project created', JSON.stringify(p2.errors ?? ''));
await send(editor.token, `@${target.handle} in the other Project`, p2id);
await sleep(600);
const NOTIFS = '{ notifications(unreadOnly: true) { id type data } unreadNotificationCount }';
const beforeLoss = (await gql(target.token, NOTIFS)).data;
const aboutP2 = (n) => {
  try {
    return JSON.parse(n.data || '{}').projectId === p2id;
  } catch {
    return false;
  }
};
ok(beforeLoss?.notifications?.some(aboutP2), 'the target reads the mention of the other Project');
const del = await gql(sa.token, 'mutation($id: ID!){ deleteProject(id:$id) }', { id: p2id });
ok(del.data?.deleteProject === true, 'the other Project is deleted (access lost)', JSON.stringify(del.errors ?? ''));
const afterLoss = (await gql(target.token, NOTIFS)).data;
ok(afterLoss && !afterLoss.notifications.some(aboutP2), 'the old notification of a Project the reader can no longer view is not returned');
const dropped = beforeLoss?.notifications?.filter(aboutP2).length ?? 0;
ok(afterLoss && dropped >= 1 && afterLoss.unreadNotificationCount === beforeLoss.unreadNotificationCount - dropped, 'and the unread count drops with it', `${beforeLoss?.unreadNotificationCount} -> ${afterLoss?.unreadNotificationCount} (${dropped} about it)`);
const stillStored = await sql('SELECT count(*)::int AS n FROM notifications WHERE project_id = $1', [p2id]);
ok(stillStored[0].n >= 1, 'notifications keep their Project in notifications.project_id', stillStored[0].n);

/* ---------------- chat: after commit, order, two processes ---------------- */

const live = await subscribe(B, editor.token, PROJECT_EVENTS, { p: project.id });
const live2 = B2 ? await subscribe(B2, editor.token, PROJECT_EVENTS, { p: project.id }) : null;
const warm = async (sub) => primed(sub, async (i) => (await send(editor.token, `warm-up ${i}`)).data?.sendMessage, chatIs);
ok(!!(await warm(live)), 'the project stream is live');
if (live2) ok(!!(await warm(live2)), 'the project stream on the second process is live');
const m1 = (await send(editor.token, `first ${RUN}`)).data?.sendMessage;
// Let it arrive first (the PGlite dev database runs every connection in one
// session, so a failing transaction must not overlap another reader).
await live.waitFor((v) => v.data?.projectEvents?.id === m1?.id, 4000);
// A NUL byte cannot be stored: the insert fails and its transaction (with the
// per-Project counter bump) rolls back.
const bad = await send(editor.token, `broken ${RUN} \u0000 byte`);
ok(!bad.data?.sendMessage && bad.errors?.length, 'a message whose insert fails is refused', code(bad) ?? '');
const m2 = (await send(editor.token, `second ${RUN}`)).data?.sendMessage;
ok(m1 && m2 && m2.seq === m1.seq + 1, 'the rolled-back insert did not use a sequence number', `${m1?.seq} -> ${m2?.seq}`);
await live.waitFor((v) => v.data?.projectEvents?.id === m2?.id, 4000);
const chatEvents = live.items
  .map((i) => i.value.data?.projectEvents)
  .filter((e) => e?.type === 'chat.created' && e.chat?.message?.includes(RUN) && !e.chat.message.startsWith('warm-up'));
ok(chatEvents.length === 2 && chatEvents[0].id === m1?.id && chatEvents[1].id === m2?.id, 'only committed messages are published, in order', chatEvents.map((e) => e.chat.message).join(' | '));
ok(!chatEvents.some((e) => e.chat.message.includes('broken')), 'the rolled-back message published nothing');
if (live2) {
  const across = await live2.waitFor((v) => v.data?.projectEvents?.id === m2?.id, 4000);
  ok(!!across, 'a subscriber on the second app process receives a change made on the first');
} else {
  console.log('SKIP two app processes (set E2E_BASE_URL_2 to a second server on the same database and Dragonfly)');
}

// Two messages at once: every reader sees the same order, live and in history.
const [x, y] = await Promise.all([send(editor.token, `twin-a ${RUN}`), send(editor.token, `twin-b ${RUN}`)]);
const twins = [x.data?.sendMessage, y.data?.sendMessage];
await live.waitFor((v) => v.data?.projectEvents?.id === twins[0]?.id, 4000);
await live.waitFor((v) => v.data?.projectEvents?.id === twins[1]?.id, 4000);
const history = (await gql(editor.token, `query($p: ID!){ project(id:$p){ chats { ${CHAT} } } }`, { p: project.id })).data?.project?.chats ?? [];
const historyTwins = history.filter((c) => c.message.includes('twin-')).map((c) => c.id);
const liveTwins = live.items
  .map((i) => i.value.data?.projectEvents?.chat)
  .filter((c) => c?.message?.includes('twin-') && c.message.includes(RUN))
  .sort(compareChat)
  .map((c) => c.id);
ok(historyTwins.slice(-2).join() === liveTwins.join() && liveTwins.length === 2, 'history and the live list agree on the order of simultaneous messages');
const sorted = [...history].sort(compareChat);
ok(sorted.map((c) => c.id).join() === history.map((c) => c.id).join(), 'history is ordered by (createdAt, id)');

/* ---------------- jobs: ordered events, a late lower seq is dropped ---------------- */

async function upload(name) {
  const buf = Buffer.concat([Buffer.from('000000186674797069736f6d0000020069736f6d6d703431', 'hex'), randomBytes(4000)]);
  const init = (
    await gql(editor.token, 'mutation($i: InitiateUploadInput!){ initiateUpload(input:$i){ id fileId } }', {
      i: { filename: name, totalSize: buf.length, projectId: project.id, folderId: folder.id },
    })
  ).data.initiateUpload;
  await fetch(`${B}/api/v1/uploads/${init.id}/parts/1`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${editor.token}`, 'content-md5': md5b64(buf), 'content-type': 'application/octet-stream' },
    body: buf,
  });
  const done = await gql(editor.token, 'mutation($s: ID!, $m: String){ completeUpload(sessionId:$s, md5Checksum:$m){ id } }', { s: init.id, m: md5hex(buf) });
  return done.data.completeUpload.id;
}

async function worker(path, { token, bootstrap, claim, body } = {}) {
  const h = { 'content-type': 'application/json' };
  if (token) h['x-worker-token'] = token;
  if (bootstrap) h['x-worker-bootstrap-token'] = bootstrap;
  if (claim) h['x-claim-token'] = claim;
  const r = await fetch(`${B}/api/v1/pipeline/${path}`, { method: 'POST', headers: h, body: JSON.stringify(body ?? {}) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function workerPut(path, { token, claim }, buf) {
  const r = await fetch(`${B}/api/v1/pipeline/${path}`, {
    method: 'PUT',
    headers: { 'x-worker-token': token, 'x-claim-token': claim, 'content-type': 'video/mp4', 'x-output-ext': 'mp4' },
    body: buf,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

if (BOOTSTRAP.length >= 32) {
  const kind = `e2e-rt-${RUN}/probe`;
  const reg = await worker('workers/register', { bootstrap: BOOTSTRAP, body: { manifest: { name: `e2e-rt-${RUN}`, version: '0.0.1', kinds: [kind], contract: 1 } } });
  ok(reg.status === 201, 'test worker registered', reg.status);
  const wt = reg.json?.token;
  const fileId = await upload(`realtime-${RUN}.mp4`);
  const ENQ = 'mutation($f: ID!, $k: String!){ enqueueJob(fileId:$f, kind:$k){ id state seq } }';
  const JOB_SUB = 'subscription($j: ID!){ jobUpdated(jobId:$j){ id state status progress seq } }';
  const enqueueOne = async (f = fileId) => (await gql(editor.token, ENQ, { f, k: kind })).data?.enqueueJob?.id;
  const claimNext = async () => (await worker('jobs/next', { token: wt })).json?.job;
  const jobsOf = (sub) => sub.items.map((i) => i.value.data?.jobUpdated).filter(Boolean);

  const missing = await subscribe(B, editor.token, 'subscription($j: ID!){ jobUpdated(jobId:$j){ id } }', { j: '00000000-0000-4000-8000-000000000000' });
  const missingEnd = await missing.waitEnd(3000);
  const missingCode = missing.items[0]?.value?.errors?.[0]?.extensions?.code;
  ok(!!missingEnd && missing.items.every((i) => !i.value.data?.jobUpdated) && (missingCode === 'NOT_FOUND' || !!missingEnd.error), 'jobUpdated of a missing job is refused', missingCode ?? '');

  // Job 1: claim, progress 10/20/30, output, complete.
  const jobId = await enqueueOne();
  ok(!!jobId, 'job queued');
  const jobSub = await subscribe(B, editor.token, JOB_SUB, { j: jobId });
  // The job channel has no harmless event to prime it with: give it a little longer.
  await sleep(800);
  const job1 = await claimNext();
  ok(job1?.id === jobId, 'the test worker claims the job');
  const claim = job1?.claimToken;
  // Progress events are coalesced to one per job per second: report slower than that.
  for (const progress of [10, 20, 30]) {
    await worker(`jobs/${jobId}/progress`, { token: wt, claim, body: { progress } });
    await sleep(1100);
  }
  const last = await jobSub.waitFor((v) => v.data?.jobUpdated?.progress === 30, 5000);
  ok(!!last, 'progress 30 arrives live');
  let arrived = jobsOf(jobSub);
  const seqs = arrived.map((j) => j.seq);
  ok(seqs.length >= 3 && seqs.every((s, i) => i === 0 || s > seqs[i - 1]), 'job events arrive in seq order, each once (10, 20, 30)', seqs.join(','));
  ok(['10', '20', '30'].every((p) => arrived.some((j) => String(j.progress) === p)) && arrived.at(-1).state === 'running', 'states follow the job', arrived.map((j) => `${j.state}:${j.progress}`).join(','));
  // The client helper: a late copy of the progress-20 event is dropped.
  const gate = createSeqGate();
  const shown = [];
  const late = arrived.find((j) => j.progress === 20);
  for (const j of [...arrived, late]) if (j && gate.accept(`job:${j.id}`, j.seq)) shown.push(j.progress);
  ok(shown.at(-1) === 30 && shown.length === arrived.length, 'the client drops the late lower-seq event and keeps 30', shown.join(','));
  if (live2) {
    const across = await live2.waitFor((v) => v.data?.projectEvents?.job?.id === jobId && v.data.projectEvents.job.progress === 30, 4000);
    ok(!!across, 'job progress reaches a project subscriber on the second app process');
  }
  const seq30 = arrived.at(-1).seq;
  const out = await workerPut(`jobs/${jobId}/output`, { token: wt, claim }, randomBytes(2048));
  ok(out.status === 200, 'the worker uploads the output', out.status);
  const afterOutput = await jobSub.waitFor((v) => (v.data?.jobUpdated?.seq ?? 0) > seq30, 4000);
  ok(!!afterOutput, 'the output raises the job seq', afterOutput ? `${seq30} -> ${afterOutput.value.data.jobUpdated.seq}` : '');
  const fin = await worker(`jobs/${jobId}/complete`, { token: wt, claim });
  ok(fin.status === 200, 'the worker completes the job', fin.status);
  const doneEvent = await jobSub.waitFor((v) => v.data?.jobUpdated?.state === 'done', 4000);
  ok(!!doneEvent && doneEvent.value.data.jobUpdated.seq > afterOutput?.value.data.jobUpdated.seq, 'done arrives live with a higher seq (chip Ready)');

  // Job 2: cancelled while running; the worker gets 409.
  const job2Id = await enqueueOne();
  const sub2 = await subscribe(B, editor.token, JOB_SUB, { j: job2Id });
  await sleep(800);
  const job2 = await claimNext();
  await worker(`jobs/${job2Id}/progress`, { token: wt, claim: job2?.claimToken, body: { progress: 5 } });
  const cancelled = await gql(editor.token, 'mutation($id: ID!){ cancelJob(id:$id){ id state } }', { id: job2Id });
  ok(cancelled.data?.cancelJob?.state === 'cancelled', 'editor cancels the running job');
  ok(!!(await sub2.waitFor((v) => v.data?.jobUpdated?.state === 'cancelled', 4000)), 'the cancel arrives live (chip Cancelled)');
  const late409 = await worker(`jobs/${job2Id}/progress`, { token: wt, claim: job2?.claimToken, body: { progress: 40 } });
  ok(late409.status === 409, 'the worker gets 409 after the cancel', late409.status);

  // Job 3: fails for good.
  const job3Id = await enqueueOne();
  const sub3 = await subscribe(B, editor.token, JOB_SUB, { j: job3Id });
  await sleep(800);
  const job3 = await claimNext();
  await worker(`jobs/${job3Id}/fail`, { token: wt, claim: job3?.claimToken, body: { error: 'e2e failure', retryable: false } });
  ok(!!(await sub3.waitFor((v) => v.data?.jobUpdated?.state === 'failed', 4000)), 'a failed job arrives live (chip Failed)');

  // Job 4: released (back to queued), then its worker is revoked (waiting for worker).
  const job4Id = await enqueueOne();
  const sub4 = await subscribe(B, editor.token, JOB_SUB, { j: job4Id });
  await sleep(800);
  const job4 = await claimNext();
  await worker(`jobs/${job4Id}/release`, { token: wt, claim: job4?.claimToken });
  const released = await sub4.waitFor((v) => v.data?.jobUpdated?.state === 'queued', 4000);
  ok(!!released, 'a released job arrives live as queued');
  await gql(sa.token, 'mutation($id: ID!){ revokeWorker(id:$id){ id } }', { id: reg.json?.workerId });
  const waiting = await sub4.waitFor((v) => v.data?.jobUpdated?.state === 'waiting_for_worker', 4000);
  ok(!!waiting && waiting.value.data.jobUpdated.seq > released?.value.data.jobUpdated.seq, 'revoking the last worker of a kind turns its queued job into waiting for worker, live');
  await gql(editor.token, 'mutation($id: ID!){ cancelJob(id:$id){ id } }', { id: job4Id });

  // Trashing a file cancels its open job; the cancel still reaches project subscribers.
  const viewerSub = await subscribe(B, viewer.token, PROJECT_EVENTS, { p: project.id });
  await warm(viewerSub);
  const trashFile = await upload(`realtime-trash-${RUN}.mp4`);
  const job5Id = await enqueueOne(trashFile);
  const seenByViewer = await viewerSub.waitFor((v) => v.data?.projectEvents?.job?.id === job5Id, 4000);
  ok(!!seenByViewer, 'a viewer follows job changes of the Project (read access)');
  const viewerEnqueue = await gql(viewer.token, ENQ, { f: fileId, k: kind });
  ok(code(viewerEnqueue) === 'FORBIDDEN', 'a viewer cannot trigger jobs', code(viewerEnqueue));
  await gql(editor.token, 'mutation($f: ID!){ moveToTrash(fileId:$f) }', { f: trashFile });
  const trashCancel = await live.waitFor((v) => v.data?.projectEvents?.job?.id === job5Id && v.data.projectEvents.job.state === 'cancelled', 4000);
  ok(!!trashCancel, 'trashing the file delivers its job as cancelled');
} else {
  console.log('SKIP job events (set WORKER_BOOTSTRAP_TOKEN to the value the server runs with)');
}

/* ---------------- uploadProgress and chatMessages ---------------- */
{
  const buf = randomBytes(3000);
  const init = (
    await gql(editor.token, 'mutation($i: InitiateUploadInput!){ initiateUpload(input:$i){ id fileId } }', {
      i: { filename: `progress-${RUN}.bin`, totalSize: buf.length, projectId: project.id, folderId: folder.id },
    })
  ).data?.initiateUpload;
  const prog = await subscribe(B, editor.token, 'subscription($s: ID!){ uploadProgress(sessionId:$s){ sessionId confirmedParts partCount percentage } }', { s: init?.id });
  await fetch(`${B}/api/v1/uploads/${init?.id}/parts/1`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${editor.token}`, 'content-md5': md5b64(buf), 'content-type': 'application/octet-stream' },
    body: buf,
  });
  const p = await prog.waitFor((v) => v.data?.uploadProgress?.confirmedParts === 1, 4000);
  ok(!!p && p.value.data.uploadProgress.percentage === 100 && p.value.data.uploadProgress.partCount === 1, 'uploadProgress reports the confirmed part live', JSON.stringify(p?.value?.data ?? {}));
  await gql(editor.token, 'mutation($s: ID!){ cancelUpload(sessionId:$s) }', { s: init?.id });

  const chatSub = await subscribe(B, viewer.token, `subscription($p: ID!){ chatMessages(projectId:$p){ ${CHAT} } }`, { p: project.id });
  const hit = await primed(chatSub, async (i) => (await send(editor.token, `chatMessages ${i} ${RUN}`)).data?.sendMessage, (v, m) => !!m && v.data?.chatMessages?.id === m.id);
  ok(!!hit, 'chatMessages delivers a sent message');
}

/* ---------------- inactive accounts get no upload notification ---------------- */
{
  const quiet = await account('Quiet');
  await gql(sa.token, 'mutation($id: ID!){ deactivateUser(id:$id){ id } }', { id: quiet.id });
  await upload(`quiet-${RUN}.mp4`);
  await sleep(600);
  const rows = await sql("SELECT count(*)::int AS n FROM notifications WHERE \"userId\" = $1 AND type = 'upload_complete'", [quiet.id]);
  ok(rows[0].n === 0, 'a deactivated account gets no upload_complete notification', rows[0].n);
}

/* ---------------- per-event authorisation ends the stream ---------------- */

const doomed = await account('Doomed');
const doomedSub = await subscribe(B, doomed.token, PROJECT_EVENTS, { p: project.id });
const before = await primed(doomedSub, async (i) => (await send(editor.token, `before deactivation ${i} ${RUN}`)).data?.sendMessage, chatIs);
ok(!!before, 'the subscriber receives events while active', before ? '' : JSON.stringify({ end: doomedSub.ended(), items: doomedSub.items.map((i) => i.value) }).slice(0, 400));
await gql(sa.token, 'mutation($id: ID!){ deactivateUser(id:$id){ id } }', { id: doomed.id });
// A positive check is reused for 5 s per subscription; after that the next event ends the stream.
await sleep(5500);
const after = (await send(editor.token, `after deactivation ${RUN}`)).data?.sendMessage;
const end = await doomedSub.waitEnd(5000);
ok(!!end, 'the stream ends after the account is deactivated', JSON.stringify(end ?? {}).slice(0, 80));
ok(!doomedSub.items.some((i) => i.value.data?.projectEvents?.id === after?.id), 'no event reaches the deactivated subscriber');

/* ---------------- done ---------------- */

for (const s of opened) await s.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
