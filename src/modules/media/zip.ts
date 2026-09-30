/**
 * Streamed ZIP archives (Story 4.6) on `yazl`.
 *
 *   - STORE mode: media is already compressed, so entries are stored as is
 *     (`compress: false`), which keeps the CPU idle and the size exact.
 *   - The response starts at once. Each entry is checked (exists and size)
 *     just before it is added, while the previous one streams; yazl picks
 *     ZIP64 per entry from the declared size (above 4 GiB) and fails the
 *     archive when the stream delivers a different byte count.
 *   - Objects that cannot be found are listed in `_MISSING_FILES.txt` at the
 *     end instead of failing the whole download.
 *   - Objects are opened one at a time and pulled only as fast as the client
 *     reads. Nothing touches the disk.
 *   - A read that fails mid-entry destroys the output stream: the client
 *     sees a failed download (no end record), never a silently short ZIP.
 *
 * Kept free of path aliases so `node --test` can import it directly; the
 * storage backend is passed in as a small source interface.
 */
import { PassThrough, type Readable } from 'stream';
import { ZipFile } from 'yazl';

/** One archive entry; `mtime` is the file's creation time (defaults to now). */
export type ZipEntry = { key: string; name: string; mtime?: Date };

/** What the ZIP needs from storage. */
export type ZipSource = {
  stat(key: string): Promise<{ size: number }>;
  getStream(key: string): Promise<Readable>;
};

export const MISSING_FILES_NAME = '_MISSING_FILES.txt';

export function missingFilesText(missing: string[]): string {
  return `These files were skipped because they could not be read from storage:\n\n${missing.map((s) => `  - ${s}`).join('\n')}\n`;
}

async function sizeOf(source: Pick<ZipSource, 'stat'>, key: string): Promise<number | null> {
  try {
    const { size } = await source.stat(key);
    return Number.isSafeInteger(size) && size >= 0 ? size : null;
  } catch {
    return null;
  }
}

/**
 * Answers the archive's byte stream at once and fills it entry by entry.
 * The stream errors (and is destroyed) when any entry cannot be read to
 * the end with its declared size.
 */
export function zipStream(
  entries: ZipEntry[],
  source: ZipSource,
  opts: { emptyDirs?: string[]; onError?: (err: Error) => void; now?: Date } = {},
): Readable {
  const zip = new ZipFile();
  // yazl's output is a PassThrough (typed as the generic stream interface).
  const zipOut = zip.outputStream as PassThrough;
  const out = new PassThrough();
  const now = opts.now ?? new Date();
  let failed = false;
  let current: Readable | null = null;

  const fail = (err: unknown) => {
    if (failed) return;
    failed = true;
    const e = err instanceof Error ? err : new Error(String(err));
    opts.onError?.(e);
    current?.destroy();
    zipOut.unpipe(out);
    zipOut.destroy();
    out.destroy(e);
  };
  zip.on('error', fail);

  const missing: string[] = [];
  const fill = async () => {
    for (const entry of entries) {
      if (failed) return;
      const size = await sizeOf(source, entry.key);
      if (failed) return;
      if (size === null) {
        missing.push(entry.name);
        continue;
      }
      // Resolves when yazl starts this entry: the next one is checked then,
      // so a stat is never older than the entry before it.
      await new Promise<void>((started) => {
        zip.addReadStreamLazy(entry.name, { size, compress: false, mtime: entry.mtime ?? now }, (cb) => {
          started();
          if (failed) return;
          source.getStream(entry.key).then(
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
      });
    }
    if (failed) return;
    for (const dir of opts.emptyDirs ?? []) zip.addEmptyDirectory(dir.endsWith('/') ? dir : `${dir}/`, { mtime: now });
    if (missing.length) {
      zip.addBuffer(Buffer.from(missingFilesText(missing)), MISSING_FILES_NAME, { compress: false, mtime: now });
    }
    zip.end();
  };
  fill().catch(fail);

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
