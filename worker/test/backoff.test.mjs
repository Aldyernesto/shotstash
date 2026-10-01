// Reference worker: what happens after a failed call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKOFF_SECONDS, ContractError, classify, sleep, waitSeconds } from '../src/backoff.mjs';

test('401 registers again, 503 and network errors back off 30 s, other refusals retry soon', () => {
  assert.equal(BACKOFF_SECONDS, 30);
  assert.equal(classify(new ContractError(401, 'UNAUTHENTICATED')), 'reregister');
  assert.equal(classify(new ContractError(503, 'SETUP_REQUIRED')), 'backoff');
  assert.equal(classify(new ContractError(502)), 'backoff');
  assert.equal(classify(new ContractError(429, 'RATE_LIMITED')), 'backoff');
  assert.equal(classify(new ContractError(0, 'CONTRACT_UNSUPPORTED')), 'backoff');
  assert.equal(classify(new ContractError(422, 'CONTRACT_UNSUPPORTED')), 'backoff');
  assert.equal(classify(new TypeError('fetch failed')), 'backoff');
  assert.equal(classify(new ContractError(400, 'INVALID_BODY')), 'retry');
  assert.equal(waitSeconds(new ContractError(401)), 30);
  assert.equal(waitSeconds(new ContractError(503)), 30);
  assert.equal(waitSeconds(new TypeError('fetch failed')), 30);
  assert.equal(waitSeconds(new ContractError(400)), 5);
  const limited = Object.assign(new ContractError(429), { retryAfter: 12 });
  assert.equal(waitSeconds(limited), 12);
});

test('sleep ends early when the signal aborts', async () => {
  const stop = new AbortController();
  const started = Date.now();
  setTimeout(() => stop.abort(), 20);
  await sleep(10_000, stop.signal);
  assert.ok(Date.now() - started < 2000);
  await sleep(10_000, stop.signal); // already aborted: at once
});
