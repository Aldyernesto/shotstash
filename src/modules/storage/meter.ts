/**
 * A pass-through stream that counts and MD5-hashes the bytes flowing through
 * it and fails as soon as more than `limit` bytes arrive. Used by both
 * backends to verify upload parts while they stream. Alias-free.
 */
import { createHash, type Hash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { StorageError } from './errors.ts';

export class MeterStream extends Transform {
  bytes = 0;
  private readonly hash: Hash = createHash('md5');
  private digestHex: string | null = null;

  private readonly limit: number;

  constructor(limit: number = Number.POSITIVE_INFINITY) {
    super();
    this.limit = limit;
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.bytes += chunk.length;
    if (this.bytes > this.limit) {
      cb(new StorageError('PART_SIZE_MISMATCH', `Body is longer than the declared ${this.limit} bytes`));
      return;
    }
    this.hash.update(chunk);
    cb(null, chunk);
  }

  /** Hex MD5 of everything that passed (call once the stream has ended). */
  md5(): string {
    if (this.digestHex === null) this.digestHex = this.hash.digest('hex');
    return this.digestHex;
  }
}

/** Normalises an MD5 given as hex or base64 to lowercase hex; null when it is neither. */
export function md5Hex(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^[0-9a-fA-F]{32}$/.test(v)) return v.toLowerCase();
  if (/^[A-Za-z0-9+/]{22}==$/.test(v)) return Buffer.from(v, 'base64').toString('hex');
  return null;
}
