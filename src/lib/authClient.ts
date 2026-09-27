/**
 * Browser helpers for the session carriers (Story 2.2).
 *
 * The Bearer token stays in localStorage for `/api/graphql`; media bytes use
 * the HttpOnly `shotstash_session` cookie (Path=/media), which only the
 * server can set: `issueMediaCookie` asks for it after any login and on boot.
 */

export async function issueMediaCookie(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch('/api/v1/auth/cookie', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Revokes the session on the server and clears the media cookie. Never throws. */
export async function serverLogout(token: string | null | undefined): Promise<void> {
  if (!token) return;
  try {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    /* offline: the session still expires on the server */
  }
}
