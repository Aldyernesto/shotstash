#!/usr/bin/env node
/**
 * Keeps eslint/legacy-allowlist.json honest. The allowlist names the files
 * that still live outside src/modules; it may only shrink.
 *
 * Fails when:
 *   - a file under src/services/ is not listed (the legacy area grew), or
 *   - a listed file no longer exists (remove the stale entry), or
 *   - the list has an entry that the base ref's list does not (the list grew).
 *     Base ref: LEGACY_BASE env, default origin/main; skipped with a note when
 *     the ref or its allowlist is unavailable.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST = path.join(ROOT, 'eslint', 'legacy-allowlist.json');
const LEGACY_DIR = 'src/services';

function walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : [rel];
  });
}

function parseFiles(text, where) {
  let files;
  try {
    files = JSON.parse(text).files;
  } catch (e) {
    console.error(`check:legacy: ${where} is not valid JSON (${e.message})`);
    process.exit(1);
  }
  if (!Array.isArray(files)) {
    console.error(`check:legacy: ${where} has no "files" array`);
    process.exit(1);
  }
  return files;
}

const listed = parseFiles(readFileSync(ALLOWLIST, 'utf8'), 'eslint/legacy-allowlist.json');
const listedSet = new Set(listed);
const problems = [];
for (const f of walk(LEGACY_DIR)) {
  if (!listedSet.has(f)) problems.push(`NEW    ${f} is not in the legacy allowlist; put new code in src/modules/<domain>/`);
}
for (const f of listed) {
  if (!existsSync(path.join(ROOT, f))) problems.push(`STALE  ${f} no longer exists; remove it from the allowlist`);
}

const baseRef = process.env.LEGACY_BASE || 'origin/main';
const base = spawnSync('git', ['show', `${baseRef}:eslint/legacy-allowlist.json`], { cwd: ROOT, encoding: 'utf8' });
if (base.status === 0) {
  const baseSet = new Set(parseFiles(base.stdout, `${baseRef}:eslint/legacy-allowlist.json`));
  for (const f of listed) {
    if (!baseSet.has(f)) problems.push(`GREW   ${f} is not in the allowlist on ${baseRef}; the list may only shrink`);
  }
} else {
  console.log(`check:legacy: note: ${baseRef} allowlist unavailable, growth check skipped`);
}

if (problems.length) {
  console.error(`check:legacy: ${problems.length} problem(s) in eslint/legacy-allowlist.json:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check:legacy: ${listed.length} legacy file(s), allowlist matches ${LEGACY_DIR}/`);
