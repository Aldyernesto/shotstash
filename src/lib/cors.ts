/**
 * Story 8.2: cross-origin access to `/api/*` for an explicit allowlist of
 * origins (`SHOTSTASH_CORS_ORIGINS`), meant for the docs site's try-it
 * console talking to a public demo. Empty by default: no CORS header at all.
 *
 *   - exact origins only (`scheme://host[:port]`), never a wildcard;
 *   - credentials are never allowed (the console sends a Bearer token);
 *   - a preflight from an allowed origin answers 204 with the methods and
 *     headers below; any other origin gets no CORS header (the browser then
 *     blocks the read).
 *
 * Pure and alias-free: `src/lib/config.ts` and `node --test` import it.
 */

export const CORS_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';
export const CORS_HEADERS = 'Authorization, Content-Type, Content-MD5, Range';
export const CORS_EXPOSE = 'Content-Length, Content-Range, Retry-After';
export const CORS_MAX_AGE = '600';

/** The normalised origin of `value`, or null when it is not an exact http(s) origin. */
export function normaliseOrigin(value: string): string | null {
  const raw = value.trim();
  if (!raw || raw.includes('*')) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  // An origin has no path, query or fragment (one trailing slash is tolerated);
  // an explicit default port (https://x:443) normalises to the URL origin.
  if (url.pathname !== '/' || /[?#]/.test(raw)) return null;
  return url.origin;
}

/** Parses a comma-separated list; `problems` names every entry that is not an exact origin. */
export function parseCorsOrigins(raw: string): { origins: string[]; problems: string[] } {
  const origins: string[] = [];
  const problems: string[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed.includes('*')) {
      problems.push(`"${trimmed}" is a wildcard; list exact origins such as https://docs.example.com`);
      continue;
    }
    const origin = normaliseOrigin(trimmed);
    if (!origin) {
      problems.push(`"${trimmed}" is not an origin (scheme://host[:port], no path)`);
      continue;
    }
    if (!origins.includes(origin)) origins.push(origin);
  }
  return { origins, problems };
}

/** True when `origin` (the request's Origin header) is on the list, compared exactly after normalisation. */
export function originAllowed(origin: string | null | undefined, allowed: readonly string[]): boolean {
  if (!origin || !allowed.length) return false;
  const o = normaliseOrigin(origin);
  return o !== null && allowed.includes(o);
}

export type CorsDecision =
  /** Not a cross-origin case for us: no header added, the request goes on. */
  | { kind: 'none' }
  /** An allowed origin: add `headers`, the request goes on. */
  | { kind: 'allow'; headers: Record<string, string> }
  /** A preflight: answer 204 with `headers` (empty for a refused origin). */
  | { kind: 'preflight'; headers: Record<string, string> };

/**
 * What to do with a request to `/api/*`. `method` and `origin` come from the
 * request; `requestMethod` is `Access-Control-Request-Method` (set on a preflight).
 */
export function corsDecision(
  input: { method: string; origin: string | null | undefined; requestMethod: string | null | undefined },
  allowed: readonly string[],
): CorsDecision {
  // No list: the server behaves exactly as without CORS support.
  if (!allowed.length) return { kind: 'none' };
  const ok = originAllowed(input.origin, allowed);
  const vary = { Vary: 'Origin' };
  if (input.method.toUpperCase() === 'OPTIONS' && input.origin && input.requestMethod) {
    if (!ok) return { kind: 'preflight', headers: vary };
    return {
      kind: 'preflight',
      headers: {
        ...vary,
        'Access-Control-Allow-Origin': normaliseOrigin(input.origin)!,
        'Access-Control-Allow-Methods': CORS_METHODS,
        'Access-Control-Allow-Headers': CORS_HEADERS,
        'Access-Control-Max-Age': CORS_MAX_AGE,
      },
    };
  }
  if (!ok) return { kind: 'allow', headers: vary };
  return {
    kind: 'allow',
    headers: {
      ...vary,
      'Access-Control-Allow-Origin': normaliseOrigin(input.origin!)!,
      'Access-Control-Expose-Headers': CORS_EXPOSE,
    },
  };
}
