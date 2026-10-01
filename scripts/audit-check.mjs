// Story 6.4: dependency audit gate. Runs `npm audit --json --omit=dev` and
// fails on any high or critical advisory in a production dependency unless
// audit-allowlist.json lists it with a reason and an expiry that has not
// passed. Entries may run at most 90 days ahead, so every exception is
// looked at again.
//
//   node scripts/audit-check.mjs                  # runs npm audit
//   node scripts/audit-check.mjs --report a.json  # reads a saved report
//
// audit-allowlist.json: { "advisories": [{ "id": "GHSA-...", "package": "x",
// "reason": "why it cannot be fixed now", "expires": "YYYY-MM-DD" }] }
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ALLOWLIST_PATH = join(ROOT, 'audit-allowlist.json');
export const GATED = new Set(['high', 'critical']);
export const MAX_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const rank = (sev) => SEVERITY_RANK[sev] ?? -1;
/** Warn this many days before an allowlist entry expires. */
export const WARN_DAYS = 14;

/**
 * GHSA id from the advisory URL; otherwise `npm-<source>`, otherwise
 * `npm-<name>-<title>`. Never undefined.
 */
export function advisoryId(via, pkg = '') {
  const m = /\/advisories\/(GHSA-[\w-]+)/i.exec(via.url || '');
  if (m) return m[1];
  if (via.source !== undefined && via.source !== null && via.source !== '') return `npm-${via.source}`;
  const name = via.name || pkg || 'unknown';
  const title = String(via.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `npm-${name}-${title}`;
}

/**
 * Every advisory in an `npm audit --json` report, one entry per id:
 * `packages` are the packages the advisory is about, `via` the reported
 * packages that depend on them, `severity` the highest seen.
 */
export function advisories(report) {
  const vulns = report.vulnerabilities || {};
  const out = new Map();
  for (const [pkg, v] of Object.entries(vulns)) {
    for (const via of v.via || []) {
      if (typeof via !== 'object' || via === null) continue; // a dependency chain, not an advisory
      const id = advisoryId(via, pkg);
      const name = via.name || pkg;
      const prev = out.get(id);
      if (prev) {
        prev.packages.add(name);
        if (rank(via.severity) > rank(prev.severity)) prev.severity = via.severity;
        continue;
      }
      out.set(id, { id, severity: via.severity, title: via.title || '', url: via.url || '', packages: new Set([name]) });
    }
  }
  const dependents = (names) =>
    Object.entries(vulns)
      .filter(([, v]) => (v.via || []).some((x) => typeof x === 'string' && names.has(x)))
      .map(([k]) => k)
      .sort();
  return [...out.values()]
    .map((a) => ({ ...a, packages: [...a.packages].sort(), via: dependents(a.packages) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function parseDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * The gate decision. `today` is a YYYY-MM-DD string (UTC). An entry is valid
 * through its expiry day.
 */
export function evaluate(report, allowlist, today) {
  const failures = [];
  const allowed = [];
  const warnings = [];
  if (report.error) {
    failures.push(`npm audit failed: ${report.error.summary || report.error.code || JSON.stringify(report.error)}`);
    return { failures, allowed, warnings };
  }
  const now = parseDay(today);
  const entries = new Map();
  for (const e of allowlist.advisories || []) {
    const expires = parseDay(e.expires);
    if (!e.id) failures.push('audit-allowlist.json: an entry has no id');
    else if (!e.reason || !String(e.reason).trim()) failures.push(`audit-allowlist.json: ${e.id} has no reason`);
    else if (expires === null) failures.push(`audit-allowlist.json: ${e.id} has no valid expires date (YYYY-MM-DD)`);
    else if (expires - now > MAX_DAYS * DAY) failures.push(`audit-allowlist.json: ${e.id} expires more than ${MAX_DAYS} days ahead (${e.expires})`);
    if (e.id) entries.set(e.id, { ...e, expiresAt: expires });
    if (e.id && expires !== null && expires >= now && expires - now <= WARN_DAYS * DAY) {
      warnings.push(`audit-allowlist.json: ${e.id} expires on ${e.expires} (within ${WARN_DAYS} days); fix it or renew the entry`);
    }
  }
  const reported = advisories(report);
  const seen = new Set();
  for (const a of reported) {
    seen.add(a.id);
    if (!GATED.has(a.severity)) continue;
    const through = a.via.length ? `, via ${a.via.join(', ')}` : '';
    const label = `${a.id} (${a.severity}, ${a.packages.join(', ')}${through}): ${a.title} ${a.url}`.trim();
    const entry = entries.get(a.id);
    if (!entry) failures.push(`not allowlisted: ${label}`);
    else if (entry.package && !a.packages.includes(entry.package)) {
      failures.push(`allowlist entry names package "${entry.package}" but the advisory is reported for ${a.packages.join(', ')}: ${label}`);
    }
    else if (entry.expiresAt === null || entry.expiresAt < now) failures.push(`allowlist entry expired on ${entry.expires}: ${label}`);
    else allowed.push(`${label} (allowlisted until ${entry.expires}: ${entry.reason})`);
  }
  for (const id of entries.keys()) {
    if (!seen.has(id)) warnings.push(`audit-allowlist.json: ${id} is no longer reported; remove the entry`);
  }
  return { failures, allowed, warnings };
}

function runAudit() {
  try {
    return execSync('npm audit --json --omit=dev', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (err) {
    // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
    if (err.stdout) return err.stdout;
    throw err;
  }
}

function main(argv) {
  const at = argv.indexOf('--report');
  if (at >= 0 && (!argv[at + 1] || argv[at + 1].startsWith('--'))) {
    console.error('--report needs a path to a saved `npm audit --json` report.');
    process.exit(2);
  }
  const raw = at >= 0 ? readFileSync(argv[at + 1], 'utf8') : runAudit();
  const report = JSON.parse(raw);
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  const { failures, allowed, warnings } = evaluate(report, allowlist, today);
  for (const a of allowed) console.log(`allowed  ${a}`);
  for (const w of warnings) console.log(`warning  ${w}`);
  for (const f of failures) console.error(`FAIL     ${f}`);
  if (failures.length) {
    console.error(`\nDependency audit failed (${failures.length}). Upgrade the dependency, or add the advisory id to audit-allowlist.json with a reason and an expiry at most ${MAX_DAYS} days ahead.`);
    process.exit(1);
  }
  console.log(`Dependency audit passed: no unlisted high or critical advisory in production dependencies (${allowed.length} allowlisted).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
