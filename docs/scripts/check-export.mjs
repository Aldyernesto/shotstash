#!/usr/bin/env node
// After `next build`: the export must not contain an unreplaced placeholder
// (%REPO%, %OWNER_LC%, %PAGES_URL%), and the static search index must exist.
//
//   node scripts/check-export.mjs [out]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLACEHOLDERS = ['%REPO%', '%OWNER_LC%', '%PAGES_URL%'];
const TEXT = /\.(html|txt|js|json|xml|css|md)$/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

/** Problems in an export folder; empty when it is fine. */
export function checkExport(out) {
  const problems = [];
  for (const file of files(out)) {
    const rel = path.relative(out, file).split(path.sep).join('/');
    if (!TEXT.test(file) && rel !== 'api/search') continue;
    const text = readFileSync(file, 'utf8');
    for (const p of PLACEHOLDERS) if (text.includes(p)) problems.push(`${rel}: contains ${p}`);
  }
  let index = null;
  try {
    index = readFileSync(path.join(out, 'api', 'search'), 'utf8');
  } catch {
    problems.push('api/search: the search index is missing');
  }
  if (index !== null) {
    try {
      if (!index.trim() || Object.keys(JSON.parse(index)).length === 0) problems.push('api/search: the search index is empty');
    } catch {
      problems.push('api/search: the search index is not JSON');
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out'));
  const problems = checkExport(out);
  for (const p of problems) console.error(`FAIL ${p}`);
  if (problems.length) process.exit(1);
  console.log('docs export: no placeholders left, search index present');
}
