// Stories 5.4-5.5: realtime helpers (thin events, publish after commit,
// per-event authorised streams, client seq gate, chat order), the job chip
// mapping, the discussion gate and the notification read filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const events = await import('../src/modules/realtime/events.ts');
const { authorizedStream } = await import('../src/modules/realtime/stream.ts');
const { createSeqGate, compareChat, insertOrdered } = await import('../src/lib/realtimeSeq.ts');
const { jobChip, showsOnCard, newerJob } = await import('../src/lib/jobChip.ts');
const { assertDiscussionEnabled } = await import('../src/modules/errors/discussion.ts');
const { visibleNotifications } = await import('../src/lib/notificationAccess.ts');
const { mentionHandleFor, handleMatchesUser, mentionHandles } = await import('../src/lib/mentions.ts');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/* ---------------- events ---------------- */

test('channels are project:, job: and user: with a safe id', () => {
  assert.equal(events.channels.project('p1'), 'project:p1');
  assert.equal(events.channels.job('0199a3b4-aaaa-7bbb-8ccc-123456789abc'), 'job:0199a3b4-aaaa-7bbb-8ccc-123456789abc');
  assert.equal(events.channels.user('u_1'), 'user:u_1');
  assert.throws(() => events.channels.project('a:b'), /invalid project id/);
  assert.throws(() => events.channels.user(''), /invalid user id/);
});

test('an event travels as { type, id, seq } only, never entity data', () => {
  const wire = events.toWire({ type: 'job.updated', id: 'j1', seq: 3, progress: 40, file: { name: 'x' } });
  assert.deepEqual(wire, { type: 'job.updated', id: 'j1', seq: 3 });
  assert.deepEqual(events.fromWire(JSON.stringify(wire)), wire);
  assert.deepEqual(events.fromWire({ type: 'chat.created', id: 'c', seq: '7' }), { type: 'chat.created', id: 'c', seq: 7 });
  assert.equal(events.fromWire({ type: 'nope', id: 'c', seq: 1 }), null);
  assert.equal(events.fromWire({ type: 'chat.created', id: '', seq: 1 }), null);
  assert.equal(events.fromWire({ type: 'chat.created', id: 'c', seq: 'x' }), null);
  assert.equal(events.fromWire('not json'), null);
});

test('afterCommit publishes on every channel only after the write resolved', async () => {
  const sent = [];
  const publish = (ch, ev) => {
    sent.push([ch, ev]);
  };
  let committed = false;
  const write = new Promise((r) => setTimeout(() => {
    committed = true;
    r({ id: 'j1', seq: 2, projectId: 'p1' });
  }, 5));
  const result = await events.afterCommitWith(publish, write, (row) => {
    assert.equal(committed, true, 'events are built after the commit');
    return { channels: [events.channels.job(row.id), events.channels.project(row.projectId)], event: { type: 'job.updated', id: row.id, seq: row.seq } };
  });
  assert.equal(result.id, 'j1');
  assert.deepEqual(sent, [
    ['job:j1', { type: 'job.updated', id: 'j1', seq: 2 }],
    ['project:p1', { type: 'job.updated', id: 'j1', seq: 2 }],
  ]);
});

test('a write that rolls back publishes nothing and rethrows', async () => {
  const sent = [];
  const rolledBack = () => Promise.reject(new Error('rollback'));
  await assert.rejects(
    events.afterCommitWith((ch, ev) => sent.push([ch, ev]), rolledBack, () => ({ channels: ['project:p'], event: { type: 'chat.created', id: 'c', seq: 1 } })),
    /rollback/,
  );
  assert.deepEqual(sent, []);
});

test('a failing publisher never fails the committed write', async () => {
  const errors = [];
  const out = await events.afterCommitWith(
    () => {
      throw new Error('cache down');
    },
    Promise.resolve(5),
    () => ({ channels: ['user:u'], event: { type: 'notification.created', id: 'n', seq: 1 } }),
    (err) => errors.push(err.message),
  );
  assert.equal(out, 5);
  assert.deepEqual(errors, ['cache down']);
});

/* ---------------- authorised streams ---------------- */

/** A channel iterator fed by hand, like graphql-redis-subscriptions'. */
function channel() {
  const queue = [];
  const waiting = [];
  let closed = false;
  return {
    push(v) {
      if (waiting.length) waiting.shift()({ value: v, done: false });
      else queue.push(v);
    },
    closed: () => closed,
    iterator: {
      next() {
        if (closed) return Promise.resolve({ value: undefined, done: true });
        if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
        return new Promise((r) => waiting.push(r));
      },
      async return() {
        closed = true;
        for (const w of waiting.splice(0)) w({ value: undefined, done: true });
        return { value: undefined, done: true };
      },
    },
  };
}

test('every event is re-authorised and loaded; skipped events never reach the client', async () => {
  const ch = channel();
  let checks = 0;
  const stream = authorizedStream({
    source: ch.iterator,
    authorize: async () => {
      checks++;
      return { id: 'u1' };
    },
    deliver: async (ev, actor) => (ev.id === 'secret' ? null : { id: ev.id, seq: ev.seq, for: actor.id }),
  });
  ch.push({ type: 'job.updated', id: 'secret', seq: 1 });
  ch.push({ type: 'job.updated', id: 'j1', seq: 2 });
  const first = await stream.next();
  assert.deepEqual(first.value, { id: 'j1', seq: 2, for: 'u1' });
  assert.equal(checks, 2, 'the subscriber was checked for each event, the skipped one too');
  ch.push('garbage');
  ch.push({ type: 'job.updated', id: 'j1', seq: 3 });
  assert.equal((await stream.next()).value.seq, 3);
  await stream.return();
  assert.equal(ch.closed(), true);
});

test('a revoked session or deactivated account ends the stream at the next event', async () => {
  const ch = channel();
  let allowed = true;
  let ended = null;
  const stream = authorizedStream({
    source: ch.iterator,
    authorize: async () => (allowed ? { id: 'u1' } : null),
    deliver: async (ev) => ev,
    onEnd: (reason) => {
      ended = reason;
    },
  });
  ch.push({ type: 'chat.created', id: 'c1', seq: 1 });
  assert.equal((await stream.next()).done, false);
  allowed = false;
  ch.push({ type: 'chat.created', id: 'c2', seq: 2 });
  const after = await stream.next();
  assert.equal(after.done, true, 'no further event');
  assert.equal(ended, 'revoked');
  assert.equal(ch.closed(), true, 'the channel subscription is released');
});

test('without events the subscriber is re-checked on a timer and the stream ends', async () => {
  const ch = channel();
  let allowed = true;
  const stream = authorizedStream({ source: ch.iterator, authorize: async () => (allowed ? {} : null), deliver: async (e) => e, recheckMs: 20 });
  setTimeout(() => {
    allowed = false;
  }, 30);
  const r = await stream.next();
  assert.equal(r.done, true);
  assert.equal(ch.closed(), true);
});

test('a throwing loader skips the event instead of ending the stream', async () => {
  const ch = channel();
  const stream = authorizedStream({
    source: ch.iterator,
    authorize: async () => ({}),
    deliver: async (ev) => {
      if (ev.id === 'bad') throw new Error('gone');
      return ev.id;
    },
  });
  ch.push({ type: 'job.updated', id: 'bad', seq: 1 });
  ch.push({ type: 'job.updated', id: 'ok', seq: 1 });
  assert.equal((await stream.next()).value, 'ok');
  await stream.return();
});

/* ---------------- client order ---------------- */

test('the seq gate keeps the newest per entity: 10, 20, 30 then a late 20 is dropped', () => {
  const gate = createSeqGate();
  const shown = [];
  for (const seq of [10, 20, 30, 20, 30]) if (gate.accept('job:j1', seq)) shown.push(seq);
  assert.deepEqual(shown, [10, 20, 30]);
  assert.equal(gate.seen('job:j1'), 30);
  assert.equal(gate.accept('job:j2', 1), true, 'entities are independent');
  gate.note('job:j2', 5);
  assert.equal(gate.accept('job:j2', 4), false);
  assert.equal(gate.accept('job:j2', Number.NaN), false);
});

test('the seq gate forgets the oldest entity past its limit', () => {
  const gate = createSeqGate(2);
  gate.accept('a', 1);
  gate.accept('b', 1);
  gate.accept('c', 1);
  assert.equal(gate.seen('a'), null);
  assert.equal(gate.seen('c'), 1);
});

test('chat order is (createdAt, id): two messages of the same millisecond sort the same for everyone', () => {
  const t = '2026-10-01T10:00:00.000Z';
  const a = { id: '0199a3b4-0000-7000-8000-000000000001', createdAt: t };
  const b = { id: '0199a3b4-0000-7000-8000-000000000002', createdAt: t };
  const c = { id: '0199a3b4-0000-7000-8000-000000000000', createdAt: '2026-10-01T10:00:00.001Z' };
  assert.deepEqual([b, c, a].sort(compareChat).map((m) => m.id.slice(-1)), ['1', '2', '0']);
  // Live arrival in any order ends in the history order; a repeat replaces.
  let list = [];
  for (const m of [c, b, a, b]) list = insertOrdered(list, m);
  assert.deepEqual(list.map((m) => m.id), [a.id, b.id, c.id]);
  assert.equal(compareChat({ id: 'x', createdAt: String(Date.parse(t)) }, { id: 'y', createdAt: t }), -1, 'epoch strings compare as times');
});

/* ---------------- job chip ---------------- */

test('job chip: tone, label and stage per state', () => {
  const rows = [
    ['queued', 'neutral', 'queued', 'queued'],
    ['waiting_for_worker', 'warning', 'waiting_for_worker', 'queued'],
    ['claimed', 'accent', 'claimed', 'queued'],
    ['running', 'accent', 'running', 'running'],
    ['done', 'ok', 'done', 'ready'],
    ['failed', 'danger', 'failed', 'failed'],
    ['cancelled', 'neutral', 'cancelled', 'cancelled'],
  ];
  for (const [state, tone, labelKey, stage] of rows) {
    const chip = jobChip({ state, progress: 42 });
    assert.equal(chip.tone, tone, state);
    assert.equal(chip.labelKey, labelKey, state);
    assert.equal(chip.stage, stage, state);
  }
  assert.equal(jobChip({ state: 'running', progress: 42.9 }).progress, 42);
  assert.equal(jobChip({ state: 'running', progress: 140 }).progress, 100);
  assert.equal(jobChip({ state: 'queued', progress: 42 }).progress, null);
  assert.equal(jobChip({ state: 'failed' }).retry, true);
  assert.equal(jobChip({ state: 'running' }).open, true);
  assert.equal(jobChip({ state: 'done' }).open, false);
  assert.equal(jobChip({ state: 'mystery' }), null);
  assert.equal(jobChip(null), null);
});

test('cards show unfinished and failed jobs, never done or cancelled', () => {
  assert.deepEqual(
    ['queued', 'waiting_for_worker', 'claimed', 'running', 'done', 'failed', 'cancelled'].filter((state) => showsOnCard({ state })),
    ['queued', 'waiting_for_worker', 'claimed', 'running', 'failed'],
  );
});

test('the newer view of a job wins: same job by seq, another job by updatedAt', () => {
  const a = { id: 'j1', seq: 3, updatedAt: '2026-10-01T10:00:00Z' };
  const b = { id: 'j1', seq: 5, updatedAt: '2026-10-01T09:00:00Z' };
  assert.equal(newerJob(a, b), b);
  assert.equal(newerJob(b, a), b);
  const fresh = { id: 'j2', seq: 1, updatedAt: '2026-10-01T11:00:00Z' };
  assert.equal(newerJob(a, fresh), fresh);
  assert.equal(newerJob(fresh, a), fresh);
  assert.equal(newerJob(null, a), a);
  assert.equal(newerJob(a, null), a);
});

/* ---------------- discussion toggle ---------------- */

test('discussion gate: FEATURE_DISABLED while off, nothing while on', () => {
  assert.doesNotThrow(() => assertDiscussionEnabled({ discussion: true }));
  try {
    assertDiscussionEnabled({ discussion: false });
    assert.fail('expected FEATURE_DISABLED');
  } catch (err) {
    assert.equal(err.extensions.code, 'FEATURE_DISABLED');
  }
});

test('the discussion toggle never changes the schema', () => {
  const schema = read('src/graphql/schema.ts');
  assert.match(schema, /discussion: Boolean!/);
  for (const field of ['sendMessage(', 'chatMessages(', 'mentionPeople(', 'chats: [ProjectChat!]!', 'projectEvents(']) {
    assert.ok(schema.includes(field), `${field} stays in the schema`);
  }
  assert.doesNotMatch(read('src/graphql/schema.ts'), /SHOTSTASH_FEATURE_DISCUSSION\s*\?/);
});

/* ---------------- notifications and mentions ---------------- */

test('notifications of a Project the reader can no longer view are dropped at read', () => {
  const rows = [
    { id: 'n1', projectId: 'p1' },
    { id: 'n2', projectId: 'p2' },
    { id: 'n3', projectId: null },
  ];
  assert.deepEqual(visibleNotifications(rows, new Set(['p1'])).map((n) => n.id), ['n1', 'n3']);
  assert.deepEqual(visibleNotifications(rows, new Set()).map((n) => n.id), ['n3']);
});

test('a person is offered with a handle the mention parser matches', () => {
  const crew = { name: 'Field Crew', email: 'crew@example.com' };
  assert.equal(mentionHandleFor(crew), 'FieldCrew');
  assert.equal(handleMatchesUser(mentionHandles(`hi @${mentionHandleFor(crew)}`)[0], crew), true);
  const odd = { name: "O'Brien (lead)", email: 'obrien@example.com' };
  assert.equal(mentionHandleFor(odd), 'obrien');
  assert.equal(handleMatchesUser(mentionHandles(`@${mentionHandleFor(odd)} ok`)[0], odd), true);
});

/* ---------------- source rules ---------------- */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test('every publisher goes through the realtime module; old channel names are gone', () => {
  const files = walk(path.join(ROOT, 'src'));
  for (const file of files) {
    const rel = path.relative(ROOT, file).replaceAll('\\', '/');
    const src = readFileSync(file, 'utf8');
    for (const old of ['CHAT_MESSAGES_', 'UPLOAD_PROGRESS_', 'NOTIFICATIONS_']) {
      assert.ok(!src.includes(old), `${rel} still uses the ${old} channel`);
    }
    if (rel.startsWith('src/modules/realtime/') || rel === 'src/lib/pubsub.ts') continue;
    assert.ok(!/pubsub\.(publish|asyncIterator)\(/.test(src), `${rel} talks to pub/sub directly`);
  }
});

test('every subscription streams through the per-event authorisation', () => {
  const src = read('src/graphql/resolvers.ts');
  const block = src.slice(src.indexOf('  Subscription: {'), src.indexOf('// Story 2.5: the project list type'));
  const fields = [...block.matchAll(/^ {4}(\w+): \{$/gm)].map((m) => m[1]);
  assert.deepEqual(fields.sort(), ['chatMessages', 'jobUpdated', 'notificationReceived', 'projectEvents', 'uploadProgress']);
  assert.equal((block.match(/return guardedStream\(/g) ?? []).length, fields.length, 'each subscribe returns a guarded stream');
  assert.ok(!block.includes('channelMessages('), 'no raw channel iterator reaches a client');
});

test('job changes are announced after their statement in every writer', () => {
  const src = read('src/modules/pipeline/service.ts');
  for (const fn of ['claimNext', 'reportProgress', 'storeOutput', 'completeJob', 'releaseJob', 'cancelJobsOfTrashedFiles', 'failJob', 'sweepExpiredClaims', 'enqueueJob', 'cancelJob']) {
    const start = src.indexOf(`export async function ${fn}(`);
    assert.ok(start >= 0, fn);
    const end = src.indexOf('\nexport ', start + 10);
    assert.match(src.slice(start, end), /await announceJobs\(/, `${fn} announces its change`);
  }
});

test('migration 0008: chat seq per Project, history index, notifications.project_id backfilled', () => {
  const sql = read('prisma/migrations/0008_realtime_chat_order/migration.sql');
  assert.match(sql, /ADD COLUMN "chat_seq" BIGINT NOT NULL DEFAULT 0/);
  assert.match(sql, /ADD COLUMN "seq" BIGINT NOT NULL DEFAULT 0/);
  assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY "projectId" ORDER BY "createdAt", "id"\)/);
  assert.match(sql, /"project_chats"\("projectId", "createdAt", "id"\)/);
  assert.match(sql, /ADD COLUMN "project_id" TEXT/);
  assert.match(sql, /"data"->>'projectId'/);
  assert.match(sql, /CREATE INDEX "notifications_project_id_idx"/);
});
