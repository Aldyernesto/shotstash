// Auth error codes shared by the server and the client. Do NOT import server
// modules here. The server sends the code; the client renders its own copy
// from messages by code and never matches on message text.

/** Stable `errorCode` values of a failed `login` (GraphQL AuthPayload). */
export const LOGIN_ERROR_CODES = {
  invalidCredentials: 'INVALID_CREDENTIALS',
  /** The account was created with Google and has no password yet. */
  googleOnly: 'GOOGLE_ONLY_ACCOUNT',
  deactivated: 'ACCOUNT_DEACTIVATED',
  rejected: 'ACCOUNT_REJECTED',
} as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[keyof typeof LOGIN_ERROR_CODES];

/** Any other `login` failure (database down, bug): not the user's fault. */
export const LOGIN_INTERNAL_ERROR = 'INTERNAL';

/** `register` failure: the email already has an account. */
export const EMAIL_TAKEN = 'EMAIL_TAKEN';
