/**
 * The configured backend, created once per process (`STORAGE_BACKEND`).
 * Configuration is read on first use, never at import.
 */
import { createHash } from 'node:crypto';
import { config } from '../../lib/config.ts';
import { LocalDiskBackend } from './local.ts';
import { S3Backend } from './s3.ts';
import type { StorageBackend } from './types.ts';

const holder = globalThis as unknown as { shotstashStorage?: StorageBackend };

export function createConfiguredBackend(): StorageBackend {
  const c = config();
  if (c.STORAGE_BACKEND === 's3') {
    return new S3Backend({
      endpoint: c.S3_ENDPOINT,
      region: c.S3_REGION,
      bucket: c.S3_BUCKET ?? '',
      accessKeyId: c.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: c.S3_SECRET_ACCESS_KEY ?? '',
      forcePathStyle: c.S3_FORCE_PATH_STYLE,
    });
  }
  return new LocalDiskBackend(c.STORAGE_LOCAL_ROOT);
}

/** The one storage backend of this installation. */
export function storage(): StorageBackend {
  if (!holder.shotstashStorage) holder.shotstashStorage = createConfiguredBackend();
  return holder.shotstashStorage;
}

/** Tests only: use `backend` (or the configured one again with null). */
export function setStorageForTests(backend: StorageBackend | null): void {
  holder.shotstashStorage = backend ?? undefined;
}

/** Health results are reused this long (monitoring polls must not hammer a NAS or a bucket). */
export const HEALTH_CACHE_MS = 10_000;
const healthCache = new Map<string, { at: number; value: { backend: StorageBackend['name']; reachable: boolean } }>();

/**
 * Health and status: the backend name and whether it answers (never
 * throws, 3 s budget, cached 10 s). `init` (first-run setup not done yet)
 * lets a fresh local root be initialised with its marker.
 */
export async function storageHealth(opts: { init?: boolean } = {}): Promise<{ backend: StorageBackend['name']; reachable: boolean }> {
  const cacheKey = opts.init ? 'init' : 'read';
  const hit = healthCache.get(cacheKey);
  if (hit && Date.now() - hit.at < HEALTH_CACHE_MS) return hit.value;
  let backend: StorageBackend;
  try {
    backend = storage();
  } catch {
    return { backend: config().STORAGE_BACKEND, reachable: false };
  }
  const timeout = new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), 3000).unref?.());
  const result = await Promise.race([backend.probe('read', opts).catch(() => ({ ok: false as const })), timeout]);
  const value = { backend: backend.name, reachable: result.ok };
  healthCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** MD5 (hex) of a stored object, read once in full (the S3 backend's completion check). */
export async function objectMd5(key: string, backend: StorageBackend = storage()): Promise<string> {
  const hash = createHash('md5');
  for await (const chunk of await backend.getStream(key)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** The first `bytes` bytes of a stored object (MIME sniffing); shorter for small objects. */
export async function readHead(key: string, bytes: number, backend: StorageBackend = storage()): Promise<Buffer> {
  const { size } = await backend.stat(key);
  if (size === 0) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of await backend.getStream(key, { start: 0, end: Math.min(bytes, size) - 1 })) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
