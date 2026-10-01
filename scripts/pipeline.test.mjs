// Stories 5.1-5.3: the worker contract's pure parts (manifest, contract
// major, bodies, output headers, derived state), the pipeline settings and
// the rules the queue relies on. The queue itself (claims, sweeper, races)
// runs against a real database in scripts/e2e-pipeline.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = await import('../src/modules/pipeline/contract.ts');
const kinds = await import('../src/modules/pipeline/kinds.ts');
const shared = await import('../src/lib/pipelineContract.ts');
const cfg = await import('../src/lib/config.ts');

const manifest = (extra = {}) => ({ name: 'reference-proxy', version: '0.1.0', kinds: ['shotstash/proxy-720p'], contract: 1, ...extra });
const failure = (fn) => {
  try {
    fn();
  } catch (e) {
    return e instanceof contract.PipelineFailure ? `${e.status} ${e.code}` : `other ${e.message}`;
  }
  return 'ok';
};

test('contract version 1 and the header names', () => {
  assert.equal(shared.PIPELINE_CONTRACT_VERSION, 1);
  assert.equal(shared.PIPELINE_HEADER, 'X-Shotstash-Pipeline');
  assert.equal(shared.WORKER_TOKEN_HEADER, 'X-Worker-Token');
  assert.equal(shared.WORKER_BOOTSTRAP_HEADER, 'X-Worker-Bootstrap-Token');
  assert.equal(shared.CLAIM_TOKEN_HEADER, 'X-Claim-Token');
  assert.equal(shared.HEARTBEAT_SECONDS, 30);
});

test('contract major: numbers and semver strings by their major, anything else null', () => {
  assert.equal(contract.contractMajor(1), 1);
  assert.equal(contract.contractMajor(1.9), 1);
  assert.equal(contract.contractMajor('1'), 1);
  assert.equal(contract.contractMajor('1.4.0'), 1);
  assert.equal(contract.contractMajor('2.0'), 2);
  for (const bad of [undefined, null, 'one', '', '1.x', -1, Number.NaN, {}]) assert.equal(contract.contractMajor(bad), null, String(bad));
});

test('manifest: another contract major is 422 CONTRACT_UNSUPPORTED, checked before the fields', () => {
  assert.equal(failure(() => contract.parseManifest(manifest({ contract: 2 }))), '422 CONTRACT_UNSUPPORTED');
  assert.equal(failure(() => contract.parseManifest(manifest({ contract: undefined }))), '422 CONTRACT_UNSUPPORTED');
  assert.equal(failure(() => contract.parseManifest({ contract: 2 })), '422 CONTRACT_UNSUPPORTED');
  assert.equal(failure(() => contract.parseManifest(manifest({ contract: '1.3' }))), 'ok');
});

test('manifest: fields are validated and kinds deduplicated', () => {
  assert.deepEqual(contract.parseManifest(manifest({ kinds: ['a/b', 'a/b', 'shotstash/proxy-720p'] })), {
    name: 'reference-proxy',
    version: '0.1.0',
    kinds: ['a/b', 'shotstash/proxy-720p'],
  });
  for (const bad of [
    manifest({ name: '' }),
    manifest({ name: 'x'.repeat(101) }),
    manifest({ version: 3 }),
    manifest({ kinds: [] }),
    manifest({ kinds: 'shotstash/proxy-720p' }),
    manifest({ kinds: ['proxy'] }),
    manifest({ kinds: ['Shotstash/Proxy'] }),
    manifest({ kinds: Array.from({ length: 33 }, (_, i) => `a/k${i}`) }),
  ]) {
    assert.equal(failure(() => contract.parseManifest(bad)), '400 INVALID_MANIFEST', JSON.stringify(bad).slice(0, 80));
  }
  assert.equal(failure(() => contract.parseRegister(null)), '400 INVALID_BODY');
  assert.equal(failure(() => contract.parseRegister({})), '400 INVALID_MANIFEST');
});

test('heartbeat, progress and fail bodies', () => {
  const id = '0192f0c4-1111-7000-8000-000000000001';
  assert.deepEqual(contract.parseHeartbeat({ manifest: manifest(), activeJobIds: [id, id] }).activeJobIds, [id]);
  assert.deepEqual(contract.parseHeartbeat({ manifest: manifest() }).activeJobIds, []);
  assert.equal(failure(() => contract.parseHeartbeat({ manifest: manifest(), activeJobIds: ['nope'] })), '400 INVALID_BODY');
  assert.equal(failure(() => contract.parseHeartbeat({ activeJobIds: [] })), '400 INVALID_MANIFEST');
  assert.equal(contract.parseProgress({ progress: 42.9 }), 42);
  for (const bad of [{}, { progress: -1 }, { progress: 101 }, { progress: '5' }, { progress: Number.NaN }]) {
    assert.equal(failure(() => contract.parseProgress(bad)), '400 INVALID_BODY', JSON.stringify(bad));
  }
  assert.deepEqual(contract.parseFail({ error: ' boom ' }), { error: 'boom', retryable: false });
  assert.deepEqual(contract.parseFail({ error: 'x', retryable: true }), { error: 'x', retryable: true });
  assert.equal(contract.parseFail({ error: 'e'.repeat(5000) }).error.length, contract.MAX_ERROR_LENGTH);
  assert.equal(failure(() => contract.parseFail({ error: '' })), '400 INVALID_BODY');
  assert.equal(failure(() => contract.parseFail({ error: 'x', retryable: 'yes' })), '400 INVALID_BODY');
});

test('output headers: extension and media type are required; multipart is refused', () => {
  assert.deepEqual(contract.parseOutputHeaders('.MP4', 'video/mp4; codecs="avc1"'), { ext: 'mp4', mimeType: 'video/mp4' });
  for (const [ext, type] of [
    [null, 'video/mp4'],
    ['m p4', 'video/mp4'],
    ['../x', 'video/mp4'],
    ['mp4', null],
    ['mp4', 'video'],
    ['mp4', 'multipart/form-data; boundary=x'],
  ]) {
    assert.equal(failure(() => contract.parseOutputHeaders(ext, type)), '400 INVALID_OUTPUT', `${ext} ${type}`);
  }
});

test('derived state: queued without a live worker is waiting_for_worker; other states stay', () => {
  assert.equal(contract.jobState('queued', false), 'waiting_for_worker');
  assert.equal(contract.jobState('queued', true), 'queued');
  for (const s of ['claimed', 'running', 'done', 'failed', 'cancelled']) assert.equal(contract.jobState(s, false), s);
  assert.deepEqual(contract.JOB_STATUSES.filter(contract.isTerminal), ['done', 'failed', 'cancelled']);
  assert.equal(contract.MAX_ATTEMPTS, 3);
});

test('kinds: namespaced names only; the two built-in kinds are seeded by migration 0007', () => {
  for (const ok of ['shotstash/proxy-720p', 'acme/whisper.large-v3', 'a/b']) assert.ok(kinds.isKindName(ok), ok);
  for (const bad of ['proxy', 'a/b/c', '/a', 'a/', 'A/b', 'a b/c', `${'a'.repeat(65)}/b`, 42]) assert.equal(kinds.isKindName(bad), false, String(bad));
  const sql = readFileSync(new URL('../prisma/migrations/0007_pipeline_queue/migration.sql', import.meta.url), 'utf8');
  for (const k of kinds.PIPELINE_KINDS) assert.ok(sql.includes(`'${k}'`), `${k} seeded`);
  assert.match(sql, /FOREIGN KEY \("media_file_id"\) REFERENCES "media_files"\("id"\) ON DELETE CASCADE/);
  assert.match(sql, /CREATE UNIQUE INDEX "pipeline_workers_token_hash_key"/);
  assert.match(sql, /"pipeline_jobs"\("status", "kind", "created_at"\)/);
  assert.match(sql, /"pipeline_jobs"\("status", "heartbeat_at"\)/);
});

test('every pipeline error code has an English message', () => {
  const en = JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8'));
  const src = readFileSync(new URL('../src/modules/pipeline/contract.ts', import.meta.url), 'utf8');
  const union = /export type PipelineErrorCode =([^;]+);/.exec(src)[1];
  const codes = [...union.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(codes.length >= 10);
  for (const c of [...codes, 'PIPELINE_DISABLED']) assert.equal(typeof en.errors.codes[c], 'string', c);
  for (const k of kinds.PIPELINE_KINDS) assert.equal(typeof en.viewer.info.versions.kind[k], 'string', k);
});

test('the claim is one statement with SKIP LOCKED, filtered by the worker kinds and live files', () => {
  const src = readFileSync(new URL('../src/modules/pipeline/service.ts', import.meta.url), 'utf8');
  const claim = src.slice(src.indexOf('export async function claimNext'), src.indexOf('/** Why a claim-checked write'));
  assert.match(claim, /UPDATE pipeline_jobs[\s\S]*WHERE id = \([\s\S]*FOR UPDATE OF j SKIP LOCKED[\s\S]*LIMIT 1[\s\S]*\) AND status = 'queued'/);
  assert.match(claim, /j\.kind = ANY\(\$\{kinds\}::text\[\]\)/);
  assert.match(claim, /ORDER BY j\.created_at, j\.id/);
  assert.match(claim, /m\."trashedAt" IS NULL/);
  assert.equal((claim.match(/\$queryRaw/g) ?? []).length, 1, 'one claiming statement');
  // Workers never see a storage key or credential.
  assert.doesNotMatch(claim, /storageKey|storage_key/);
});

test('settings: pipeline variables with defaults; short sweeps only outside production', () => {
  const GOOD = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', SESSION_SECRET: 's'.repeat(64) };
  const c = cfg.loadConfig(GOOD);
  assert.deepEqual(c.problems, []);
  assert.equal(c.config.SHOTSTASH_PIPELINE_MAX_OUTPUT_MB, 20480);
  assert.equal(c.config.SHOTSTASH_PIPELINE_LEASE_SECONDS, 90);
  assert.equal(c.config.SHOTSTASH_PIPELINE_SWEEP_SECONDS, 30);
  assert.equal(c.config.WORKER_BOOTSTRAP_TOKEN, undefined);
  assert.equal(cfg.VARIABLES.WORKER_BOOTSTRAP_TOKEN.secret, true);
  assert.deepEqual(cfg.loadConfig({ ...GOOD, SHOTSTASH_PIPELINE_SWEEP_SECONDS: '2' }).problems, []);
  const prod = cfg.loadConfig({ ...GOOD, NODE_ENV: 'production', SHOTSTASH_PIPELINE_SWEEP_SECONDS: '2' });
  assert.ok(prod.problems.some((p) => p.startsWith('SHOTSTASH_PIPELINE_SWEEP_SECONDS:')), JSON.stringify(prod.problems));
  assert.deepEqual(cfg.loadConfig({ ...GOOD, NODE_ENV: 'production', SHOTSTASH_PIPELINE_SWEEP_SECONDS: '5' }).problems, []);
  assert.ok(cfg.loadConfig({ ...GOOD, SHOTSTASH_PIPELINE_LEASE_SECONDS: '10' }).problems.some((p) => p.startsWith('SHOTSTASH_PIPELINE_LEASE_SECONDS:')));
  assert.ok(cfg.loadConfig({ ...GOOD, WORKER_BOOTSTRAP_TOKEN: 'short' }).problems.some((p) => p.startsWith('WORKER_BOOTSTRAP_TOKEN:')));
});
