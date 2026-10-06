#!/usr/bin/env node
/**
 * Story 8.2: compiles the demo command (`src/modules/demo/cli.ts`) to
 * `dist/demo.js` with the same settings as the server (scripts/build-server.mjs),
 * so a public demo can be seeded and reset inside the image:
 *
 *   docker compose exec app node dist/demo.js seed|reset
 *
 *   npm run build:demo
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'dist');

await build({
  absWorkingDir: ROOT,
  entryPoints: ['src/modules/demo/cli.ts'],
  outfile: 'dist/demo.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  tsconfig: 'tsconfig.json',
  loader: { '.json': 'json' },
  banner: { js: "import { createRequire as __shotstashCreateRequire } from 'node:module';\nconst require = __shotstashCreateRequire(import.meta.url);" },
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'info',
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
