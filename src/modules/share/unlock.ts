/**
 * Whether a visitor may see a share link's content (Story 2.3).
 * Pure and alias-free: `node --test` imports it.
 */
import { shareCookieName, verifyShareAccess } from './access.ts';

export type CookieReader = { get(name: string): { value: string } | undefined };

/** PUBLIC links are always open; PRIVATE links need a valid `shotstash_share_<slug>` cookie for this link. */
export function shareUnlocked(
  cookies: CookieReader,
  link: { id: string; slug: string; mode: string },
  nowMs: number = Date.now(),
): boolean {
  if (link.mode !== 'PRIVATE') return true;
  return verifyShareAccess(cookies.get(shareCookieName(link.slug))?.value ?? null, link.id, nowMs);
}
