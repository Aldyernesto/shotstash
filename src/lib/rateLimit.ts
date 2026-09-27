/**
 * Minimal fixed-window rate limiter (Stories 2.2 / 2.3). Story 2.7 turns it
 * into the central sliding-window throttle.
 *
 * Counts live in Dragonfly when it is connected, otherwise in process
 * memory (single instance, dev). A Dragonfly error never blocks a request:
 * it falls back to memory.
 */


export type RateLimitResult = { ok: boolean; remaining: number; retryAfter: number };

export const LIMITS = {
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  shareUnlock: { limit: 5, windowMs: 15 * 60 * 1000 },
  shareUnlockPerSlug: { limit: 20, windowMs: 60 * 60 * 1000 },
} as const;

/**
 * Login throttle shared by REST and GraphQL login, Google sign-in and
 * registration: 10 per 15 min per IP, plus 10 per 15 min per normalized
 * email for password login. Returns the retry delay (seconds) when limited.
 */
export async function loginLimit(ip: string | undefined, email?: string | null): Promise<number | null> {
  const w = LIMITS.login;
  const byIp = await rateLimit(`login:${ip ?? 'unknown'}`, w.limit, w.windowMs);
  if (!byIp.ok) return byIp.retryAfter;
  if (email) {
    const byEmail = await rateLimit(`login-email:${email.trim().toLowerCase()}`, w.limit, w.windowMs);
    if (!byEmail.ok) return byEmail.retryAfter;
  }
  return null;
}

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryHit(key: string, windowMs: number, now: number): { count: number; resetAt: number } {
  const cur = memory.get(key);
  if (!cur || cur.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    memory.set(key, fresh);
    if (memory.size > 10_000) {
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    }
    return fresh;
  }
  cur.count += 1;
  return cur;
}

async function dragonflyHit(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number } | null> {
  try {
    const { dfClient } = await import('@/lib/dragonfly');
    if (dfClient.status !== 'ready') return null;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const k = `rl:${key}:${windowStart}`;
    const count = await Promise.race([
      dfClient.incr(k),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 500)),
    ]);
    if (count === 1) await dfClient.pexpire(k, windowMs).catch(() => {});
    return { count, resetAt: windowStart + windowMs };
  } catch {
    return null;
  }
}

/** Counts one attempt for `key` and says whether it is within `limit` per `windowMs`. */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = Date.now();
  const hit = (await dragonflyHit(key, windowMs, now)) ?? memoryHit(key, windowMs, now);
  const retryAfter = Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
  return { ok: hit.count <= limit, remaining: Math.max(0, limit - hit.count), retryAfter };
}

export function rateLimitedResponse(retryAfter: number) {
  return Response.json(
    { code: 'RATE_LIMITED', message: 'Too many attempts', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}
