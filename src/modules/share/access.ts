/**
 * PRIVATE share access (Story 2.3).
 *
 *   - At creation the server generates a 6-character access code, stores only
 *     its HMAC, and shows the code once to the creator.
 *   - `POST /s/<slug>/unlock` with the right code sets the signed cookie
 *     `shotstash_share_<slug>` (HttpOnly; Path=/s/<slug>; 24 h), which lets
 *     `POST /s/<slug>/sign` and `GET /s/<slug>/items` work.
 *
 * Kept free of path aliases so `node --test` can import it directly.
 */

import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { signingSecret } from '../../lib/signingSecret.ts';

export const SHARE_ACCESS_TTL_SECONDS = 24 * 60 * 60;
export const ACCESS_CODE_LENGTH = 6;
// No 0/O, 1/I/L: easy to read aloud and type. An alphabet, not a secret.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // gitleaks:allow

export function shareCookieName(slug: string): string {
  return `shotstash_share_${slug}`;
}

export function shareCookiePath(slug: string): string {
  return `/s/${slug}`;
}

export function generateAccessCode(): string {
  let out = '';
  for (let i = 0; i < ACCESS_CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function normalizeAccessCode(input: string): string {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashAccessCode(code: string): string {
  return createHmac('sha256', signingSecret()).update(`share-code|${normalizeAccessCode(code)}`).digest('hex');
}

export function verifyAccessCode(input: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const code = normalizeAccessCode(input);
  if (code.length !== ACCESS_CODE_LENGTH) return false;
  const a = Buffer.from(hashAccessCode(code), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function mac(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

/** Cookie value proving the access code for one share. */
export function mintShareAccess(shareId: string, nowMs = Date.now()): { value: string; expires: Date } {
  const exp = Math.floor(nowMs / 1000) + SHARE_ACCESS_TTL_SECONDS;
  const payload = `share-access|${shareId}|${exp}`;
  return { value: `${exp}.${mac(payload)}`, expires: new Date(exp * 1000) };
}

export function verifyShareAccess(value: string | null | undefined, shareId: string, nowMs = Date.now()): boolean {
  if (!value) return false;
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{20,100})$/.exec(value);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp <= Math.floor(nowMs / 1000)) return false;
  const expected = Buffer.from(mac(`share-access|${shareId}|${exp}`));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
