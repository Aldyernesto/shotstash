/**
 * Cover URLs (project covers and avatars): relative, cookie-authorised,
 * with a `?v=` cache buster. Pure and alias-free (unit-tested).
 */
/** Same values as the storage module's cover kinds. */
type CoverKind = 'project' | 'user';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Relative, cookie-authorised cover URL; `?v=` busts the private cache after a change. */
export function coverUrl(kind: CoverKind, id: string, version: number | string = Date.now()): string {
  return `/media/c/${kind}/${id}?v=${version}`;
}

/** The cover id inside a stored cover URL (`/media/c/<kind>/<uuid>?v=...`), or null. */
export function coverIdFromUrl(url: string | null | undefined): { kind: CoverKind; id: string } | null {
  const m = /^\/media\/c\/(project|user)\/([0-9a-f-]{36})(?:\?v=\d+)?$/.exec(url ?? '');
  return m && UUID_RE.test(m[2]) ? { kind: m[1] as CoverKind, id: m[2] } : null;
}

