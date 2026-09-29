/**
 * Streamed ZIP archives (Story 4.6) on `yazl`.
 *
 *   - STORE mode: media is already compressed, so entries are stored as is
 *     (`compress: false`), which keeps the CPU idle and the size exact.
 *   - Every entry is declared with the size its object had at plan time;
 *     yazl picks ZIP64 per entry from that size (entries above 4 GiB) and
 *     fails the archive when the stream delivers a different byte count.
 *   - Objects are checked (exists and size) while planning, with bounded
 *     concurrency; objects that cannot be read are listed in
 *     `_MISSING_FILES.txt` instead of failing the whole download.
 *   - Objects are opened one at a time, when the archive reaches them, and
 *     pulled only as fast as the client reads. Nothing touches the disk.
 *   - A read that fails mid-entry destroys the output stream: the client
 *     sees a failed download (no end record), never a silently short ZIP.
 *
 * Kept free of path aliases so `node --test` can import it directly; the
 * storage backend is passed in as a small source interface.
 */
import { PassThrough, type Readable } from 'stream';
import { ZipFile } from 'yazl';

export type ZipEntry = { key: string; name: string };

/** What the ZIP needs from storage. */
export type ZipSource = {
  stat(key: string): Promise<{ size: number }>;
  getStream(key: string): Promise<Readable>;
};

export type PlannedEntry = ZipEntry & { size: number };

export type ZipPlanResult = {
  present: PlannedEntry[];
  /** Names of entries whose object could not be found or read. */
  missing: string[];
};

export const MISSING_FILES_NAME = '_MISSING_FILES.txt';
/** Objects checked at the same time while planning. */
export const ZIP_PLAN_CONCURRENCY = 8;

/** Checks every entry (exists and size), at most `concurrency` at once, keeping the input order. */
export async function planZipEntries(
  entries: ZipEntry[],
  source: Pick<ZipSource, 'stat'>,
  concurrency = ZIP_PLAN_CONCURRENCY,
): Promise<ZipPlanResult> {
  const sizes: (number | null)[] = new Array(entries.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      try {
        const { size } = await source.stat(entries[i].key);
        sizes[i] = Number.isSafeInteger(size) && size >= 0 ? size : null;
      } catch {
        sizes[i] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, entries.length)) }, worker));
  const present: PlannedEntry[] = [];
  const missing: string[] = [];
  entries.forEach((e, i) => {
    const size = sizes[i];
    if (size === null) missing.push(e.name);
    else present.push({ ...e, size });
  });
  return { present, missing };
}

export function missingFilesText(missing: string[]): string {
  return `These files were skipped because they could not be read from storage:\n\n${missing.map((s) => `  - ${s}`).join('\n')}\n`;
}

export type BuildZipInput = {
  present: PlannedEntry[];
  missing: string[];
  emptyDirs?: string[];
  source: Pick<ZipSource, 'getStream'>;
  /** Called once when the archive fails (the stream is destroyed right after). */
  onError?: (err: Error) => void;
  /** Entry timestamp; defaults to now. */
  mtime?: Date;
};

/**
 * Builds the archive and answers its byte stream. The stream errors (and
 * is destroyed) when any entry cannot be read to the end with its declared
 * size.
 */
export function buildZipStream(input: BuildZipInput): Readable {
  const zip = new ZipFile();
  // yazl's output is a PassThrough (typed as the generic stream interface).
  const zipOut = zip.outputStream as PassThrough;
  const out = new PassThrough();
  const mtime = input.mtime ?? new Date();
  let failed = false;
  let current: Readable | null = null;

  const fail = (err: unknown) => {
    if (failed) return;
    failed = true;
    const e = err instanceof Error ? err : new Error(String(err));
    input.onError?.(e);
    current?.destroy();
    zipOut.unpipe(out);
    zipOut.destroy();
    out.destroy(e);
  };
  zip.on('error', fail);

  for (const entry of input.present) {
    zip.addReadStreamLazy(entry.name, { size: entry.size, compress: false, mtime }, (cb) => {
      if (failed) return;
      input.source.getStream(entry.key).then(
        (stream) => {
          if (failed) {
            stream.destroy();
            return;
          }
          current = stream;
          // yazl pipes the stream without listening for its errors.
          stream.once('error', fail);
          cb(null, stream);
        },
        (err) => fail(err),
      );
    });
  }
  for (const dir of input.emptyDirs ?? []) zip.addEmptyDirectory(dir.endsWith('/') ? dir : `${dir}/`, { mtime });
  if (input.missing.length) {
    zip.addBuffer(Buffer.from(missingFilesText(input.missing)), MISSING_FILES_NAME, { compress: false, mtime });
  }
  zip.end();

  zipOut.pipe(out);
  // A client that goes away stops reading the objects too.
  out.once('close', () => {
    if (zipOut.readableEnded) return;
    failed = true;
    current?.destroy();
    zipOut.destroy();
  });
  return out;
}

/** Plans and builds in one call. */
export async function zipStream(
  entries: ZipEntry[],
  source: ZipSource,
  opts: { emptyDirs?: string[]; onError?: (err: Error) => void; concurrency?: number } = {},
): Promise<Readable> {
  const plan = await planZipEntries(entries, source, opts.concurrency);
  return buildZipStream({ ...plan, emptyDirs: opts.emptyDirs, source, onError: opts.onError });
}
