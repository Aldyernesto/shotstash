/**
 * Request facts used for rate limits, cookie flags and security headers
 * (Story 2.7). This is the only reader of `X-Forwarded-*` in the app.
 *
 * Trust model: `server.ts` strips any incoming `x-shotstash-client-ip` and
 * sets it from the TCP peer (`req.socket.remoteAddress`) for every HTTP
 * request. Forwarded headers (`cf-connecting-ip`, `x-forwarded-for`,
 * `x-forwarded-proto`) are honoured only when `TRUST_PROXY=true`, i.e. when
 * the app is reachable only through a reverse proxy that sets them.
 */

type HeadersLike = { get(name: string): string | null | undefined };

export const CLIENT_IP_HEADER = 'x-shotstash-client-ip';

export function trustProxy(): boolean {
  return process.env.TRUST_PROXY === 'true';
}

export function clientIp(headers: HeadersLike): string | undefined {
  if (trustProxy()) {
    const cf = headers.get('cf-connecting-ip')?.trim();
    if (cf) return cf;
    const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return headers.get(CLIENT_IP_HEADER)?.trim() || undefined;
}

/**
 * `https` or `http`: `x-forwarded-proto` only behind a trusted proxy, else the
 * request URL. `server.ts` passes an absolute `http://` URL for plain Node
 * requests, since the custom server itself never terminates TLS.
 */
export function requestScheme(req: { url: string; headers: HeadersLike }): 'https' | 'http' {
  if (trustProxy()) {
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    if (proto === 'https' || proto === 'http') return proto;
  }
  try {
    return new URL(req.url).protocol === 'https:' ? 'https' : 'http';
  } catch {
    return 'http';
  }
}

/** Scheme of a configured public URL (`APP_URL`, else `NEXT_PUBLIC_APP_URL`), or null when unset or invalid. */
export function configuredScheme(env: Record<string, string | undefined> = process.env): 'https' | 'http' | null {
  const raw = env.APP_URL || env.NEXT_PUBLIC_APP_URL;
  if (!raw) return null;
  try {
    const p = new URL(raw).protocol;
    return p === 'https:' ? 'https' : p === 'http:' ? 'http' : null;
  } catch {
    return null;
  }
}
