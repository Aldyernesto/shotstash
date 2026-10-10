// docker/preflight.sh: the Docker Compose version gate (2.24.4 for the images
// and demo overrides), the architecture warning and the port check. Runs the
// real script in a temporary checkout with stub `docker` and `uname` commands
// first on PATH; the port tests use a PATH that holds only stubs.
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

// The port check, with ss, lsof and nc replaced by stubs on a PATH that holds
// nothing else (the host's own ss or lsof must not answer). Basic tools the
// script needs are forwarded to the host's copies.
const BASIC_TOOLS = [
  "awk",
  "cat",
  "cut",
  "dirname",
  "grep",
  "head",
  "readlink",
  "sed",
  "tail",
  "tr",
];

function isolatedBin(dir, stubs) {
  const bin = path.join(dir, "isolated");
  mkdirSync(bin, { recursive: true });
  for (const tool of BASIC_TOOLS) {
    const where = spawnSync("sh", ["-c", `command -v ${tool}`], {
      encoding: "utf8",
    }).stdout.trim();
    assert.ok(where, `test setup: ${tool} not found on this machine`);
    writeFileSync(path.join(bin, tool), `#!/bin/sh\nexec "${where}" "$@"\n`, {
      mode: 0o755,
    });
  }
  writeFileSync(
    path.join(bin, "docker"),
    '#!/bin/sh\nif [ "$1" = compose ] && [ "$2" = version ] && [ "${3:-}" = --short ]; then echo 2.31.0; fi\nexit 0\n',
    { mode: 0o755 },
  );
  writeFileSync(path.join(bin, "uname"), "#!/bin/sh\necho x86_64\n", {
    mode: 0o755,
  });
  for (const [name, body] of Object.entries(stubs))
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, {
      mode: 0o755,
    });
  return bin;
}

function runPort(dir, stubs, port = 3005) {
  const bin = isolatedBin(dir, stubs);
  const env = { SHOTSTASH_PORT: String(port), COMPOSE_FILE: IMAGES };
  for (const k of ["SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "HOME"])
    if (process.env[k]) env[k] = process.env[k];
  env.PATH = bin;
  // an absolute sh, since PATH below holds only the stubs (cygpath: Git Bash on Windows)
  const sh =
    spawnSync(
      "sh",
      ["-c", 'p=$(command -v sh); cygpath -w "$p" 2>/dev/null || echo "$p"'],
      { encoding: "utf8" },
    ).stdout.trim() || "sh";
  return spawnSync(sh, [path.join(dir, "docker/preflight.sh")], {
    cwd: dir,
    env,
    encoding: "utf8",
  });
}

// BusyBox lsof: ignores every option, prints open files, exits 0; its usage
// banner goes to stderr.
const BUSYBOX_LSOF =
  'if [ "$1" = --help ]; then echo "BusyBox v1.37.0 (2025-01-17) multi-call binary." >&2; exit 0; fi\necho "1 /usr/local/bin/dockerd"\nexit 0';
const REAL_LSOF_LISTENING =
  'if [ "$1" = --help ]; then echo "lsof: illegal option"; exit 1; fi\necho "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME"\necho "node 4242 me 22u IPv6 0x1 0t0 TCP *:3005 (LISTEN)"\nexit 0';
const REAL_LSOF_FREE =
  'if [ "$1" = --help ]; then echo "lsof: illegal option"; exit 1; fi\nexit 1';
// A real lsof that exits 0 but lists no listener on the port.
const REAL_LSOF_OTHER =
  'if [ "$1" = --help ]; then echo "lsof: illegal option"; exit 1; fi\necho "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME"\necho "sshd 10 root 3u IPv4 0x2 0t0 TCP *:22 (LISTEN)"\nexit 0';
const NC_FREE = "exit 1";
const NC_TAKEN = "exit 0";

test(
  "preflight does not trust BusyBox lsof and asks nc instead",
  { skip: !hasSh && "no sh" },
  () => {
    withCheckout((dir) => {
      const free = runPort(dir, { lsof: BUSYBOX_LSOF, nc: NC_FREE });
      assert.equal(free.status, 0, free.stdout + free.stderr);
      assert.doesNotMatch(free.stdout, /in use/);
      assert.match(free.stdout, /Preflight passed\. Start/);
    });
    withCheckout((dir) => {
      const taken = runPort(dir, { lsof: BUSYBOX_LSOF, nc: NC_TAKEN });
      assert.equal(taken.status, 1, taken.stdout + taken.stderr);
      assert.match(taken.stdout, /Port 3005 is in use/);
    });
  },
);

test(
  "preflight counts a real lsof only when it prints a listener on the port",
  { skip: !hasSh && "no sh" },
  () => {
    withCheckout((dir) => {
      const taken = runPort(dir, { lsof: REAL_LSOF_LISTENING, nc: NC_FREE });
      assert.equal(taken.status, 1, taken.stdout + taken.stderr);
      assert.match(taken.stdout, /Port 3005 is in use/);
    });
    for (const lsof of [REAL_LSOF_FREE, REAL_LSOF_OTHER]) {
      withCheckout((dir) => {
        const free = runPort(dir, { lsof, nc: NC_FREE });
        assert.equal(free.status, 0, free.stdout + free.stderr);
        assert.match(free.stdout, /Preflight passed\. Start/);
      });
      withCheckout((dir) => {
        // lsof without root cannot see other users' listeners: nc still gets asked
        const taken = runPort(dir, { lsof, nc: NC_TAKEN });
        assert.equal(taken.status, 1, taken.stdout + taken.stderr);
        assert.match(taken.stdout, /Port 3005 is in use/);
      });
    }
  },
);

test(
  "preflight prefers ss over lsof and nc",
  { skip: !hasSh && "no sh" },
  () => {
    const ssFree =
      'echo "State Recv-Q Send-Q Local Address:Port Peer Address:Port"\necho "LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*"';
    const ssTaken = `${ssFree}\necho "LISTEN 0 511 *:3005 *:*"`;
    withCheckout((dir) => {
      const free = runPort(dir, {
        ss: ssFree,
        lsof: REAL_LSOF_LISTENING,
        nc: NC_TAKEN,
      });
      assert.equal(free.status, 0, free.stdout + free.stderr);
      assert.match(free.stdout, /Preflight passed\. Start/);
    });
    withCheckout((dir) => {
      const taken = runPort(dir, { ss: ssTaken, nc: NC_FREE });
      assert.equal(taken.status, 1, taken.stdout + taken.stderr);
      assert.match(taken.stdout, /Port 3005 is in use/);
    });
  },
);

test(
  "preflight passes without the port check when no ss, full lsof or nc exists",
  { skip: !hasSh && "no sh" },
  () => {
    withCheckout((dir) => {
      const r = runPort(dir, { lsof: BUSYBOX_LSOF });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(
        r.stdout,
        /Cannot check port 3005: install ss \(iproute2\), a full lsof \(BusyBox lsof cannot filter by port\) or nc\./,
      );
      assert.match(r.stdout, /Preflight passed except the port check/);
    });
  },
);
