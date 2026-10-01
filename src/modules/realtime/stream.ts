/**
 * Authorised subscription streams (Story 5.5).
 *
 * A subscription checks `can()` when it opens (resolvers, as before) and
 * again for EVERY event: `authorize()` re-reads the subscriber's session and
 * account (a revoked session or a deactivated account ends the stream), then
 * `deliver()` loads the entity the thin event names and decides, with that
 * fresh actor, whether this subscriber may see it. Nothing from the channel
 * reaches the client unchecked. Without events the subscriber is re-checked
 * every `recheckMs`, so a stream also ends on a quiet channel.
 *
 * Pure and alias-free: `node --test` imports it directly.
 */
import { fromWire, type RealtimeEvent } from './events.ts';

export type StreamOptions<A, T> = {
  /** Raw channel messages (graphql-redis-subscriptions iterator). */
  source: AsyncIterator<unknown>;
  /** The subscriber as it is now, or null when its session or account is gone (ends the stream). */
  authorize: () => Promise<A | null>;
  /** The payload for this subscriber, or null to skip the event (not allowed, gone, not relevant). */
  deliver: (event: RealtimeEvent, actor: A) => Promise<T | null>;
  /** Re-check the subscriber this often without events; 0 or absent: only on events. */
  recheckMs?: number;
  /** Called once when the stream ends (any reason). */
  onEnd?: (reason: 'revoked' | 'closed' | 'source-ended') => void;
};

async function safely<V>(fn: () => Promise<V>, fallback: V): Promise<V> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export function authorizedStream<A, T>(o: StreamOptions<A, T>): AsyncIterableIterator<T> {
  let done = false;
  let pending: Promise<IteratorResult<unknown>> | null = null;

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
          if (!(await safely(o.authorize, null))) await finish('revoked');
          continue;
        }
        pending = null;
        if (winner.done) {
          await finish('source-ended');
          break;
        }
        const actor = await safely(o.authorize, null);
        if (!actor) {
          await finish('revoked');
          break;
        }
        const event = fromWire(winner.value);
        if (!event) continue;
        const payload = await safely(() => o.deliver(event, actor), null);
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
