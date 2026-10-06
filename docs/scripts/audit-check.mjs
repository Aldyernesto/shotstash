#!/usr/bin/env node
// Dependency audit of the docs site (same gate as the app, scripts/audit-check.mjs):
// fails on any high or critical advisory in a production dependency of docs/
// unless docs/audit-allowlist.json lists it with a reason and an expiry at most
// 90 days ahead. Reuses the repository's decision logic; imports no app code.
//
//   npm run audit:check            (from docs/)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluate, MAX_DAYS } from '../../scripts/audit-check.mjs';

const DOCS = fileURLToPath(new URL('..', import.meta.url));

function runAudit() {
  try {
    return execSync('npm audit --json --omit=dev', { cwd: DOCS, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (err) {
    if (err.stdout) return err.stdout;
    throw err;
  }
}

const report = JSON.parse(runAudit());
const allowlist = JSON.parse(readFileSync(new URL('../audit-allowlist.json', import.meta.url), 'utf8'));
const { failures, allowed, warnings } = evaluate(report, allowlist, new Date().toISOString().slice(0, 10));
for (const a of allowed) console.log(`allowed  ${a}`);
for (const w of warnings) console.log(`warning  ${w.replace('audit-allowlist.json', 'docs/audit-allowlist.json')}`);
for (const f of failures) console.error(`FAIL     ${f.replace('audit-allowlist.json', 'docs/audit-allowlist.json')}`);
if (failures.length) {
  console.error(`\nDocs dependency audit failed (${failures.length}). Upgrade the dependency, or add the advisory id to docs/audit-allowlist.json with a reason and an expiry at most ${MAX_DAYS} days ahead.`);
  process.exit(1);
}
console.log(`Docs dependency audit passed: no unlisted high or critical advisory (${allowed.length} allowlisted).`);
