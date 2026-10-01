// Story 6.4: the release-please configuration, the release workflow and the
// Dockerfiles agree with the repository, without publishing anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './route-matrix-lib.mjs';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const config = json('release-please-config.json');
const manifest = json('.release-please-manifest.json');
const pkg = json('package.json');
const workerPkg = json('worker/package.json');

test('one node package at the root, tags vX.Y.Z, authors credited', () => {
  assert.equal(config['release-type'], 'node');
  assert.deepEqual(Object.keys(config.packages), ['.']);
  assert.equal(config['include-component-in-tag'], false);
  assert.notEqual(config['include-v-in-tag'], false);
  assert.equal(config['include-commit-authors'], true);
  assert.equal(config['bump-minor-pre-major'], true);
  const visible = config['changelog-sections'].filter((s) => !s.hidden).map((s) => s.type);
  assert.ok(visible.includes('feat') && visible.includes('fix'));
});

test('the manifest, root and worker versions match', () => {
  assert.deepEqual(Object.keys(manifest), ['.']);
  assert.equal(manifest['.'], pkg.version);
  assert.equal(workerPkg.version, pkg.version, 'worker/package.json feeds the worker manifest version');
});

test('every extra file exists and its jsonpath holds the current version', () => {
  const extra = config.packages['.']['extra-files'];
  assert.ok(extra.some((f) => f.path === 'worker/package.json'), 'the worker version is bumped with the release');
  assert.ok(extra.some((f) => f.path === 'openapi.json'), 'openapi.json info.version follows the release, so openapi:check stays green');
  for (const f of extra) {
    assert.ok(existsSync(join(ROOT, f.path)), `${f.path} exists`);
    assert.equal(f.type, 'json');
    assert.match(f.jsonpath, /^\$(\.\w+)+$/, `${f.path}: simple jsonpath`);
    const value = f.jsonpath.slice(2).split('.').reduce((o, k) => o?.[k], json(f.path));
    assert.equal(value, pkg.version, `${f.path} ${f.jsonpath}`);
  }
});

const workflows = readdirSync(join(ROOT, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f));

test('workflows name no owner, use only GITHUB_TOKEN and current action majors', () => {
  const owner = /github\.com\/Aldyernesto|ghcr\.io\/aldyernesto/i;
  for (const f of workflows) {
    const src = read(join('.github', 'workflows', f));
    assert.ok(!owner.test(src), `${f}: hard-coded owner`);
    for (const m of src.matchAll(/secrets\.(\w+)/g)) assert.equal(m[1], 'GITHUB_TOKEN', `${f}: secret ${m[1]}`);
    for (const m of src.matchAll(/uses:\s*([\w./-]+)@v(\d+)/g)) {
      const min = { 'actions/checkout': 7, 'actions/setup-node': 7, 'actions/upload-artifact': 7, 'actions/download-artifact': 8 }[m[1]];
      if (min) assert.ok(Number(m[2]) >= min, `${f}: ${m[1]}@v${m[2]} is a Node 20 major`);
    }
  }
});

test('the release workflow publishes both images under the repository owner, gated on a release', () => {
  const src = read('.github/workflows/release.yml');
  assert.match(src, /googleapis\/release-please-action@v5/);
  assert.match(src, /release_created == 'true'/);
  assert.match(src, /ghcr\.io\/\$\{GITHUB_REPOSITORY_OWNER,,\}/);
  for (const name of ['shotstash', 'shotstash-worker']) assert.match(src, new RegExp(`name: ${name}$`, 'm'));
  for (const runner of ['ubuntu-24.04', 'ubuntu-24.04-arm']) assert.ok(src.includes(`runner: ${runner}\n`), runner);
  assert.match(src, /VERSION=\$\{\{ needs\.meta\.outputs\.version \}\}/);
  assert.match(src, /SOURCE_URL=\$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}/);
  assert.match(src, /packages: write/);
});

test('the release workflow runs only after a green CI on main, on the commit CI checked', () => {
  const src = read('.github/workflows/release.yml');
  assert.match(src, /workflow_run:\n\s+workflows: \[CI\]\n\s+types: \[completed\]\n\s+branches: \[main\]/);
  assert.match(src, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(src, /ref: \$\{\{ github\.event\.workflow_run\.head_sha/);
  assert.ok(!/^\s+push:/m.test(src), 'no direct push trigger');
  assert.match(read('.github/workflows/pr.yml'), /^name: CI$/m, 'the workflow_run name matches pr.yml');
});

test('the release PR gets CI, and a tag can be republished', () => {
  const src = read('.github/workflows/release.yml');
  assert.match(src, /gh workflow run pr\.yml --repo "\$GITHUB_REPOSITORY" --ref "\$BRANCH"/);
  assert.match(src, /actions: write/);
  assert.match(src, /workflow_dispatch:\n\s+inputs:\n\s+tag:/);
  assert.match(src, /ref: \$\{\{ needs\.meta\.outputs\.ref \}\}/);
  assert.match(read('.github/workflows/pr.yml'), /^\s+workflow_dispatch:/m, 'pr.yml can be dispatched');
});

test('each image publishes on its own: amd64 required, arm64 best effort, moving tags guarded', () => {
  const src = read('.github/workflows/release.yml');
  const publish = src.slice(src.indexOf('\n  publish:'));
  assert.match(publish, /if: always\(\) && needs\.meta\.result == 'success'/);
  assert.match(publish, /no amd64 digest/);
  assert.match(publish, /no arm64 digest/);
  assert.ok(!/continue-on-error: \$\{\{ matrix\.arch/.test(src), 'a failed arm64 leg stays visible');
  assert.match(publish, /latest=\$\{\{ needs\.meta\.outputs\.latest == 'true' && 'auto' \|\| 'false' \}\}/);
  assert.match(publish, /type=semver,pattern=\{\{version\}\}/);
  assert.ok(!/type=raw,value=latest/.test(src), 'no raw latest tag');
  for (const label of ['title', 'description', 'version', 'licenses', 'source']) {
    assert.match(src, new RegExp(`org\\.opencontainers\\.image\\.${label}=`), label);
  }
  assert.match(src, /title: Shotstash worker/);
});

test('Dockerfiles take VERSION and SOURCE_URL and hard-code no repository URL', () => {
  for (const f of ['docker/Dockerfile', 'docker/worker.Dockerfile']) {
    const src = read(f);
    assert.match(src, /^ARG VERSION=/m, f);
    assert.match(src, /^ARG SOURCE_URL=/m, f);
    assert.match(src, /org\.opencontainers\.image\.source="\$\{SOURCE_URL\}"/, f);
    assert.ok(!/https:\/\/github\.com\//.test(src.replace(/^#.*$/gm, '')), `${f}: hard-coded URL`);
  }
});
