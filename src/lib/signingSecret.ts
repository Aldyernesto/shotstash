/**
 * The secret behind signed share URLs, share access cookies and access codes.
 * Fails closed: a missing, short (< 32 characters) or placeholder secret throws.
 * Pure and alias-free so `node --test` can import it.
 */

export const SECRET_PLACEHOLDER = 'change-me-before-first-run';
export const MIN_SECRET_LENGTH = 32;

export function signingSecret(env: Record<string, string | undefined> = process.env): string {
  const s = env.MEDIA_SIGNING_SECRET || env.SESSION_SECRET || '';
  if (!s) {
    throw new Error('MEDIA_SIGNING_SECRET (or SESSION_SECRET) is not set. Generate one with: openssl rand -hex 32');
  }
  if (s === SECRET_PLACEHOLDER) {
    throw new Error('MEDIA_SIGNING_SECRET / SESSION_SECRET still holds the example placeholder. Generate one with: openssl rand -hex 32');
  }
  if (s.length < MIN_SECRET_LENGTH) {
    throw new Error(`MEDIA_SIGNING_SECRET / SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters. Generate one with: openssl rand -hex 32`);
  }
  return s;
}
