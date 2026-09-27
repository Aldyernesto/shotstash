/**
 * Shared tokenizer for the privacy scanner (scripts/privacy-scan.mjs) and the
 * hash generator (scripts/privacy-hash.mjs). Both sides MUST normalize text the
 * same way, so they import this module instead of carrying their own copy.
 *
 * A phrase is 1 to MAX_PHRASE_TOKENS consecutive tokens joined by one space.
 * Its digest is SHA-256 over SALT + phrase. The salt is public: it only stops
 * generic precomputed tables, it does not make short phrases secret.
 */
import { createHash } from 'node:crypto';

export const SALT = 'shotstash-privacy-denylist-v1:';
export const MAX_PHRASE_TOKENS = 4;

/**
 * Canary term. Its hash is always written into the denylist and the fixture
 * scripts/__fixtures__/privacy-canary.txt contains it, so the test suite can
 * prove the scanner fires.
 */
// Split across two literals so this source line does not itself hold the
// canary phrase (the scanner reads source text, not evaluated values).
export const CANARY = 'priv' + 'acy canary 4b1d9e';

/**
 * NFKC-normalize, split camelCase (lower-to-upper) boundaries, lowercase,
 * split on anything that is not a letter, mark or digit, drop empties.
 */
export function tokenize(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
}

/** Every run of 1..maxN consecutive tokens, joined by a single space. */
export function phrases(tokens, maxN = MAX_PHRASE_TOKENS) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    let phrase = '';
    for (let n = 0; n < maxN && i + n < tokens.length; n++) {
      phrase = n === 0 ? tokens[i] : `${phrase} ${tokens[i + n]}`;
      out.push(phrase);
    }
  }
  return out;
}

/** Normalizes a denylist entry to its canonical phrase form. */
export function normalizePhrase(text) {
  return tokenize(text).join(' ');
}

/** Hex SHA-256 of SALT + phrase (phrase must already be normalized). */
export function hashPhrase(phrase) {
  return createHash('sha256').update(SALT + phrase, 'utf8').digest('hex');
}
