// Reference worker loop against a fake contract server over real HTTP:
// backoff on 503, register, claim, input, progress, output, complete;
// re-registration after 401; a cancelled job is dropped without a fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContractClient } from '../src/client.mjs';
import { createLogger } from '../src/log.mjs';
import { createWorker } from '../src/worker.mjs';

const JOB_ID = '0192f0c4-1111-7000-8000-000000000001';
const INPUT = Buffer.from('fake input bytes');

/** A scripted contract server; `script` decides answers, `calls` records them. */
async function fakeServer(script) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const call = { method: req.method, path: req.url, headers: req.headers, body };
    calls.push(call);
    const answer = (await script(call, calls)) ?? { status: 404, json: { code: 'NOT_FOUND', message: 'no' } };
    const headers = { 'X-Shotstash-Pipeline': '1', ...(answer.headers ?? {}) };
    if (answer.raw) {
      res.writeHead(answer.status, headers).end(answer.raw);
    } else if (answer.json) {
      res.writeHead(answer.status, { ...headers, 'Content-Type': 'application/json' }).end(JSON.stringify(answer.json));
    } else {
      res.writeHead(answer.status, headers).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { calls, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const quietLog = () => {
  const lines = [];
  return { lines, log: createLogger({ level: 'debug', write: (l) => lines.push(JSON.parse(l)) }) };
};

const job = { id: JOB_ID, kind: 'shotstash/proxy-720p', params: {}, attempt: 1, maxAttempts: 3, claimToken: 'claim-1', input: { url: `/api/v1/pipeline/jobs/${JOB_ID}/input`, size: INPUT.length } };

async function until(cond, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

test('backs off on 503, registers, processes a job end to end and never logs a token', async () => {
  let registerTries = 0;
  let served = false;
  const srv = await fakeServer((c) => {
    if (c.path.endsWith('/workers/register')) {
      registerTries++;
      if (registerTries === 1) return { status: 503, json: { code: 'SETUP_REQUIRED', message: 'setup' } };
      assert.equal(c.headers['x-worker-bootstrap-token'], 'bootstrap-secret');
      const m = JSON.parse(c.body).manifest;
      assert.equal(m.contract, 1);
      return { status: 201, json: { workerId: 'w1', token: 'worker-secret', contract: 1, heartbeatSeconds: 30, leaseSeconds: 90 } };
    }
    assert.equal(c.headers['x-worker-token'], 'worker-secret');
    if (c.path.endsWith('/workers/heartbeat')) return { status: 200, json: { contract: 1, lostJobIds: [] } };
    if (c.path.endsWith('/jobs/next')) {
      if (served) return { status: 204 };
      served = true;
      return { status: 200, json: { job } };
    }
    assert.equal(c.headers['x-claim-token'], 'claim-1');
    if (c.path.endsWith('/input')) return { status: 200, raw: INPUT };
    if (c.path.endsWith('/progress')) return { status: 200, json: { status: 'running', progress: JSON.parse(c.body).progress, seq: 1 } };
    if (c.path.endsWith('/output')) return { status: 200, json: { versionId: 'v1', size: c.body.length, mimeType: 'video/mp4' } };
    if (c.path.endsWith('/complete')) return { status: 200, json: { status: 'done', versionId: 'v1' } };
  });
  const { lines, log } = quietLog();
  const client = new ContractClient({ baseUrl: srv.url, bootstrapToken: 'bootstrap-secret', manifest: { name: 't', version: '0.0.1', kinds: ['shotstash/proxy-720p'] } });
  let seenInput = null;
  const worker = createWorker({
    client,
    log,
    tmpDir: tmpdir(),
    pollSeconds: 0.02,
    backoffSeconds: 0.05,
    process: async (_job, { dir, input, progress }) => {
      const { readFile } = await import('node:fs/promises');
      seenInput = await readFile(input);
      progress(50);
      const out = join(dir, 'proxy.mp4');
      await writeFile(out, 'proxy bytes');
      return { path: out, mimeType: 'video/mp4', ext: 'mp4' };
    },
  });
  void worker.start();
  assert.ok(await until(() => srv.calls.some((c) => c.path.endsWith('/complete'))), 'job completed');
  await worker.stop();
  await srv.close();

  assert.equal(registerTries, 2, 'registered after one backoff');
  assert.ok(seenInput.equals(INPUT), 'input downloaded whole');
  const output = srv.calls.find((c) => c.path.endsWith('/output'));
  assert.equal(output.method, 'PUT');
  assert.equal(output.headers['content-type'], 'video/mp4');
  assert.equal(output.headers['x-output-ext'], 'mp4');
  assert.equal(output.body.toString(), 'proxy bytes');
  assert.ok(srv.calls.some((c) => c.path.endsWith('/progress') && JSON.parse(c.body).progress === 0));
  assert.ok(!srv.calls.some((c) => c.path.endsWith('/fail')), 'no fail');
  assert.equal(worker.state.jobs, 1);
  const text = JSON.stringify(lines);
  assert.ok(!text.includes('worker-secret') && !text.includes('bootstrap-secret') && !text.includes('claim-1'), 'no secret in logs');
  assert.ok(lines.some((l) => l.msg === 'waiting before the next try' && l.code === 'SETUP_REQUIRED'));
});

test('a 401 makes the worker register again; a cancelled job is dropped without fail or complete', async () => {
  let registers = 0;
  let nexts = 0;
  const srv = await fakeServer((c) => {
    if (c.path.endsWith('/workers/register')) {
      registers++;
      return { status: 201, json: { workerId: `w${registers}`, token: `t${registers}`, contract: 1, heartbeatSeconds: 30, leaseSeconds: 90 } };
    }
    if (c.path.endsWith('/workers/heartbeat')) return { status: 200, json: { contract: 1, lostJobIds: [] } };
    if (c.path.endsWith('/jobs/next')) {
      nexts++;
      if (c.headers['x-worker-token'] === 't1') return { status: 401, json: { code: 'UNAUTHENTICATED', message: 'revoked' } };
      if (nexts === 2) return { status: 200, json: { job } };
      return { status: 204 };
    }
    if (c.path.endsWith('/input')) return { status: 200, raw: INPUT };
    if (c.path.endsWith('/progress')) return { status: 409, json: { code: 'JOB_TERMINAL', message: 'The job is cancelled' } };
  });
  const { log } = quietLog();
  const client = new ContractClient({ baseUrl: srv.url, bootstrapToken: 'b', manifest: { name: 't', version: '0.0.1', kinds: ['shotstash/proxy-720p'] } });
  let aborted = false;
  const worker = createWorker({
    client,
    log,
    tmpDir: tmpdir(),
    pollSeconds: 0.02,
    backoffSeconds: 0.02,
    process: async (_job, { signal }) => {
      await new Promise((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', resolve, { once: true });
        setTimeout(resolve, 3000);
      });
      aborted = signal.aborted;
      throw new Error('stopped');
    },
  });
  void worker.start();
  assert.ok(await until(() => aborted), 'processing aborted after JOB_TERMINAL');
  assert.ok(await until(() => worker.state.jobId === null));
  await worker.stop();
  await srv.close();
  assert.equal(registers, 2, 'registered again after 401');
  assert.ok(!srv.calls.some((c) => c.path.endsWith('/fail') || c.path.endsWith('/complete') || c.path.endsWith('/output')));
});

test('stopping during a job gives it back as retryable', async () => {
  const srv = await fakeServer((c) => {
    if (c.path.endsWith('/workers/register')) return { status: 201, json: { workerId: 'w', token: 't', contract: 1, heartbeatSeconds: 30, leaseSeconds: 90 } };
    if (c.path.endsWith('/workers/heartbeat')) return { status: 200, json: { contract: 1, lostJobIds: [] } };
    if (c.path.endsWith('/jobs/next')) return { status: 200, json: { job } };
    if (c.path.endsWith('/input')) return { status: 200, raw: INPUT };
    if (c.path.endsWith('/progress')) return { status: 200, json: { status: 'running', progress: 0, seq: 1 } };
    if (c.path.endsWith('/fail')) return { status: 200, json: { status: 'queued', attempts: 1, maxAttempts: 3 } };
  });
  const { log } = quietLog();
  const client = new ContractClient({ baseUrl: srv.url, bootstrapToken: 'b', manifest: { name: 't', version: '0.0.1', kinds: ['shotstash/proxy-720p'] } });
  let started = false;
  const worker = createWorker({
    client,
    log,
    tmpDir: tmpdir(),
    pollSeconds: 0.02,
    backoffSeconds: 0.02,
    process: (_job, { signal }) =>
      new Promise((_, reject) => {
        started = true;
        signal.addEventListener('abort', () => reject(new Error('killed')), { once: true });
      }),
  });
  void worker.start();
  assert.ok(await until(() => started));
  await worker.stop();
  await srv.close();
  const fail = srv.calls.find((c) => c.path.endsWith('/fail'));
  assert.ok(fail, 'fail sent');
  assert.equal(JSON.parse(fail.body).retryable, true);
  assert.equal(srv.calls.filter((c) => c.path.endsWith('/jobs/next')).length, 1, 'no polling after stop');
});
