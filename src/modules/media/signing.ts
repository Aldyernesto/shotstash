/**
 * Signed share media URLs (Story 2.3).
 *
 * Token = base64url(payload) + "." + base64url(HMAC-SHA256(payload)), where
 * payload = `shareId|target|exp`:
 *   - target is a file id (exp at most 5 minutes ahead), or
 *   - `zip` / `zip:<sectionId>` for a share ZIP (exp at most 24 hours ahead).
 *
 * A valid signature is never enough on its own: `/media/s/<token>` re-reads
 * the ShareLink row (revoked, expired, target trashed) on every request.
 *
 * Secret: MEDIA_SIGNING_SECRET, falling back to SESSION_SECRET (fails closed,
 * see src/lib/signingSecret.ts).
 * Kept free of path aliases so `node --test` can import it directly.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { signingSecret } from '../../lib/signingSecret.ts';

export const SIGNED_FILE_TTL_SECONDS = 5 * 60;
export const SIGNED_ZIP_TTL_SECONDS = 24 * 60 * 60;

export type SignedTarget = string; // file id, 'zip' or 'zip:<sectionId>'

export type VerifiedShareToken = {
  shareId: string;
  target: SignedTarget;
  /** Expiry, seconds since epoch. */
  exp: number;
};

function mac(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

export function isZipTarget(target: string): boolean {
  return target === 'zip' || target.startsWith('zip:');
}

/** Mints a token. The TTL is capped at 5 min for files and 24 h for ZIPs. */
export function signShareToken(shareId: string, target: SignedTarget, ttlSeconds?: number, nowMs = Date.now()): string {
  if (!shareId || !target || shareId.includes('|') || target.includes('|')) {
    throw new Error('signShareToken: invalid share id or target');
  }
  const cap = isZipTarget(target) ? SIGNED_ZIP_TTL_SECONDS : SIGNED_FILE_TTL_SECONDS;
  const ttl = Math.max(1, Math.min(cap, Math.floor(ttlSeconds ?? cap)));
  const exp = Math.floor(nowMs / 1000) + ttl;
  const payload = `${shareId}|${target}|${exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${mac(payload, signingSecret()).toString('base64url')}`;
}

/** Relative URL of a signed share media item. */
export function signShareUrl(shareId: string, target: SignedTarget, ttlSeconds?: number): string {
  return `/media/s/${signShareToken(shareId, target, ttlSeconds)}`;
}

/**
 * Verifies signature and expiry. Returns null for anything tampered,
 * expired, malformed, or (when given) minted for another share.
 */
export function verifyShareToken(
  token: string | null | undefined,
  opts: { nowMs?: number; expectShareId?: string } = {},
): VerifiedShareToken | null {
  if (!token || token.length > 512) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const payloadPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(payloadPart) || !/^[A-Za-z0-9_-]+$/.test(sigPart)) return null;

  const payload = Buffer.from(payloadPart, 'base64url').toString('utf8');
  const expected = mac(payload, signingSecret());
  const given = Buffer.from(sigPart, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const parts = payload.split('|');
  if (parts.length !== 3) return null;
  const [shareId, target, expRaw] = parts;
  if (!/^\d{1,12}$/.test(expRaw)) return null;
  const exp = Number(expRaw);
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (exp <= now) return null;

  const cap = isZipTarget(target) ? SIGNED_ZIP_TTL_SECONDS : SIGNED_FILE_TTL_SECONDS;
  if (exp - now > cap + 5) return null; // never honour a lifetime longer than the cap
  if (opts.expectShareId && opts.expectShareId !== shareId) return null;

  return { shareId, target, exp };
}
