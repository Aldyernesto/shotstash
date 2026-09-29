/**
 * The secret behind signed share URLs, share access cookies and access codes.
 * Fails closed: a missing, short (< 32 characters) or placeholder secret throws.
 * The values come from `config()` (`src/lib/config.ts`); tests pass them in.
 * Alias-free so `node --test` can import it.
 */
import { MIN_SECRET_LENGTH, SECRET_PLACEHOLDER, config, configProblems } from './config.ts';

export { MIN_SECRET_LENGTH, SECRET_PLACEHOLDER };

type Secrets = { MEDIA_SIGNING_SECRET?: string; SESSION_SECRET?: string };

function configured(): Secrets {
  // Fail closed: a configured but invalid media secret never falls back to SESSION_SECRET.
  const bad = configProblems().find((p) => p.startsWith('MEDIA_SIGNING_SECRET:'));
  if (bad) throw new Error(bad);
  const c = config();
  return { MEDIA_SIGNING_SECRET: c.MEDIA_SIGNING_SECRET, SESSION_SECRET: c.SESSION_SECRET };
}

export function signingSecret(secrets: Secrets = configured()): string {
  const s = secrets.MEDIA_SIGNING_SECRET || secrets.SESSION_SECRET || '';
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
