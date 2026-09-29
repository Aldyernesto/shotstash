/**
 * The only throttle in the app (Story 2.7): a sliding window per key.
 *
 * Each allowed attempt is recorded with its timestamp; an attempt is allowed
 * while fewer than `limit` attempts fall inside the last `windowMs`. Refused
 * attempts are not recorded, so a client that keeps hammering is let back in
 * as soon as its oldest counted attempt leaves the window.
 *
 * Storage: a Dragonfly sorted set per key, checked and updated by ONE Lua
 * script (remove expired, count, add only when under the limit), so
 * concurrent callers never both pass or both fail on the same slot. Without
 * Dragonfly, or on any Dragonfly error, the attempt is counted in process
 * memory instead (never in both places).
 *
 * Pure apart from the lazily loaded Dragonfly client, so `node --test` can
 * exercise both paths (a fake store stands in for Dragonfly).
 */

import { randomBytes } from 'crypto';

export type RateLimitResult = { ok: boolean; remaining: number; retryAfter: number };

export type Limit = { limit: number; windowMs: number };

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const LIMITS = {
  /** Login (REST, GraphQL, Google, public registration): per IP and per email. */
  login: { limit: 10, windowMs: 15 * MIN },
  /** Password reset requests: per email and per IP. */
  passwordReset: { limit: 5, windowMs: HOUR },
  /** Share access-code attempts per IP. */
  shareUnlock: { limit: 5, windowMs: 15 * MIN },
  /** Share access-code attempts per link (distributed guessing). */
  shareUnlockPerSlug: { limit: 20, windowMs: HOUR },
  /** Share-link creation per user. */
  shareCreate: { limit: 60, windowMs: HOUR },
  /** First-run setup submissions per IP. */
  setup: { limit: 10, windowMs: 15 * MIN },
  /** Worker endpoints per token (Epic 5 wires the routes). */
  worker: { limit: 600, windowMs: MIN },
} as const satisfies Record<string, Limit>;

/* ------------------------------------------------------------------ */
/* Memory store                                                        */
/* ------------------------------------------------------------------ */

type MemoryEntry = { hits: number[]; windowMs: number };

const memory = new Map<string, MemoryEntry>();
let lastSweep = 0;
const SWEEP_EVERY_MS = 60 * 1000;

/** Drops keys whose newest hit is older than their own window; at most once a minute. */
function sweepMemory(now: number) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [k, e] of memory) {
    if (!e.hits.length || e.hits[e.hits.length - 1] <= now - e.windowMs) memory.delete(k);
  }
}

/** Sliding-window check in process memory. Exported for tests. */
export function memoryHit(key: string, limit: number, windowMs: number, now: number): RateLimitResult {
  sweepMemory(now);
  const since = now - windowMs;
  const hits = (memory.get(key)?.hits ?? []).filter((t) => t > since);
  if (hits.length >= limit) {
    memory.set(key, { hits, windowMs });
    // Enough of the oldest hits must leave the window to get back under the limit.
    const releaseAt = hits[hits.length - limit] + windowMs;
    return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((releaseAt - now) / 1000)) };
  }
  hits.push(now);
  memory.set(key, { hits, windowMs });
  return { ok: true, remaining: Math.max(0, limit - hits.length), retryAfter: 0 };
}

/** Test helper: forget every memory counter. */
export function resetMemoryLimits() {
  memory.clear();
  lastSweep = 0;
}

/** Test helper: number of keys held in memory. */
export function memoryKeyCount(): number {
  return memory.size;
}

/* ------------------------------------------------------------------ */
/* Dragonfly store                                                     */
/* ------------------------------------------------------------------ */

/**
 * KEYS[1] key; ARGV now, windowMs, limit, member.
 * Returns { allowed (1|0), count after the call, score of the hit that must
 * expire before the next attempt fits (0 when allowed) }.
 */
export const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, ARGV[4])
  redis.call('PEXPIRE', key, window)
  return {1, count + 1, 0}
end
local idx = count - limit
local oldest = redis.call('ZRANGE', key, idx, idx, 'WITHSCORES')
return {0, count, tonumber(oldest[2] or now)}
`;

/** The one Dragonfly command the limiter needs (ioredis `eval`). */
export type LimitStore = {
  status: string;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
};

type Loader = () => Promise<LimitStore | null>;

const defaultLoader: Loader = async () => {
  const { dfClient } = await import('@/lib/dragonfly');
  return dfClient() as unknown as LimitStore;
};

let loader: Loader | null = defaultLoader;

/** Test hook: `null` forces the memory store; a function supplies a (fake) store. */
export function setRateLimitStore(next: Loader | null) {
  loader = next;
}

function withTimeout<T>(p: Promise<T>, ms = 500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Null means "use memory": no store, not ready, or any error (including a malformed reply). */
async function storeHit(key: string, limit: number, windowMs: number, now: number): Promise<RateLimitResult | null> {
  if (!loader) return null;
  try {
    const store = await loader();
    if (!store || store.status !== 'ready') return null;
    const member = `${now}-${randomBytes(6).toString('hex')}`;
    const reply = await withTimeout(store.eval(SLIDING_WINDOW_LUA, 1, `rl:${key}`, now, windowMs, limit, member));
    if (!Array.isArray(reply) || reply.length < 3) return null;
    const [allowed, count, oldest] = reply.map(Number);
    if (![allowed, count, oldest].every(Number.isFinite)) return null;
    if (allowed === 1) return { ok: true, remaining: Math.max(0, limit - count), retryAfter: 0 };
    return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/** Counts one attempt for `key` and says whether it is within `limit` per `windowMs`. */
export async function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
  return (await storeHit(key, limit, windowMs, now)) ?? memoryHit(key, limit, windowMs, now);
}

/** `rateLimit` with a named limit from `LIMITS`. */
export function limitBy(name: keyof typeof LIMITS, subject: string, now?: number): Promise<RateLimitResult> {
  const l: Limit = LIMITS[name];
  return rateLimit(`${name}:${subject}`, l.limit, l.windowMs, now);
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Login throttle shared by REST and GraphQL login, Google sign-in and public
 * registration: 10 per 15 min per IP, plus per normalized email for password
 * login. Returns the retry delay (seconds) when limited, else null.
 */
export async function loginLimit(ip: string | undefined, email?: string | null): Promise<number | null> {
  const byIp = await limitBy('login', `ip:${ip ?? 'unknown'}`);
  if (!byIp.ok) return byIp.retryAfter;
  if (email) {
    const byEmail = await limitBy('login', `email:${normalizeEmail(email)}`);
    if (!byEmail.ok) return byEmail.retryAfter;
  }
  return null;
}

/** Password reset requests: 5 per hour per IP and per email. Retry delay or null. */
export async function passwordResetLimit(ip: string | undefined, email: string): Promise<number | null> {
  const byIp = await limitBy('passwordReset', `ip:${ip ?? 'unknown'}`);
  if (!byIp.ok) return byIp.retryAfter;
  const byEmail = await limitBy('passwordReset', `email:${normalizeEmail(email)}`);
  if (!byEmail.ok) return byEmail.retryAfter;
  return null;
}

/** `429 { code: 'RATE_LIMITED', retryAfter }` with a `Retry-After` header. */
export function rateLimitedResponse(retryAfter: number) {
  return Response.json(
    { code: 'RATE_LIMITED', message: 'Too many attempts', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}
