#!/usr/bin/env node
/**
 * Story 6.1: compiles the custom server (`server.ts`) to `dist/server.js`.
 *
 * Only our own code is bundled (`src/**` through the `@/` alias, JSON
 * messages included); Next and every package stay external and resolve from
 * node_modules at runtime. Never `output: standalone`.
 *
 *   npm run build:server
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'dist');

await build({
  absWorkingDir: ROOT,
  entryPoints: ['server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  tsconfig: 'tsconfig.json',
  loader: { '.json': 'json' },
  // CJS-only packages (heic-convert) are loaded with require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __shotstashCreateRequire } from 'node:module';\nconst require = __shotstashCreateRequire(import.meta.url);" },
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'info',
});

// dist/ holds ESM regardless of the root package.json type.
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
