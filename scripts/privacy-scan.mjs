#!/usr/bin/env node
/**
 * Privacy scanner. Two layers:
 *   1. gitleaks (secret patterns), run over the selected files.
 *   2. A hashed denylist: every line of every selected file is tokenized
 *      (scripts/privacy-tokenize.mjs), every phrase of 1..4 tokens is hashed,
 *      and any hash found in scripts/privacy-denylist.sha256 is a finding.
 *
 * The plaintext denylist is not in this repository; only its hashes are.
 * Findings print `file:line` and the finding kind, never the matched text.
 *
 * Usage:
 *   node scripts/privacy-scan.mjs                  files changed vs --base (default origin/main,
 *                                                  then HEAD~1, then the whole tree)
 *   node scripts/privacy-scan.mjs --base <ref>     files changed vs <ref>
 *   node scripts/privacy-scan.mjs --all            every tracked and untracked, non-ignored file
 *   node scripts/privacy-scan.mjs --files a b ...  exactly these files (default skips do not apply)
 *   --denylist <file>                              use another hash file (default scripts/privacy-denylist.sha256)
 *   --denylist-only                                skip gitleaks (used by the test suite)
 *
 * gitleaks is optional locally (a warning is printed) and required when CI=true.
 * Set GITLEAKS_BIN to use a binary that is not on PATH.
 *
 * Exit codes: 0 clean, 1 findings or a required tool missing, 2 usage error.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPhrase, phrases, tokenize } from './privacy-tokenize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DENYLIST = path.join(ROOT, 'scripts', 'privacy-denylist.sha256');
/** Never scanned in --all or diff mode (repo-relative, forward slashes). */
const DEFAULT_SKIPS = new Set([
  'scripts/privacy-denylist.sha256',
  'scripts/__fixtures__/privacy-canary.txt',
]);
const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?)$/i;

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
const opts = { mode: 'diff', base: null, files: [], denylistOnly: false, denylist: DEFAULT_DENYLIST };

function usage(msg) {
  console.error(`privacy scan: ${msg}`);
  console.error('usage: node scripts/privacy-scan.mjs [--all | --base <ref> | --files a b ...] [--denylist <file>] [--denylist-only]');
  process.exit(2);
}

function flagValue(i, name) {
  const v = args[i];
  if (!v || v.startsWith('--')) usage(`${name} needs a value`);
  return v;
}

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--all') opts.mode = 'all';
  else if (a === '--denylist-only') opts.denylistOnly = true;
  else if (a === '--base') opts.base = flagValue(++i, '--base');
  else if (a === '--denylist') opts.denylist = path.resolve(flagValue(++i, '--denylist'));
  else if (a === '--files') {
    opts.mode = 'files';
    while (i + 1 < args.length && !args[i + 1].startsWith('--')) opts.files.push(args[++i]);
    if (!opts.files.length) usage('--files needs at least one path');
  } else usage(`unknown argument: ${a}`);
}
for (const f of opts.files) if (!existsSync(f)) usage(`file not found: ${f}`);

// ---------------------------------------------------------------- helpers
/** Runs git; returns stdout, or null on failure (for probes only). */
function gitTry(gitArgs) {
  const r = spawnSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

/** Runs a NUL-separated git listing that must succeed; failure ends the scan, never a silent clean. */
function gitList(gitArgs) {
  const out = gitTry(gitArgs);
  if (out === null) {
    console.error(`privacy scan: git ${gitArgs.join(' ')} failed`);
    process.exit(1);
  }
  return out.split('\0').filter(Boolean);
}

const toPosix = (p) => p.split(path.sep).join('/');

function allFiles() {
  return gitList(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
}

function changedFiles() {
  const candidates = opts.base ? [opts.base] : ['origin/main', 'HEAD~1'];
  for (const ref of candidates) {
    if (gitTry(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) === null) continue;
    const mergeBase = (gitTry(['merge-base', ref, 'HEAD']) ?? '').trim() || ref;
    // Working tree vs merge base covers committed and uncommitted changes.
    const changed = gitList(['diff', '-z', '--name-only', '--diff-filter=ACMR', mergeBase]);
    const untracked = gitList(['ls-files', '-z', '--others', '--exclude-standard']);
    console.log(`privacy scan: files changed since ${ref}`);
    return [...new Set([...changed, ...untracked])];
  }
  if (opts.base) {
    console.error(`privacy scan: base ref not found: ${opts.base}`);
    process.exit(1);
  }
  console.log('privacy scan: no base ref found, scanning the whole tree');
  return allFiles();
}

function selectFiles() {
  if (opts.mode === 'files') {
    return opts.files.map((f) => ({ abs: path.resolve(f), rel: displayPath(path.resolve(f)) }));
  }
  const rels = opts.mode === 'all' ? allFiles() : changedFiles();
  return rels
    .map((r) => toPosix(r))
    .filter((r) => !DEFAULT_SKIPS.has(r))
    .map((r) => ({ abs: path.join(ROOT, r), rel: r }));
}

function displayPath(abs) {
  const rel = path.relative(ROOT, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? toPosix(rel) : toPosix(abs);
}

function readText(abs) {
  let st;
  try { st = statSync(abs); } catch { return null; }
  if (!st.isFile() || st.size > MAX_BYTES) return null;
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8192).includes(0)) return null; // binary
  return buf.toString('utf8');
}

function loadDenylist() {
  if (!existsSync(opts.denylist)) {
    console.error(`privacy scan: denylist not found: ${displayPath(opts.denylist)}`);
    process.exit(1);
  }
  const set = new Set();
  for (const line of readFileSync(opts.denylist, 'utf8').split('\n')) {
    const h = line.trim();
    if (!h) continue;
    if (!/^[0-9a-f]{64}$/.test(h)) {
      console.error('privacy scan: the denylist contains a line that is not a SHA-256 digest');
      process.exit(1);
    }
    set.add(h);
  }
  return set;
}

// ---------------------------------------------------------------- layer 2: denylist
function scanDenylist(files, denylist) {
  const findings = [];
  let skipped = 0;
  for (const f of files) {
    const text = readText(f.abs);
    if (text === null) {
      if (!IMAGE_EXT.test(f.abs)) skipped++;
      continue;
    }
    const fileLines = text.split(/\r?\n/);
    for (let i = 0; i < fileLines.length; i++) {
      const tokens = tokenize(fileLines[i]);
      if (!tokens.length) continue;
      if (phrases(tokens).some((p) => denylist.has(hashPhrase(p)))) {
        findings.push(`${f.rel}:${i + 1}  denylisted phrase`);
      }
    }
  }
  if (skipped) console.log(`privacy scan: skipped ${skipped} non-image file(s) (binary, over 5 MB or unreadable)`);
  return findings;
}

// ---------------------------------------------------------------- layer 1: gitleaks
/** Spawns gitleaks; a .js/.mjs GITLEAKS_BIN runs under node (lets tests stub it). */
function runBin(bin, binArgs) {
  return /\.m?js$/i.test(bin)
    ? spawnSync(process.execPath, [bin, ...binArgs], { encoding: 'utf8' })
    : spawnSync(bin, binArgs, { encoding: 'utf8' });
}

function gitleaksBin() {
  const bin = process.env.GITLEAKS_BIN || 'gitleaks';
  return runBin(bin, ['version']).status === 0 ? bin : null;
}

function scanGitleaks(files) {
  const bin = gitleaksBin();
  if (!bin) {
    if (process.env.CI === 'true') {
      console.error('privacy scan: gitleaks is required in CI but was not found');
      return { findings: [], failed: true };
    }
    console.warn('privacy scan: warning: gitleaks not found, secret scan skipped (install gitleaks or set GITLEAKS_BIN)');
    return { findings: [], failed: false };
  }
  // Copy the selection into a scratch dir so gitleaks sees exactly these files
  // (not node_modules, build output or ignored local files).
  const stage = mkdtempSync(path.join(tmpdir(), 'privacy-scan-'));
  try {
    const byStaged = new Map();
    let n = 0;
    for (const f of files) {
      if (readText(f.abs) === null) continue;
      const rel = f.rel.startsWith('/') || /^[a-z]:/i.test(f.rel) ? `external/${n++}/${path.basename(f.abs)}` : f.rel;
      const dest = path.join(stage, 'tree', rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(f.abs, dest);
      byStaged.set(toPosix(rel), f.rel);
    }
    if (!byStaged.size) return { findings: [], failed: false };
    const report = path.join(stage, 'report.json');
    const r = runBin(bin, [
      'dir', path.join(stage, 'tree'), '--no-banner', '--redact',
      '--report-format', 'json', '--report-path', report, '--exit-code', '1', '--log-level', 'error',
    ]);
    if (r.status !== 0 && r.status !== 1) {
      console.error(`privacy scan: gitleaks failed (exit ${r.status})`);
      if (r.stderr) console.error(r.stderr.trim());
      return { findings: [], failed: true };
    }
    const results = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8') || '[]') : [];
    const findings = results.map((x) => {
      const stagedRel = toPosix(path.relative(path.join(stage, 'tree'), path.resolve(path.join(stage, 'tree'), x.File)));
      return `${byStaged.get(stagedRel) ?? stagedRel}:${x.StartLine}  secret (${x.RuleID})`;
    });
    if (r.status === 1 && !findings.length) findings.push('gitleaks reported a leak without a parsable report');
    return { findings, failed: false };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- main
const files = selectFiles();
const denylist = loadDenylist();
const findings = scanDenylist(files, denylist);
let failed = false;
if (!opts.denylistOnly) {
  const g = scanGitleaks(files);
  findings.push(...g.findings);
  failed = g.failed;
}

if (findings.length) {
  console.error(`privacy scan: ${findings.length} finding(s) in ${files.length} file(s)`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
if (failed) process.exit(1);
console.log(`privacy scan: clean (${files.length} file(s))`);
