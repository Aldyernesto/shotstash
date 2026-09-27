/**
 * HTTP Range parsing for media bytes (single range, RFC 9110).
 *
 *   none           no header, a malformed header or a multi-range request:
 *                  serve the whole body with 200
 *   ok             serve bytes start..end (inclusive) with 206
 *   unsatisfiable  answer 416 with `Content-Range: bytes * / size`
 *
 * Pure: imported by `node --test` directly.
 */

export type RangeResult =
  | { kind: 'none' }
  | { kind: 'ok'; start: number; end: number }
  | { kind: 'unsatisfiable' };

export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return { kind: 'none' };
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return { kind: 'none' };
  const [, a, b] = m;
  if (a === '' && b === '') return { kind: 'none' };

  if (a === '') {
    // Suffix range: the last N bytes.
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n === 0 || size === 0) return { kind: 'unsatisfiable' };
    const start = Math.max(0, size - n);
    return { kind: 'ok', start, end: size - 1 };
  }

  const start = Number(a);
  if (!Number.isSafeInteger(start) || start >= size) return { kind: 'unsatisfiable' };
  let end = b === '' ? size - 1 : Number(b);
  if (!Number.isSafeInteger(end)) return { kind: 'unsatisfiable' };
  if (end < start) return { kind: 'unsatisfiable' };
  if (end >= size) end = size - 1;
  return { kind: 'ok', start, end };
}
