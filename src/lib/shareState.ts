/**
 * Share link liveness (Story 2.3). Pure and alias-free: `node --test` imports it.
 */

/** Why a link row can no longer be used, or null when it is live. */
export function linkInactiveReason(
  link: { revokedAt: Date | null; expiresAt: Date | null },
  nowMs: number = Date.now(),
): 'revoked' | 'expired' | null {
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt && link.expiresAt.getTime() <= nowMs) return 'expired';
  return null;
}
