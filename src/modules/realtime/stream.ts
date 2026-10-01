/**
 * Authorised subscription streams (Story 5.5).
 *
 * A subscription checks `can()` when it opens (resolvers, as before) and
 * again for EVERY event it may deliver:
 *
 *   1. `accepts()` drops events of other types or ids first (no database);
 *   2. `authorize()` re-reads the subscriber's session and account; a
 *      definite null (revoked session, deactivated account) ends the stream.
 *      A positive answer is reused for `authorizeCacheMs` (5 s by default);
 *   3. `deliver()` loads the entity the thin event names and decides, with
 *      that actor, whether this subscriber may see it.
 *
 * When step 2 or 3 throws (a transient database error) the event is skipped
 * and, when `resync()` is given, the subscriber receives its resync payload
 * instead, so the client refetches; the stream stays open. Without events
 * the subscriber is re-checked every `recheckMs`, so a stream also ends on
 * a quiet channel.
 *
 * Pure and alias-free: `node --test` imports it directly.
 */
import { fromWire, type RealtimeEvent } from './events.ts';

export type StreamOptions<A, T> = {
  /** Raw channel messages (graphql-redis-subscriptions iterator). */
  source: AsyncIterator<unknown>;
  /** Cheap filter on the thin event (type, id) applied before any database work. */
  accepts?: (event: RealtimeEvent) => boolean;
  /** The subscriber as it is now, or null when its session or account is gone (ends the stream). */
  authorize: () => Promise<A | null>;
  /** The payload for this subscriber, or null to skip the event (not allowed, gone, not relevant). */
  deliver: (event: RealtimeEvent, actor: A) => Promise<T | null>;
  /** Payload sent instead of an event that failed on a transient error (the client refetches). */
  resync?: (event: RealtimeEvent) => T | null;
  /** How long a positive `authorize()` answer is reused (ms). Default 5000. */
  authorizeCacheMs?: number;
  /** Re-check the subscriber this often without events; 0 or absent: only on events. */
  recheckMs?: number;
  /** Called once when the stream ends (any reason). */
  onEnd?: (reason: 'revoked' | 'closed' | 'source-ended') => void;
  /** Called when an event was skipped on an error (for logging). */
  onError?: (err: unknown, event: RealtimeEvent | null) => void;
  /** Clock (tests). */
  now?: () => number;
};

type Check<A> = { ok: true; actor: A } | { ok: false; definite: boolean; err?: unknown };

export function authorizedStream<A, T>(o: StreamOptions<A, T>): AsyncIterableIterator<T> {
  let done = false;
  let pending: Promise<IteratorResult<unknown>> | null = null;
  const now = o.now ?? Date.now;
  const cacheMs = o.authorizeCacheMs ?? 5000;
  let cached: { actor: A; at: number } | null = null;

  const finish = async (reason: 'revoked' | 'closed' | 'source-ended') => {
    if (done) return;
    done = true;
    try {
      await o.source.return?.();
    } catch {
      // the channel iterator is gone already
    }
    o.onEnd?.(reason);
  };

  const check = async (fresh: boolean): Promise<Check<A>> => {
    if (!fresh && cached && now() - cached.at < cacheMs) return { ok: true, actor: cached.actor };
    try {
      const actor = await o.authorize();
      if (!actor) {
        cached = null;
        return { ok: false, definite: true };
      }
      cached = { actor, at: now() };
      return { ok: true, actor };
    } catch (err) {
      return { ok: false, definite: false, err };
    }
  };

  const recheck = (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<'recheck'>((resolve) => {
      timer = setTimeout(() => resolve('recheck'), ms);
      (timer as { unref?: () => void }).unref?.();
    });
    return { promise, cancel: () => clearTimeout(timer) };
  };

  const iterator: AsyncIterableIterator<T> = {
    async next(): Promise<IteratorResult<T>> {
      while (!done) {
        pending ??= o.source.next();
        let winner: IteratorResult<unknown> | 'recheck';
        if (o.recheckMs && o.recheckMs > 0) {
          const timer = recheck(o.recheckMs);
          winner = await Promise.race([pending, timer.promise]);
          timer.cancel();
        } else {
          winner = await pending;
        }
        if (done) break;
        if (winner === 'recheck') {
          const c = await check(true);
          if (!c.ok && c.definite) await finish('revoked');
          continue;
        }
        pending = null;
        if (winner.done) {
          await finish('source-ended');
          break;
        }
        const event = fromWire(winner.value);
        if (!event) continue;
        if (o.accepts && !o.accepts(event)) continue;
        const c = await check(false);
        if (!c.ok) {
          if (c.definite) {
            await finish('revoked');
            break;
          }
          o.onError?.(c.err, event);
          const r = o.resync?.(event);
          if (r != null) return { value: r, done: false };
          continue;
        }
        let payload: T | null;
        try {
          payload = await o.deliver(event, c.actor);
        } catch (err) {
          o.onError?.(err, event);
          const r = o.resync?.(event);
          if (r != null) return { value: r, done: false };
          continue;
        }
        if (payload == null) continue;
        return { value: payload, done: false };
      }
      return { value: undefined, done: true };
    },
    async return(): Promise<IteratorResult<T>> {
      await finish('closed');
      return { value: undefined, done: true };
    },
    async throw(err?: unknown): Promise<IteratorResult<T>> {
      await finish('closed');
      throw err;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  return iterator;
}
