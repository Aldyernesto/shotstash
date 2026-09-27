#!/usr/bin/env node
/**
 * Builds scripts/privacy-denylist.sha256 from a plaintext denylist that lives
 * OUTSIDE this repository.
 *
 *   npm run privacy:hash -- <path/to/plaintext-denylist.txt> [--out <file>]
 *
 * Plaintext format: one phrase per line, 1 to 4 tokens after normalization
 * (see scripts/privacy-tokenize.mjs); blank lines and lines starting with #
 * are ignored. The output holds sorted, unique hex digests plus the canary
 * digest, and nothing else. Never commit the plaintext file.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANARY, MAX_PHRASE_TOKENS, hashPhrase, tokenize } from './privacy-tokenize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'scripts', 'privacy-denylist.sha256');

function usage(msg) {
  if (msg) console.error(`privacy hash: ${msg}`);
  console.error('usage: npm run privacy:hash -- <plaintext-denylist-file> [--out <file>]');
  process.exit(2);
}

const args = process.argv.slice(2);
let input = null;
let out = DEFAULT_OUT;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    const v = args[++i];
    if (!v || v.startsWith('--')) usage('--out needs a path');
    out = path.resolve(v);
  } else if (!args[i].startsWith('--') && input === null) input = args[i];
  else usage(`unexpected argument: ${args[i]}`);
}
if (!input) usage();
if (!existsSync(input)) usage(`file not found: ${input}`);

/** True when `child` resolves (through links, any case on Windows) inside `parent`. */
function isInside(child, parent) {
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = path.relative(fold(realpathSync(parent)), fold(realpathSync(child)));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

if (isInside(input, ROOT)) {
  console.error('privacy hash: the plaintext denylist must live outside this repository');
  process.exit(1);
}

const hashes = new Set([hashPhrase(tokenize(CANARY).join(' '))]);
const errors = [];
readFileSync(input, 'utf8').split(/\r?\n/).forEach((raw, i) => {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return;
  const tokens = tokenize(line);
  if (!tokens.length) return;
  if (tokens.length > MAX_PHRASE_TOKENS) {
    errors.push(`line ${i + 1}: ${tokens.length} tokens (max ${MAX_PHRASE_TOKENS})`);
    return;
  }
  hashes.add(hashPhrase(tokens.join(' ')));
});

if (errors.length) {
  console.error('privacy hash: phrases too long to ever match:');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

writeFileSync(out, [...hashes].sort().join('\n') + '\n');
console.log(`privacy hash: wrote ${hashes.size} digest(s) to ${path.relative(ROOT, out).split(path.sep).join('/')}`);
