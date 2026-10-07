import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // public/trailer is copied from promo/ by scripts/prepare.mjs (vendored three.js, not docs code).
  globalIgnores(['.next/**', 'out/**', '.source/**', 'node_modules/**', 'next-env.d.ts', 'public/trailer/**']),
]);
