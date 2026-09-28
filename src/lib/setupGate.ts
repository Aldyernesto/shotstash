/**
 * Which paths the custom server serves before first-run setup (Story 2.6).
 * Pure: `node --test` imports it.
 *
 * An explicit allowlist, never a suffix rule: `/s/abc.json` or
 * `/dashboard/x.txt` are pages and must redirect to `/setup`.
 */

/** Exact paths served before setup. */
export const PRE_SETUP_EXACT: ReadonlySet<string> = new Set([
  '/setup',
  '/api/v1/setup',
  '/api/health',
  // Root files from public/ and the app metadata routes.
  '/favicon.ico',
  '/icon.svg',
  '/apple-icon.png',
  '/manifest.webmanifest',
  '/folder-v2-shell.glb',
]);

/** Path prefixes served before setup (build assets, brand files, fonts). */
export const PRE_SETUP_PREFIXES: readonly string[] = ['/_next/', '/brand/', '/fonts/'];

export function allowedBeforeSetup(pathname: string): boolean {
  if (PRE_SETUP_EXACT.has(pathname)) return true;
  return PRE_SETUP_PREFIXES.some((p) => pathname.startsWith(p));
}

/** How a blocked request is answered: JSON 503 for the API and media, a redirect (or HTML) for pages. */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/media' || pathname.startsWith('/media/');
}
