/**
 * Realtime events (Story 5.5).
 *
 * Every event is thin, `{ type, id, seq }`, and never carries entity data:
 * a subscriber loads the entity itself and checks `can()` for its own actor
 * before anything reaches a client. Events go to Dragonfly channels:
 *
 *   project:<id>  chat messages and job changes of files in the Project
 *   job:<id>      one job
 *   user:<id>     notifications and upload progress of one account
 *
 * Events are published only after the write that caused them committed
 * (`afterCommit`), so a rolled-back write never announces anything.
 *
 * Pure and alias-free: `node --test` imports it directly.
 */

export const EVENT_TYPES = ['chat.created', 'job.updated', 'notification.created', 'upload.progress'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type RealtimeEvent = {
  type: EventType;
  /** Id of the entity (chat message, job, notification, upload session). */
  id: string;
  /** Per-entity order: higher is newer. Clients drop lower or equal values. */
  seq: number;
};

/** An event and the channels it goes to. */
export type Outgoing = { channels: string[]; event: RealtimeEvent };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function channel(prefix: 'project' | 'job' | 'user', id: string): string {
  if (!ID_RE.test(id)) throw new Error(`invalid ${prefix} id for a realtime channel`);
  return `${prefix}:${id}`;
}

export const channels = {
  project: (id: string) => channel('project', id),
  job: (id: string) => channel('job', id),
  user: (id: string) => channel('user', id),
};

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

/** The event as it travels: exactly `{ type, id, seq }`, nothing else. */
export function toWire(event: RealtimeEvent): RealtimeEvent {
  return { type: event.type, id: String(event.id), seq: Number(event.seq) };
}

/** Reads an event from a channel message (an object or JSON); null when it is not one. */
export function fromWire(value: unknown): RealtimeEvent | null {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isEventType(o.type) || typeof o.id !== 'string' || !o.id) return null;
  const seq = typeof o.seq === 'number' ? o.seq : Number(o.seq);
  if (!Number.isFinite(seq)) return null;
  return { type: o.type, id: o.id, seq };
}

export type PublishFn = (channel: string, event: RealtimeEvent) => Promise<unknown> | unknown;

/** Sends every outgoing event on each of its channels; failures are reported, never thrown. */
export async function publishAll(publish: PublishFn, items: Outgoing[], onError?: (err: unknown) => void): Promise<void> {
  for (const item of items) {
    const wire = toWire(item.event);
    for (const ch of item.channels) {
      try {
        await publish(ch, wire);
      } catch (err) {
        onError?.(err);
      }
    }
  }
}

type Events<T> = (result: T) => Outgoing | Outgoing[] | null | undefined | Promise<Outgoing | Outgoing[] | null | undefined>;

/**
 * Runs `write` (a committed write: an awaited statement or a whole
 * `$transaction`) and only when it resolved publishes the events built from
 * its result. A write that throws (a rolled-back transaction) publishes
 * nothing and rethrows.
 */
export async function afterCommitWith<T>(
  publish: PublishFn,
  write: Promise<T> | (() => Promise<T>),
  events: Events<T>,
  onError?: (err: unknown) => void,
): Promise<T> {
  const result = await (typeof write === 'function' ? write() : write);
  try {
    const built = await events(result);
    const list = built ? (Array.isArray(built) ? built : [built]) : [];
    await publishAll(publish, list, onError);
  } catch (err) {
    onError?.(err);
  }
  return result;
}
