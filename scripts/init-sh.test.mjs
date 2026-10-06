// Story 8.1: docker/init.sh, the first step of the one-line install. Runs the
// real script in a temporary checkout (a copy of .env.example and a stub
// preflight that records it ran) with POSIX sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = ['SESSION_SECRET', 'MEDIA_SIGNING_SECRET', 'SETUP_TOKEN', 'WORKER_BOOTSTRAP_TOKEN', 'POSTGRES_PASSWORD'];
const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0;

function checkout(preflightExit = 0) {
  const dir = mkdtempSync(path.join(tmpdir(), 'shotstash-init-'));
  mkdirSync(path.join(dir, 'docker'));
  copyFileSync(path.join(ROOT, 'docker/init.sh'), path.join(dir, 'docker/init.sh'));
  copyFileSync(path.join(ROOT, '.env.example'), path.join(dir, '.env.example'));
  writeFileSync(path.join(dir, 'docker/preflight.sh'), `#!/bin/sh\necho preflight-ran\nexit ${preflightExit}\n`);
  return dir;
}

function run(dir) {
  return spawnSync('sh', [path.join(dir, 'docker/init.sh')], { cwd: dir, encoding: 'utf8' });
}

function values(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

test('init.sh creates .env with a distinct random value for every generated secret', { skip: !hasSh && 'no sh' }, () => {
  const dir = checkout();
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /preflight-ran/);
    const env = readFileSync(path.join(dir, '.env'), 'utf8');
    const example = readFileSync(path.join(dir, '.env.example'), 'utf8');
    const v = values(env);
    const seen = new Set();
    for (const name of SECRETS) {
      assert.match(v[name], /^[0-9a-f]{64}$/, name);
      assert.ok(!seen.has(v[name]), `${name} repeats another secret`);
      seen.add(v[name]);
      // Never printed.
      assert.ok(!r.stdout.includes(v[name]) && !r.stderr.includes(v[name]), `${name} was printed`);
    }
    // Everything else is the example, line for line.
    const strip = (t) => t.split('\n').filter((l) => !SECRETS.some((n) => l.startsWith(`${n}=`)));
    assert.deepEqual(strip(env), strip(example));
    // Secrets the operator brings stay empty.
    for (const name of ['DRAGONFLY_PASSWORD', 'S3_SECRET_ACCESS_KEY', 'RESEND_API_KEY', 'DEMO_ADMIN_PASSWORD']) assert.equal(v[name], '', name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init.sh never overwrites an existing .env and still runs the preflight', { skip: !hasSh && 'no sh' }, () => {
  const dir = checkout();
  try {
    writeFileSync(path.join(dir, '.env'), 'SESSION_SECRET=mine\n');
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /already exists/);
    assert.match(r.stdout, /preflight-ran/);
    assert.equal(readFileSync(path.join(dir, '.env'), 'utf8'), 'SESSION_SECRET=mine\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init.sh keeps a .env directory or symlink (even a broken one)', { skip: !hasSh && 'no sh' }, () => {
  for (const kind of ['dir', 'symlink']) {
    const dir = checkout();
    try {
      if (kind === 'dir') mkdirSync(path.join(dir, '.env'));
      else {
        const made = spawnSync('sh', ['-c', 'ln -s missing-target .env && [ -L .env ]'], { cwd: dir });
        if (made.status !== 0) continue; // no real symlinks (Windows without developer mode)
      }
      const r = run(dir);
      assert.match(r.stdout, /already exists/, kind);
      assert.doesNotMatch(r.stdout, /Created \.env/, kind);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('init.sh exits with the preflight status and leaves no temporary file', { skip: !hasSh && 'no sh' }, () => {
  const dir = checkout(1);
  try {
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.ok(existsSync(path.join(dir, '.env')));
    const left = spawnSync('sh', ['-c', 'ls -a'], { cwd: dir, encoding: 'utf8' }).stdout;
    assert.doesNotMatch(left, /\.env\.init/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the README one-line install uses init.sh', () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /git clone https:\/\/github\.com\/[^ ]+\/shotstash\.git && cd shotstash && sh docker\/init\.sh && docker compose up -d/);
});
