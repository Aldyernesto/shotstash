/**
 * First-run setup input rules (Story 2.6). Pure and alias-free:
 * `node --test` imports it directly.
 */
import { createHash, timingSafeEqual } from 'crypto';
import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_LONG_MESSAGE, passwordProblem } from '../../lib/passwordRule.ts';

export type SetupInput = { name: string; email: string; password: string };

export type SetupField = 'name' | 'email' | 'password' | 'confirm';

export type SetupValidation =
  | { ok: true; value: SetupInput }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG' | 'PASSWORD_MISMATCH';
      field: SetupField;
      message: string;
    };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_NAME_LENGTH = 80;
export const MAX_EMAIL_LENGTH = 254;

/** Validates the setup form body. `confirm` is checked only when it is sent. */
export function validateSetupInput(body: unknown): SetupValidation {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';

  if (!name || name.length > MAX_NAME_LENGTH) {
    return { ok: false, code: 'INVALID_INPUT', field: 'name', message: `Enter a name (1 to ${MAX_NAME_LENGTH} characters).` };
  }
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, code: 'INVALID_INPUT', field: 'email', message: 'Enter a valid email address.' };
  }
  const problem = passwordProblem(password);
  if (problem) {
    return {
      ok: false,
      code: problem,
      field: 'password',
      message: problem === 'PASSWORD_TOO_SHORT' ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : PASSWORD_TOO_LONG_MESSAGE,
    };
  }
  if (b.confirm !== undefined && b.confirm !== password) {
    return { ok: false, code: 'PASSWORD_MISMATCH', field: 'confirm', message: 'The passwords do not match.' };
  }
  return { ok: true, value: { name, email, password } };
}

/** True when `SETUP_TOKEN` is set: the setup form then asks for it. */
export function setupTokenRequired(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.SETUP_TOKEN);
}

/** Constant-time check of the submitted setup token (true when no token is configured). */
export function setupTokenMatches(given: unknown, env: Record<string, string | undefined> = process.env): boolean {
  const expected = env.SETUP_TOKEN;
  if (!expected) return true;
  if (typeof given !== 'string' || !given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

