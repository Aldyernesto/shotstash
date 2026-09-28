/**
 * Google sign-in decision (Story 2.5): an id token links to (or creates) an
 * account only when Google says the email is verified. Pure: `node --test`
 * imports it.
 */
export type GooglePayloadLike = { email?: string | null; email_verified?: boolean | null } | null | undefined;

export type GoogleEmailDecision = { ok: true; email: string } | { ok: false; code: 'INVALID_TOKEN' | 'EMAIL_NOT_VERIFIED' };

export function googleEmailDecision(payload: GooglePayloadLike): GoogleEmailDecision {
  const email = typeof payload?.email === 'string' ? payload.email.trim() : '';
  if (!email) return { ok: false, code: 'INVALID_TOKEN' };
  // Only an explicit `true` counts: missing or false never links an account.
  if (payload?.email_verified !== true) return { ok: false, code: 'EMAIL_NOT_VERIFIED' };
  return { ok: true, email };
}
