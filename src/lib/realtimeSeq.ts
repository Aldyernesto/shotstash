/**
 * Story 5.5: ordered realtime on the client. Every event carries the `seq`
 * of its entity (a per-row counter for jobs, a per-Project counter for chat
 * messages); events can still arrive late or twice (reconnects, two app
 * processes), so a client keeps the highest `seq` it has seen per entity
 * and drops anything lower or equal.
 *
 * Pure and alias-free: the browser, the server and `node --test` import it.
 */

export type SeqGate = {
  /** True when `seq` is newer than everything seen for `key`; it is then remembered. */
  accept(key: string, seq: number): boolean;
  /** Highest seq seen for `key`, or null. */
  seen(key: string): number | null;
  /** Records a seq that came from somewhere else (a query result) without an event. */
  note(key: string, seq: number): void;
  clear(): void;
};

/** A gate that remembers at most `limit` entities (oldest forgotten first). */
export function createSeqGate(limit = 5000): SeqGate {
  const map = new Map<string, number>();
  const remember = (key: string, seq: number) => {
    map.delete(key);
    map.set(key, seq);
    if (map.size > limit) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  };
  return {
    accept(key, seq) {
      if (!Number.isFinite(seq)) return false;
      const prev = map.get(key);
      if (prev !== undefined && seq <= prev) return false;
      remember(key, seq);
      return true;
    },
    seen(key) {
      return map.get(key) ?? null;
    },
    note(key, seq) {
      if (!Number.isFinite(seq)) return;
      const prev = map.get(key);
      if (prev === undefined || seq > prev) remember(key, seq);
    },
    clear() {
      map.clear();
    },
  };
}

type Orderable = { id: string; createdAt: string | number | Date };

/** Milliseconds of a createdAt; an unparseable value counts as 0 (never NaN). */
function timeOf(v: Orderable['createdAt']): number {
  let t: number;
  if (v instanceof Date) t = v.getTime();
  else if (typeof v === 'number') t = v;
  else if (/^\d+$/.test(v)) t = Number(v);
  else t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

/** History order of chat messages: (createdAt, id), the same order the server reads. */
export function compareChat(a: Orderable, b: Orderable): number {
  const ta = timeOf(a.createdAt);
  const tb = timeOf(b.createdAt);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Adds `item` to an ordered list (replacing the same id) and keeps (createdAt, id) order. */
export function insertOrdered<T extends Orderable>(list: readonly T[], item: T): T[] {
  const rest = list.filter((x) => x.id !== item.id);
  rest.push(item);
  return rest.sort(compareChat);
}
