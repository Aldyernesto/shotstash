// Story 6.4: the dependency audit gate's decision logic, on a fixture report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { advisories, advisoryId, evaluate } from './audit-check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const report = JSON.parse(readFileSync(new URL('./__fixtures__/npm-audit-report.json', import.meta.url), 'utf8'));
const TODAY = '2026-10-01';
const entry = (id, expires = '2026-12-01', reason = 'waiting for a non-breaking fix') => ({ id, reason, expires });

test('advisories are read from via objects, once per id, chains skipped', () => {
  assert.deepEqual(
    advisories(report).map((a) => `${a.id} ${a.severity}`),
    ['GHSA-aaaa-aaaa-aaaa high', 'GHSA-bbbb-bbbb-bbbb critical', 'GHSA-cccc-cccc-cccc moderate'],
  );
});

test('an unlisted high or critical advisory fails and names its id', () => {
  const r = evaluate(report, { advisories: [] }, TODAY);
  assert.equal(r.failures.length, 2);
  assert.match(r.failures[0], /GHSA-aaaa-aaaa-aaaa/);
  assert.match(r.failures[1], /GHSA-bbbb-bbbb-bbbb/);
  assert.ok(!r.failures.some((f) => f.includes('GHSA-cccc')), 'moderate is not gated');
});

test('allowlisted with an unexpired reason passes', () => {
  const r = evaluate(report, { advisories: [entry('GHSA-aaaa-aaaa-aaaa'), entry('GHSA-bbbb-bbbb-bbbb', TODAY)] }, TODAY);
  assert.deepEqual(r.failures, []);
  assert.equal(r.allowed.length, 2);
});

test('an expired entry fails', () => {
  const r = evaluate(report, { advisories: [entry('GHSA-aaaa-aaaa-aaaa', '2026-09-30'), entry('GHSA-bbbb-bbbb-bbbb')] }, TODAY);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /expired on 2026-09-30.*GHSA-aaaa/);
});

test('entries need a reason, a valid date and at most 90 days', () => {
  const r = evaluate(
    { vulnerabilities: {} },
    { advisories: [entry('GHSA-x1', '2026-12-01', ' '), entry('GHSA-x2', 'soon'), entry('GHSA-x3', '2027-06-01')] },
    TODAY,
  );
  assert.equal(r.failures.length, 3);
  assert.match(r.failures[0], /GHSA-x1 has no reason/);
  assert.match(r.failures[1], /GHSA-x2 has no valid expires/);
  assert.match(r.failures[2], /GHSA-x3 expires more than 90 days/);
});

test('an entry no longer reported only warns', () => {
  const r = evaluate({ vulnerabilities: {} }, { advisories: [entry('GHSA-gone-gone-gone')] }, TODAY);
  assert.deepEqual(r.failures, []);
  assert.match(r.warnings[0], /GHSA-gone-gone-gone is no longer reported/);
});

test('an audit error (no registry) fails instead of passing silently', () => {
  const r = evaluate({ error: { code: 'ENOAUDIT', summary: 'registry unreachable' } }, { advisories: [] }, TODAY);
  assert.match(r.failures[0], /npm audit failed: registry unreachable/);
});

test('the committed allowlist is well formed today', () => {
  const allowlist = JSON.parse(readFileSync(new URL('../audit-allowlist.json', import.meta.url), 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  const r = evaluate({ vulnerabilities: {} }, allowlist, today);
  assert.deepEqual(r.failures, []);
});

test('the advisory package and its dependents are recorded separately', () => {
  const beta = advisories(report).find((a) => a.id === 'GHSA-bbbb-bbbb-bbbb');
  assert.deepEqual(beta.packages, ['beta']);
  assert.deepEqual(beta.via, ['gamma']);
});

test('the highest severity across occurrences wins', () => {
  const adv = (severity) => ({ source: 7, name: 'zeta', title: 'Zeta', url: 'https://github.com/advisories/GHSA-zzzz-zzzz-zzzz', severity });
  const r = { vulnerabilities: { zeta: { via: [adv('moderate')] }, 'zeta-fork': { via: [adv('critical')] }, other: { via: [adv('low')] } } };
  const [a] = advisories(r);
  assert.equal(a.severity, 'critical');
  assert.match(evaluate(r, { advisories: [] }, TODAY).failures[0], /GHSA-zzzz-zzzz-zzzz \(critical/);
});

test('the fallback id is npm-<source>, else npm-<name>-<title>, never undefined', () => {
  assert.equal(advisoryId({ source: 1234, url: '' }), 'npm-1234');
  assert.equal(advisoryId({ name: 'omega', title: 'Prototype Pollution!' }), 'npm-omega-prototype-pollution');
  assert.equal(advisoryId({}, 'pkg'), 'npm-pkg-untitled');
  assert.ok(!advisoryId({}).includes('undefined'));
});

test('an entry whose package does not match the reported package fails', () => {
  const r = evaluate(
    report,
    { advisories: [{ ...entry('GHSA-aaaa-aaaa-aaaa'), package: 'not-alpha' }, { ...entry('GHSA-bbbb-bbbb-bbbb'), package: 'beta' }] },
    TODAY,
  );
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /names package "not-alpha".*GHSA-aaaa/);
  assert.equal(r.allowed.length, 1);
});

test('an entry expiring within 14 days warns but passes', () => {
  const r = evaluate(report, { advisories: [entry('GHSA-aaaa-aaaa-aaaa', '2026-10-10'), entry('GHSA-bbbb-bbbb-bbbb', '2026-12-01')] }, TODAY);
  assert.deepEqual(r.failures, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /GHSA-aaaa-aaaa-aaaa expires on 2026-10-10/);
});

test('the CLI fails on the fixture report and names the advisories on stderr', () => {
  const run = spawnSync(process.execPath, ['scripts/audit-check.mjs', '--report', 'scripts/__fixtures__/npm-audit-report.json'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /GHSA-aaaa-aaaa-aaaa/);
  assert.match(run.stderr, /GHSA-bbbb-bbbb-bbbb/);
});

test('--report without a path exits 2', () => {
  const run = spawnSync(process.execPath, ['scripts/audit-check.mjs', '--report'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--report needs a path/);
});
