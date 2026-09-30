/**
 * Local disk backend: any directory, including a NAS mount
 * (`STORAGE_LOCAL_ROOT`). Keys map to paths under the root; nothing outside
 * the root is ever read, written or deleted.
 *
 *   <root>/<key>                  stored objects
 *   <root>/.parts/<uploadId>/     staged upload parts (plus meta.json)
 *   <root>/.tmp/                  atomic writes (temp file, then rename)
 *   <root>/.shotstash-storage     marker: this is the storage root (an
 *                                 unmounted NAS mountpoint lacks it)
 *
 * Raw file system errors never leave this file: they become StorageError
 * (NOT_FOUND for a missing file, UNAVAILABLE otherwise).
 *
 * Alias-free: `node --test` runs the backend contract against a temp dir.
 */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createReadStream, createWriteStream, constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StorageError } from './errors.ts';
import { assertSafeKey } from './keys.ts';
import { MeterStream } from './meter.ts';
import type { ByteRange, Capacity, ObjectStat, ProbeResult, StorageBackend, StoredPart } from './types.ts';

const UPLOAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Written at setup (and by the first successful write probe) into the storage root. */
export const STORAGE_MARKER = '.shotstash-storage';

/** True when `target` is `root` or lies inside it (guards every recursive delete). */
export function isInsideRoot(target: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isNotFound(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** A raw fs error as a StorageError (StorageErrors pass through). */
function wrapFs(err: unknown, what: string): StorageError {
  if (err instanceof StorageError) return err;
  const code = (err as NodeJS.ErrnoException)?.code;
  if (isNotFound(err)) return new StorageError('NOT_FOUND', `${what}: not found`, { cause: err });
  return new StorageError('UNAVAILABLE', `${what} failed${code ? ` (${code})` : ''}`, { cause: err });
}

export class LocalDiskBackend implements StorageBackend {
  readonly name = 'local' as const;
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /* ---------------- paths ---------------- */

  private pathOf(key: string): string {
    assertSafeKey(key);
    const p = path.join(this.root, ...key.split('/'));
    if (!isInsideRoot(p, this.root) || p === this.root) throw new StorageError('INVALID_KEY', 'Key escapes the storage root');
    return p;
  }

  private partsDir(uploadId: string): string {
    if (!UPLOAD_ID_RE.test(uploadId)) throw new StorageError('INVALID_UPLOAD', 'Malformed upload id');
    return path.join(this.root, '.parts', uploadId);
  }

  private partPath(uploadId: string, partNumber: number): string {
    return path.join(this.partsDir(uploadId), `part-${String(partNumber).padStart(5, '0')}`);
  }

  private async tmpPath(): Promise<string> {
    const dir = path.join(this.root, '.tmp');
    await fs.mkdir(dir, { recursive: true });
    return path.join(dir, `${Date.now()}-${randomBytes(8).toString('hex')}`);
  }

  private async uploadKey(uploadId: string): Promise<string> {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(this.partsDir(uploadId), 'meta.json'), 'utf8')) as { key?: string };
      return assertSafeKey(String(meta.key ?? ''));
    } catch (err) {
      if (err instanceof StorageError && err.code !== 'INVALID_KEY') throw err;
      throw new StorageError('INVALID_UPLOAD', 'Unknown upload id');
    }
  }

  /** Removes now-empty directories between `dir` and the root (never the root itself). */
  private async pruneEmpty(dir: string) {
    let cur = dir;
    while (isInsideRoot(cur, this.root) && path.resolve(cur) !== this.root) {
      try {
        await fs.rmdir(cur);
      } catch {
        return;
      }
      cur = path.dirname(cur);
    }
  }

  /**
   * Renames `from` into place at `target`, creating the target directory. A
   * concurrent pruneEmpty may remove that directory in between: on ENOENT
   * the directory is created again and the rename retried once.
   */
  private async renameInto(from: string, target: string) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.rename(from, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(from, target);
    }
  }

  /* ---------------- multipart ---------------- */

  async beginUpload(key: string): Promise<string> {
    assertSafeKey(key);
    const uploadId = randomUUID();
    const dir = this.partsDir(uploadId);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ key, createdAt: new Date().toISOString() }));
    } catch (err) {
      throw wrapFs(err, 'beginUpload');
    }
    return uploadId;
  }

  async putPart(uploadId: string, partNumber: number, body: Readable, size: number, opts: { md5?: string } = {}): Promise<StoredPart> {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new StorageError('INVALID_UPLOAD', 'Part number out of range');
    }
    await this.uploadKey(uploadId);
    const final = this.partPath(uploadId, partNumber);
    const tmp = `${final}.${randomBytes(6).toString('hex')}.tmp`;
    const meter = new MeterStream(size);
    try {
      await pipeline(body, meter, createWriteStream(tmp));
      if (meter.bytes !== size) {
        throw new StorageError('PART_SIZE_MISMATCH', `Part has ${meter.bytes} bytes, expected ${size}`);
      }
      const md5 = meter.md5();
      if (opts.md5 && opts.md5.toLowerCase() !== md5) throw new StorageError('CHECKSUM_MISMATCH', 'Part MD5 mismatch');
      await fs.rename(tmp, final);
      return { partNumber, etag: md5, size };
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      // A client that went away mid-body keeps its own error (the service maps it).
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ERR_STREAM_PREMATURE_CLOSE' || (err as Error)?.name === 'AbortError') throw err;
      throw wrapFs(err, 'putPart');
    }
  }

  async completeUpload(uploadId: string, parts: StoredPart[]): Promise<{ size: number; md5: string }> {
    const key = await this.uploadKey(uploadId);
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    for (const p of ordered) {
      let s;
      try {
        s = await fs.stat(this.partPath(uploadId, p.partNumber));
      } catch {
        throw new StorageError('NOT_FOUND', `Part ${p.partNumber} is missing`);
      }
      if (s.size !== p.size) throw new StorageError('PART_SIZE_MISMATCH', `Part ${p.partNumber} has ${s.size} bytes`);
    }
    const target = this.pathOf(key);
    let tmp: string | null = null;
    const hash = createHash('md5');
    let size = 0;
    try {
      tmp = await this.tmpPath();
      // One pipeline over every part in order: a write error (ENOSPC, EIO)
      // rejects it instead of crashing the process or hanging on drain.
      const partPaths = ordered.map((p) => this.partPath(uploadId, p.partNumber));
      async function* concat() {
        for (const p of partPaths) {
          for await (const chunk of createReadStream(p)) yield chunk as Buffer;
        }
      }
      const tap = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk);
          size += chunk.length;
          cb(null, chunk);
        },
      });
      await pipeline(concat, tap, createWriteStream(tmp));
      await this.renameInto(tmp, target);
    } catch (err) {
      if (tmp) await fs.unlink(tmp).catch(() => {});
      throw wrapFs(err, 'completeUpload');
    }
    await fs.rm(this.partsDir(uploadId), { recursive: true, force: true }).catch(() => {});
    return { size, md5: hash.digest('hex') };
  }

  async abortUpload(uploadId: string): Promise<void> {
    let dir: string;
    try {
      dir = this.partsDir(uploadId);
    } catch {
      return;
    }
    if (isInsideRoot(dir, this.root)) await fs.rm(dir, { recursive: true, force: true }).catch((err) => {
      throw wrapFs(err, 'abortUpload');
    });
  }

  /* ---------------- objects ---------------- */

  async putStream(key: string, body: Readable): Promise<{ size: number }> {
    const target = this.pathOf(key);
    let tmp: string | null = null;
    const meter = new MeterStream();
    try {
      tmp = await this.tmpPath();
      await pipeline(body, meter, createWriteStream(tmp));
      await this.renameInto(tmp, target);
    } catch (err) {
      if (tmp) await fs.unlink(tmp).catch(() => {});
      throw wrapFs(err, 'putStream');
    }
    return { size: meter.bytes };
  }

  async getStream(key: string, range?: ByteRange): Promise<Readable> {
    const p = this.pathOf(key);
    const s = await this.stat(key);
    if (range && (range.start < 0 || range.end < range.start || range.start >= s.size)) {
      throw new StorageError('INVALID_RANGE', 'Range outside the object');
    }
    return createReadStream(p, range ? { start: range.start, end: Math.min(range.end, s.size - 1) } : undefined);
  }

  async delete(key: string): Promise<void> {
    const p = this.pathOf(key);
    try {
      await fs.unlink(p);
    } catch (err) {
      if (!isNotFound(err)) throw wrapFs(err, 'delete');
    }
    await this.pruneEmpty(path.dirname(p));
  }

  async stat(key: string): Promise<ObjectStat> {
    try {
      const s = await fs.stat(this.pathOf(key));
      if (!s.isFile()) throw new StorageError('NOT_FOUND', 'Not a stored object');
      return { size: s.size, modifiedAt: s.mtime };
    } catch (err) {
      throw wrapFs(err, 'stat');
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.stat(key);
      return true;
    } catch (err) {
      if (err instanceof StorageError && err.code === 'NOT_FOUND') return false;
      throw err;
    }
  }

  /* ---------------- helpers ---------------- */

  async copy(from: string, to: string): Promise<void> {
    const src = this.pathOf(from);
    await this.stat(from);
    const target = this.pathOf(to);
    let tmp: string | null = null;
    try {
      tmp = await this.tmpPath();
      await fs.copyFile(src, tmp);
      await this.renameInto(tmp, target);
    } catch (err) {
      if (tmp) await fs.unlink(tmp).catch(() => {});
      throw wrapFs(err, 'copy');
    }
  }

  async move(from: string, to: string): Promise<void> {
    const src = this.pathOf(from);
    await this.stat(from);
    const target = this.pathOf(to);
    try {
      await this.renameInto(src, target);
    } catch (err) {
      throw wrapFs(err, 'move');
    }
    await this.pruneEmpty(path.dirname(src));
  }

  private async hasMarker(): Promise<boolean> {
    return fs
      .stat(path.join(this.root, STORAGE_MARKER))
      .then((s) => s.isFile())
      .catch(() => false);
  }

  /**
   * `read` never creates anything: the root must exist, be readable and
   * writable, and carry the marker, so an unmounted NAS mountpoint (an empty
   * directory) reports unreachable. An install from before the marker (it
   * already holds `files/`) gets the marker now. With `init` (first-run
   * setup not done yet) a missing marker runs the write probe, which writes it.
   * `write` writes, reads back and deletes a probe file, then writes the marker.
   */
  async probe(mode: 'read' | 'write', opts: { init?: boolean } = {}): Promise<ProbeResult> {
    if (mode === 'read') {
      try {
        await fs.access(this.root, fsConstants.R_OK | fsConstants.W_OK);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        return { ok: false, reason: code ? `Storage root is not accessible (${code}).` : 'Storage root is not accessible.' };
      }
      if (await this.hasMarker()) return { ok: true };
      const legacy = await fs
        .stat(this.pathOf('files'))
        .then((s) => s.isDirectory())
        .catch(() => false);
      if (legacy) {
        await fs.writeFile(path.join(this.root, STORAGE_MARKER), `${new Date().toISOString()}\n`).catch(() => {});
        return { ok: true };
      }
      if (opts.init) return this.probe('write');
      return { ok: false, reason: `Storage root has no ${STORAGE_MARKER} marker: is the disk or NAS mounted?` };
    }
    const probe = path.join(this.root, `.shotstash-probe-${randomBytes(8).toString('hex')}`);
    const payload = randomBytes(16).toString('hex');
    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.writeFile(probe, payload, { flag: 'wx' });
      const back = await fs.readFile(probe, 'utf8');
      if (back !== payload) return { ok: false, reason: 'Storage returned different bytes than were written.' };
      if (!(await this.hasMarker())) await fs.writeFile(path.join(this.root, STORAGE_MARKER), `${new Date().toISOString()}\n`);
      return { ok: true };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      return { ok: false, reason: code ? `Storage is not writable (${code}).` : 'Storage is not writable.' };
    } finally {
      await fs.unlink(probe).catch(() => {});
    }
  }

  async withLocalInput<T>(key: string, fn: (input: string) => Promise<T>): Promise<T> {
    await this.stat(key);
    return fn(this.pathOf(key));
  }

  async capacity(): Promise<Capacity | null> {
    try {
      const s = await fs.statfs(this.root);
      return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
    } catch {
      return null;
    }
  }

  /** Removes `.tmp/` files and `.parts/<uploadId>/` directories older than `before` that `live` does not name. */
  async sweepStaging(before: Date, live: Set<string>): Promise<number> {
    let removed = 0;
    const cutoff = before.getTime();
    const tmpDir = path.join(this.root, '.tmp');
    for (const name of await fs.readdir(tmpDir).catch(() => [] as string[])) {
      const p = path.join(tmpDir, name);
      const s = await fs.stat(p).catch(() => null);
      if (s?.isFile() && s.mtimeMs < cutoff) {
        await fs.unlink(p).catch(() => {});
        removed++;
      }
    }
    const partsDir = path.join(this.root, '.parts');
    for (const name of await fs.readdir(partsDir).catch(() => [] as string[])) {
      if (!UPLOAD_ID_RE.test(name) || live.has(name)) continue;
      const p = path.join(partsDir, name);
      const s = await fs.stat(p).catch(() => null);
      if (s?.isDirectory() && s.mtimeMs < cutoff) {
        await fs.rm(p, { recursive: true, force: true }).catch(() => {});
        removed++;
      }
    }
    return removed;
  }
}
