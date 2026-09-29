/**
 * S3-compatible backend (AWS S3, Cloudflare R2, MinIO, RustFS, SeaweedFS).
 *
 * Upload parts map to S3 multipart uploads. Checksums: the client computes
 * and validates checksums only when an operation requires them
 * (`requestChecksumCalculation` / `responseChecksumValidation` =
 * `WHEN_REQUIRED`), which several S3-compatible servers need. No ACL is ever
 * set; the bucket stays private and the browser never receives an object
 * URL. `withLocalInput` hands ffmpeg a presigned GET URL valid for a few
 * minutes; it never leaves the server.
 *
 * Alias-free: `node --test` runs the backend contract against a real
 * S3-compatible server (`npm run test:s3`).
 */
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
  UploadPartCopyCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageError } from './errors.ts';
import { assertSafeKey } from './keys.ts';
import { MeterStream } from './meter.ts';
import type { ByteRange, Capacity, ObjectStat, ProbeResult, StorageBackend, StoredPart } from './types.ts';

export type S3Options = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/** Objects up to this size are copied with one CopyObject; larger ones part by part. */
const SINGLE_COPY_LIMIT = 5 * 1024 * 1024 * 1024;
const COPY_PART_SIZE = 512 * 1024 * 1024;
/** Streams up to this size go up in one PutObject; larger or unknown sizes use a managed multipart upload. */
const SINGLE_PUT_LIMIT = 64 * 1024 * 1024;
/** Presigned inputs live 1 h unless the caller asks for less (thumbnails use 300 s). */
const PRESIGN_TTL_SECONDS = 3600;

function status(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

function isMissing(err: unknown): boolean {
  if (status(err) === 404) return true;
  const name = (err as { name?: string })?.name;
  return name === 'NoSuchKey' || name === 'NotFound' || name === 'NoSuchUpload';
}

function wrap(err: unknown, what: string): never {
  if (err instanceof StorageError) throw err;
  if (isMissing(err)) throw new StorageError('NOT_FOUND', `${what}: not found`, { cause: err });
  const name = (err as { name?: string })?.name;
  if (name === 'BadDigest' || name === 'InvalidDigest') throw new StorageError('CHECKSUM_MISMATCH', `${what}: MD5 mismatch`, { cause: err });
  if (name === 'InvalidPart' || name === 'InvalidPartOrder' || name === 'EntityTooSmall') {
    throw new StorageError('INVALID_PART', `${what}: the part list was refused (${name})`, { cause: err });
  }
  const detail = err instanceof S3ServiceException ? err.name : err instanceof Error ? err.message : String(err);
  throw new StorageError('UNAVAILABLE', `${what} failed (${detail})`, { cause: err });
}

/** The opaque upload id carries the key and the S3 upload id: `<b64url key>.<b64url id>`. */
function encodeUpload(key: string, s3Id: string): string {
  return `${Buffer.from(key).toString('base64url')}.${Buffer.from(s3Id).toString('base64url')}`;
}

function decodeUpload(uploadId: string): { key: string; id: string } {
  const [k, i, extra] = String(uploadId).split('.');
  if (!k || !i || extra !== undefined) throw new StorageError('INVALID_UPLOAD', 'Malformed upload id');
  const key = Buffer.from(k, 'base64url').toString();
  const id = Buffer.from(i, 'base64url').toString();
  if (!id) throw new StorageError('INVALID_UPLOAD', 'Malformed upload id');
  return { key: assertSafeKey(key), id };
}

export class S3Backend implements StorageBackend {
  readonly name = 's3' as const;
  readonly client: S3Client;
  readonly bucket: string;

  constructor(opts: S3Options) {
    this.bucket = opts.bucket;
    this.client = new S3Client({
      endpoint: opts.endpoint || undefined,
      region: opts.region,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /* ---------------- multipart ---------------- */

  async beginUpload(key: string): Promise<string> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key }));
      if (!res.UploadId) throw new StorageError('UNAVAILABLE', 'No upload id returned');
      return encodeUpload(key, res.UploadId);
    } catch (err) {
      wrap(err, 'beginUpload');
    }
  }

  async putPart(uploadId: string, partNumber: number, body: Readable, size: number, opts: { md5?: string } = {}): Promise<StoredPart> {
    const { key, id } = decodeUpload(uploadId);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new StorageError('INVALID_UPLOAD', 'Part number out of range');
    }
    const meter = new MeterStream(size);
    body.on('error', (e) => meter.destroy(e));
    body.pipe(meter);
    // A body shorter than Content-Length would leave the request waiting
    // for bytes that never come: abort it as soon as the body ends short.
    const abort = new AbortController();
    meter.on('end', () => {
      if (meter.bytes !== size) abort.abort();
    });
    meter.on('error', () => abort.abort());
    let etag: string | undefined;
    try {
      const res = await this.client.send(
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: id,
          PartNumber: partNumber,
          Body: meter,
          ContentLength: size,
          ...(opts.md5 ? { ContentMD5: Buffer.from(opts.md5, 'hex').toString('base64') } : {}),
        }),
        { abortSignal: abort.signal },
      );
      etag = res.ETag;
    } catch (err) {
      meter.destroy();
      if (meter.bytes !== size) throw new StorageError('PART_SIZE_MISMATCH', `Part has ${meter.bytes} bytes, expected ${size}`);
      wrap(err, 'putPart');
    }
    if (meter.bytes !== size) throw new StorageError('PART_SIZE_MISMATCH', `Part has ${meter.bytes} bytes, expected ${size}`);
    // Servers that ignore Content-MD5 are checked here; the stored part is
    // replaced when the client sends it again.
    if (opts.md5 && opts.md5.toLowerCase() !== meter.md5()) throw new StorageError('CHECKSUM_MISMATCH', 'Part MD5 mismatch');
    if (!etag) throw new StorageError('UNAVAILABLE', 'No ETag returned for the part');
    return { partNumber, etag, size };
  }

  async completeUpload(uploadId: string, parts: StoredPart[]): Promise<{ size: number }> {
    const { key, id } = decodeUpload(uploadId);
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const size = ordered.reduce((n, p) => n + p.size, 0);
    try {
      if (size === 0) {
        // Some servers refuse a multipart upload made of one empty part.
        await this.abortUpload(uploadId);
        await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: Buffer.alloc(0), ContentLength: 0 }));
        return { size: 0 };
      }
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: id,
          MultipartUpload: { Parts: ordered.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        }),
      );
    } catch (err) {
      // An upload the server no longer knows cannot be completed: its parts must be sent again.
      if ((err as { name?: string })?.name === 'NoSuchUpload') {
        throw new StorageError('INVALID_PART', 'completeUpload: the upload is gone (NoSuchUpload)', { cause: err });
      }
      wrap(err, 'completeUpload');
    }
    return { size };
  }

  async abortUpload(uploadId: string): Promise<void> {
    let decoded;
    try {
      decoded = decodeUpload(uploadId);
    } catch {
      return;
    }
    try {
      await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: decoded.key, UploadId: decoded.id }));
    } catch (err) {
      if (!isMissing(err)) wrap(err, 'abortUpload');
    }
  }

  /* ---------------- objects ---------------- */

  async putStream(key: string, body: Readable, opts: { contentType?: string; size?: number } = {}): Promise<{ size: number }> {
    assertSafeKey(key);
    const meter = new MeterStream(opts.size ?? Number.POSITIVE_INFINITY);
    body.on('error', (e) => meter.destroy(e));
    body.pipe(meter);
    // Like putPart: a body shorter than the declared size aborts the request.
    const abort = new AbortController();
    meter.on('end', () => {
      if (opts.size !== undefined && meter.bytes !== opts.size) abort.abort();
    });
    meter.on('error', () => abort.abort());
    try {
      if (opts.size !== undefined && opts.size <= SINGLE_PUT_LIMIT) {
        await this.client.send(
          new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: meter, ContentLength: opts.size, ContentType: opts.contentType }),
          { abortSignal: abort.signal },
        );
      } else {
        await new Upload({
          client: this.client,
          params: { Bucket: this.bucket, Key: key, Body: meter, ContentType: opts.contentType },
          partSize: 16 * 1024 * 1024,
          queueSize: 2,
        }).done();
      }
    } catch (err) {
      meter.destroy();
      if (opts.size !== undefined && meter.bytes !== opts.size) {
        throw new StorageError('PART_SIZE_MISMATCH', `Body has ${meter.bytes} bytes, expected ${opts.size}`);
      }
      wrap(err, 'putStream');
    }
    if (opts.size !== undefined && meter.bytes !== opts.size) {
      throw new StorageError('PART_SIZE_MISMATCH', `Body has ${meter.bytes} bytes, expected ${opts.size}`);
    }
    return { size: meter.bytes };
  }

  async getStream(key: string, range?: ByteRange): Promise<Readable> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        }),
      );
      const body = res.Body;
      if (!body) throw new StorageError('NOT_FOUND', 'Empty object body');
      return body instanceof Readable ? body : Readable.fromWeb(body as never);
    } catch (err) {
      if (status(err) === 416) throw new StorageError('INVALID_RANGE', 'Range outside the object', { cause: err });
      wrap(err, 'getStream');
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      if (!isMissing(err)) wrap(err, 'delete');
    }
  }

  async stat(key: string): Promise<ObjectStat> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(res.ContentLength ?? 0), modifiedAt: res.LastModified ?? null };
    } catch (err) {
      wrap(err, 'stat');
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
    assertSafeKey(to);
    const { size } = await this.stat(from);
    const source = `${this.bucket}/${from.split('/').map(encodeURIComponent).join('/')}`;
    try {
      if (size <= SINGLE_COPY_LIMIT) {
        await this.client.send(new CopyObjectCommand({ Bucket: this.bucket, Key: to, CopySource: source }));
        return;
      }
      const created = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: to }));
      const uploadId = created.UploadId!;
      try {
        const parts: { PartNumber: number; ETag: string }[] = [];
        for (let start = 0, n = 1; start < size; start += COPY_PART_SIZE, n++) {
          const end = Math.min(start + COPY_PART_SIZE, size) - 1;
          const res = await this.client.send(
            new UploadPartCopyCommand({
              Bucket: this.bucket,
              Key: to,
              UploadId: uploadId,
              PartNumber: n,
              CopySource: source,
              CopySourceRange: `bytes=${start}-${end}`,
            }),
          );
          const etag = res.CopyPartResult?.ETag;
          if (!etag) throw new StorageError('UNAVAILABLE', `copy: no ETag for part ${n}`);
          parts.push({ PartNumber: n, ETag: etag });
        }
        await this.client.send(
          new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key: to, UploadId: uploadId, MultipartUpload: { Parts: parts } }),
        );
      } catch (err) {
        await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: to, UploadId: uploadId })).catch(() => {});
        throw err;
      }
    } catch (err) {
      wrap(err, 'copy');
    }
  }

  async move(from: string, to: string): Promise<void> {
    await this.copy(from, to);
    await this.delete(from);
  }

  async probe(mode: 'read' | 'write', _opts: { init?: boolean } = {}): Promise<ProbeResult> {
    void _opts;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), { abortSignal: AbortSignal.timeout(3000) });
    } catch (err) {
      const code = status(err);
      return { ok: false, reason: code ? `The bucket answered HTTP ${code}.` : 'The S3 endpoint is unreachable.' };
    }
    if (mode === 'read') return { ok: true };
    const key = `probe/${Date.now()}-${randomBytes(8).toString('hex')}`;
    const payload = randomBytes(16).toString('hex');
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: payload, ContentLength: payload.length }));
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const back = await res.Body?.transformToString();
      if (back !== payload) return { ok: false, reason: 'Storage returned different bytes than were written.' };
      return { ok: true };
    } catch (err) {
      const code = status(err);
      return { ok: false, reason: code ? `The bucket refused a test write (HTTP ${code}).` : 'The bucket refused a test write.' };
    } finally {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => {});
    }
  }

  async withLocalInput<T>(key: string, fn: (input: string) => Promise<T>, opts: { ttlSeconds?: number } = {}): Promise<T> {
    await this.stat(key);
    const url = await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: opts.ttlSeconds ?? PRESIGN_TTL_SECONDS,
    });
    try {
      return await fn(url);
    } catch (err) {
      // Tools such as ffmpeg echo their input in errors: the signed URL
      // must never reach a log, so the error names the key instead.
      const message = err instanceof Error ? err.message.split(url).join(`<s3:${key}>`) : String(err);
      throw new StorageError('UNAVAILABLE', `withLocalInput(${key}) failed: ${message.replace(/https?:\/\/\S+/g, '<url>')}`);
    }
  }

  async capacity(): Promise<Capacity | null> {
    return null;
  }

  /** Incomplete multipart uploads are left to the bucket's AbortIncompleteMultipartUpload lifecycle rule (docs/storage.md). */
  async sweepStaging(): Promise<number> {
    return 0;
  }
}
