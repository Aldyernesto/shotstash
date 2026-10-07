// docker/preflight.sh: the Docker Compose version gate (2.24.4 for the images
// and demo overrides) and the architecture warning. Runs the real script in a
// temporary checkout with stub `docker` and `uname` commands first on PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0;
const IMAGES = 'docker-compose.yml:docker-compose.images.yml';
const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);

function checkout() {
  const dir = mkdtempSync(path.join(tmpdir(), 'shotstash-preflight-'));
  mkdirSync(path.join(dir, 'docker'));
  mkdirSync(path.join(dir, 'bin'));
  copyFileSync(path.join(ROOT, 'docker/preflight.sh'), path.join(dir, 'docker/preflight.sh'));
  writeFileSync(
    path.join(dir, '.env'),
    `SESSION_SECRET=${SECRET_A}\nPOSTGRES_PASSWORD=${SECRET_B}\nWORKER_BOOTSTRAP_TOKEN=${SECRET_B}\n`,
  );
  writeFileSync(
    path.join(dir, 'bin/docker'),
    '#!/bin/sh\nif [ "$1" = compose ] && [ "$2" = version ] && [ "${3:-}" = --short ]; then echo "$FAKE_COMPOSE_VERSION"; fi\nexit 0\n',
    { mode: 0o755 },
  );
  writeFileSync(path.join(dir, 'bin/uname'), '#!/bin/sh\necho "$FAKE_ARCH"\n', { mode: 0o755 });
  return dir;
}

function run(dir, { version, arch = 'x86_64', composeFile = IMAGES }) {
  const env = {};
  let pathKey = 'PATH';
  for (const [k, v] of Object.entries(process.env)) {
    if (/^path$/i.test(k)) pathKey = k;
    else if (k !== 'COMPOSE_FILE' && k !== 'SHOTSTASH_PORT') env[k] = v;
  }
  env[pathKey] = `${path.join(dir, 'bin')}${path.delimiter}${process.env[pathKey] ?? ''}`;
  env.FAKE_COMPOSE_VERSION = version;
  env.FAKE_ARCH = arch;
  env.SHOTSTASH_PORT = String(40000 + Math.floor(Math.random() * 20000));
  if (composeFile !== undefined) env.COMPOSE_FILE = composeFile;
  return spawnSync('sh', [path.join(dir, 'docker/preflight.sh')], { cwd: dir, env, encoding: 'utf8' });
}

function withCheckout(fn) {
  const dir = checkout();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('preflight accepts Docker Compose 2.24.4 and newer with the published images', { skip: !hasSh && 'no sh' }, () => {
  withCheckout((dir) => {
    for (const version of ['2.24.4', 'v2.24.4', '2.24.10', '2.25.0', '2.31.0-desktop.2', '2.100.1', '3.0.0']) {
      const r = run(dir, { version });
      assert.equal(r.status, 0, `${version}: ${r.stdout}${r.stderr}`);
      assert.doesNotMatch(r.stdout, /too old|older than/, version);
      assert.match(r.stdout, /Preflight passed/, version);
    }
  });
});

test('preflight refuses an older Docker Compose with the images override, naming the version and the way out', { skip: !hasSh && 'no sh' }, () => {
  withCheckout((dir) => {
    for (const version of ['2.24.3', 'v2.23.9', '2.9.0', '1.29.2']) {
      const r = run(dir, { version });
      assert.equal(r.status, 1, version);
      assert.match(r.stdout, new RegExp(`Docker Compose ${version.replace(/\./g, '\\.')} is too old`), version);
      assert.match(r.stdout, /2\.24\.4 or newer/, version);
      assert.match(r.stdout, /Update Docker Desktop/, version);
      assert.match(r.stdout, /quick-start\/#build-from-source/, version);
    }
    // The demo override needs it as well.
    assert.equal(run(dir, { version: '2.20.0', composeFile: `${IMAGES}:docker-compose.demo.yml` }).status, 1);
  });
});

test('preflight only warns about an older Docker Compose when building from source', { skip: !hasSh && 'no sh' }, () => {
  withCheckout((dir) => {
    const r = run(dir, { version: '2.20.0', composeFile: 'docker-compose.yml' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Warning: Docker Compose 2\.20\.0 is older than 2\.24\.4/);
  });
});

test('preflight reads COMPOSE_FILE from .env when the shell has none', { skip: !hasSh && 'no sh' }, () => {
  withCheckout((dir) => {
    writeFileSync(path.join(dir, '.env'), `COMPOSE_FILE=${IMAGES}\n`, { flag: 'a' });
    assert.equal(run(dir, { version: '2.20.0', composeFile: undefined }).status, 1);
  });
});

test('preflight warns about an unreadable Compose version without failing', { skip: !hasSh && 'no sh' }, () => {
  withCheckout((dir) => {
    const r = run(dir, { version: 'dev' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /could not read the Docker Compose version \(got: dev\)/);
  });
});

test('preflight warns (never fails) on an architecture without published images', { skip: !hasSh && 'no sh' }, () => {
  withCheckout((dir) => {
    for (const arch of ['x86_64', 'amd64', 'aarch64', 'arm64']) {
      const r = run(dir, { version: '2.31.0', arch });
      assert.equal(r.status, 0, arch);
      assert.doesNotMatch(r.stdout, /no published Shotstash image/, arch);
    }
    for (const arch of ['riscv64', 'armv7l', 'ppc64le']) {
      const r = run(dir, { version: '2.31.0', arch });
      assert.equal(r.status, 0, arch);
      assert.match(r.stdout, new RegExp(`no published Shotstash image exists for this architecture \\(${arch}\\)`), arch);
      assert.match(r.stdout, /build-from-source/, arch);
    }
  });
});
