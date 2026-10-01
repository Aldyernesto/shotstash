/**
 * Story 7.3: request and response shapes of `/api/v1/auth/*`.
 * Type-only and alias-free (see `common.ts`).
 */

/** Email and password of an account. */
export type LoginRequest = {
  /** Account email. */
  email: string;
  /** Account password. */
  password: string;
};

/** The signed-in account. */
export type LoginUser = {
  /** User id. */
  id: string;
  /** Account email. */
  email: string;
  /** Display name. */
  name: string;
  /** Instance role. */
  role: 'SUPER_ADMIN' | 'ADMIN' | 'FIELD_CREW' | 'EDITOR' | 'VIEWER';
  /** Relative URL of the avatar, or null. */
  avatarUrl: string | null;
  /** PENDING accounts may sign in to see the waiting screen. */
  accountStatus: 'PENDING' | 'ACTIVE' | 'REJECTED';
  /** When onboarding was finished (ISO-8601 UTC), or null. */
  onboardedAt: string | null;
};

/** A new session. The same token is also set as the `shotstash_session` media cookie. */
export type LoginResponse = {
  /** Bearer token for `/api/graphql` and `/api/v1/*`. Keep it secret. */
  token: string;
  /** When the session expires unless used (ISO-8601 UTC). */
  expiresAt: string;
  /** The signed-in account. */
  user: LoginUser;
};

/** The media cookie was set. */
export type CookieResponse = {
  /** Always true. */
  ok: true;
  /** When the session and the cookie expire (ISO-8601 UTC). */
  expiresAt: string;
};
