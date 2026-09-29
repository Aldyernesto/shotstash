/**
 * Story 6.3: the one rule for the sign-up toggle, shared by the `register`
 * mutation and Google auto sign-up. Pure, so `node --test` can load it.
 *
 * An admin creating an account is never a public sign-up; everyone else is
 * refused with FEATURE_DISABLED while `SHOTSTASH_FEATURE_SIGNUP=false`.
 */
export const SIGNUP_DISABLED = {
  success: false as const,
  message: 'Public sign-up is disabled on this instance',
  errorCode: 'FEATURE_DISABLED' as const,
};

/** The refusal payload when this sign-up must be refused, else null. */
export function publicSignupRefusal(adminCreate: boolean, signupEnabled: boolean): typeof SIGNUP_DISABLED | null {
  return !adminCreate && !signupEnabled ? SIGNUP_DISABLED : null;
}
