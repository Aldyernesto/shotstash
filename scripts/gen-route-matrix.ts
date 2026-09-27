/**
 * Story 2.1: writes docs/security/route-matrix.md (route or field, auth mode,
 * required action). `--check` exits 1 when the committed file is stale or a
 * route is undeclared.
 *
 *   npm run security:matrix
 *   npm run security:matrix -- --check
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MATRIX_PATH, analyzeRoute, renderMatrix, routeFiles } from './route-matrix-lib.mjs';

type Method = { method: string; declared: { auth: string } | null };
type Analyzed = { path: string; methods: Method[] };

async function main() {
  const check = process.argv.includes('--check');
  const undeclared = (routeFiles() as string[])
    .map((f) => analyzeRoute(f) as Analyzed)
    .flatMap((r) => r.methods.filter((m) => !m.declared).map((m) => `${m.method} ${r.path}`));
  if (undeclared.length) {
    console.error(`security:matrix: routes without defineRoute(): ${undeclared.join(', ')}`);
    process.exit(1);
  }

  const next = await renderMatrix();
  if (check) {
    const current = existsSync(MATRIX_PATH) ? readFileSync(MATRIX_PATH, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== next) {
      console.error('security:matrix: docs/security/route-matrix.md is stale. Run `npm run security:matrix`.');
      process.exit(1);
    }
    console.log('security:matrix: up to date');
    return;
  }
  mkdirSync(dirname(MATRIX_PATH), { recursive: true });
  writeFileSync(MATRIX_PATH, next);
  console.log(`security:matrix: wrote ${MATRIX_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
