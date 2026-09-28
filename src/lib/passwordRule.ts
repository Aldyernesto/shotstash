/**
 * Password rule shared by registration, first-run setup, admin-set passwords
 * and self-service reset (Story 2.5). Enforced on the server; the client
 * forms import the same constants. Pure: `node --test` imports this file.
 *
 * The maximum exists because bcrypt only reads the first 72 bytes: a longer
 * password would silently be cut.
 */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 256;
export const MAX_PASSWORD_BYTES = 72;

export type PasswordProblem = 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG';

export const PASSWORD_TOO_LONG_MESSAGE = `Password must be at most ${MAX_PASSWORD_BYTES} bytes (about ${MAX_PASSWORD_BYTES} plain characters; accented letters and emoji count more).`;

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Null when the password is acceptable, else the stable error code. */
export function passwordProblem(password: unknown): PasswordProblem | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return 'PASSWORD_TOO_SHORT';
  if (password.length > MAX_PASSWORD_LENGTH || utf8Bytes(password) > MAX_PASSWORD_BYTES) return 'PASSWORD_TOO_LONG';
  return null;
}
