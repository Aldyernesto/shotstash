/**
 * Uploads on the storage interface (Story 4.3).
 *
 *   initiate  validates, creates the `uploading` MediaFile row and its
 *             UploadSession, starts a backend multipart upload and answers
 *             the part size and count (decided here, never by the client)
 *   part      `PUT /api/v1/uploads/:sessionId/parts/:n`: the raw body
 *             streams to the backend, capped at the part size and checked
 *             against its MD5; re-sending a part replaces it
 *   resume    `uploadSession(id)` lists the confirmed parts
 *   complete  every part present, backend assembly, whole-file MD5 check,
 *             MIME sniffing (the key's extension comes from the bytes),
 *             then the row flips to `ready` in a transaction guarded by the
 *             dedup index; thumbnail, chat line and notifications follow
 *   cancel    aborts the backend upload and removes the row
 *   expire    the hourly sweeper ends sessions older than 24 h
 *
 * Failures are `UploadFailure { code, status, details }`: REST answers
 * `{ code, message, ...details }` with `status`, GraphQL carries the code.
 */
import type { Readable } from 'stream';
import { v7 as uuidv7 } from 'uuid';
import prisma from '@/lib/prisma';
import { bigIntToNumber } from '@/lib/bigint';
import { errMessage, logger } from '@/lib/logger';
import { codedError } from '@/modules/errors';
import { can, listActorsWithAccess, type Actor } from '@/modules/auth';
import { channels, publishAfterCommit } from '@/modules/realtime';
import { createHeicPreview, generateThumbnail, isHeicMime } from '@/modules/media';
import { syncSearchLater } from '@/modules/library';
import {
  SNIFF_BYTES,
  expectedPartSize,
  extensionFor,
  isStorageError,
  md5Hex,
  mimeFromName,
  objectMd5,
  partPlan,
  readHead,
  sniffType,
  storage,
  storageKeys,
} from '@/modules/storage';
import { createNotification } from '@/services/notification.service';
import { insertChat } from '@/services/chat.service';
import { findOriginal, isDedupViolation } from './dedup';

const log = logger('upload');

/** Sessions end 24 h after initiate. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** The largest single file (the S3 object limit). */
export const MAX_FILE_BYTES = 5 * 1024 ** 4;
const MAX_NAME_LENGTH = 255;

export class UploadFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = 'UploadFailure';
  }
}

const fail = (code: string, message: string, status: number, details?: Record<string, string | number>) =>
  new UploadFailure(code, message, status, details);

/** The same failure as a GraphQL error (code and details in `extensions`). */
export function asGraphQLError(err: unknown): unknown {
  if (err instanceof UploadFailure) return codedError(err.code, err.message, err.details);
  return err;
}

function storageFailure(err: unknown, what: string): UploadFailure {
  log.error('storage failed', { what, err: errMessage(err) });
  return fail('STORAGE_UNAVAILABLE', 'Storage is unavailable', 503);
}

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f/\\]/.test(name) || name === '.' || name === '..') {
    throw fail('INVALID_FILENAME', 'File name is empty, too long or has path characters', 400);
  }
  return name;
}

/* ------------------------------------------------------------------ */
/* Initiate                                                            */
/* ------------------------------------------------------------------ */

export type InitiateInput = {
  actor: Actor;
  projectId: string;
  folderId: string;
  filename: string;
  size: number;
  /** Whole-file MD5 (hex or base64), when the client already has it. */
  md5?: string | null;
  /** "Upload anyway": identical bytes may exist in the Project. */
  allowDuplicate?: boolean;
};

export async function initiateUpload(input: InitiateInput) {
  const name = cleanName(input.filename);
  const size = Number(input.size);
  if (!Number.isSafeInteger(size) || size < 0) throw fail('BAD_REQUEST', 'totalSize must be a whole number of bytes', 400);
  if (size > MAX_FILE_BYTES) throw fail('TOO_LARGE', 'File is larger than 5 TiB', 413);
  let md5: string | null = null;
  if (input.md5) {
    md5 = md5Hex(input.md5);
    if (!md5) throw fail('BAD_REQUEST', 'md5Checksum must be 32 hex characters', 400);
  }
  const allowDuplicate = input.allowDuplicate === true;
  if (md5 && !allowDuplicate) {
    const existing = await findOriginal(prisma, input.projectId, md5);
    if (existing) {
      throw fail('DUPLICATE_FILE', 'Identical bytes are already in this project', 409, {
        existingFileId: existing.id,
        existingName: existing.originalName,
      });
    }
  }

  const fileId = uuidv7();
  const sessionId = uuidv7();
  const plan = partPlan(size);
  const guessedMime = mimeFromName(name);
  const key = storageKeys.original(fileId, extensionFor(guessedMime, name));
  let backendUploadId: string;
  try {
    backendUploadId = await storage().beginUpload(key);
  } catch (err) {
    throw storageFailure(err, 'beginUpload');
  }

  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  try {
    await prisma.$transaction([
      prisma.mediaFile.create({
        data: {
          id: fileId,
          filename: `${fileId}.${key.split('.').pop()}`,
          originalName: name,
          mimeType: guessedMime,
          size: BigInt(size),
          md5Checksum: '',
          storageKey: key,
          status: 'uploading',
          folderId: input.folderId,
          projectId: input.projectId,
          uploadedById: input.actor.id,
        },
      }),
      prisma.uploadSession.create({
        data: {
          id: sessionId,
          filename: name,
          totalSize: BigInt(size),
          totalChunks: plan.partCount,
          partSize: plan.partSize,
          md5Expected: md5,
          allowDuplicate,
          projectId: input.projectId,
          folderId: input.folderId,
          uploadedById: input.actor.id,
          mediaFileId: fileId,
          backendUploadId,
          expiresAt,
        },
      }),
    ]);
  } catch (err) {
    await storage().abortUpload(backendUploadId).catch(() => {});
    throw err;
  }
  log.info('initiated', { sessionId, fileId, size, parts: plan.partCount });
  return { sessionId, fileId, partSize: plan.partSize, partCount: plan.partCount, expiresAt, size };
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

async function ownSession(actor: Actor, sessionId: string) {
  const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
  if (!session) throw fail('UPLOAD_SESSION_NOT_FOUND', 'Upload session not found', 404);
  if (!can(actor, 'upload', { ownerId: session.uploadedById })) {
    throw fail('FORBIDDEN', 'Upload session belongs to another user', 403);
  }
  return session;
}

function assertOpen(session: { status: string; expiresAt: Date }) {
  if (session.status === 'EXPIRED' || (session.status === 'IN_PROGRESS' && session.expiresAt.getTime() <= Date.now())) {
    throw fail('UPLOAD_SESSION_EXPIRED', 'Upload session expired', 410);
  }
  if (session.status !== 'IN_PROGRESS') throw fail('UPLOAD_SESSION_CLOSED', 'Upload session is not open', 409);
}

/** Resume: the session as the uploader sees it, with the part numbers already stored. */
export async function uploadSessionInfo(actor: Actor, sessionId: string) {
  const session = await ownSession(actor, sessionId);
  const parts = await prisma.uploadPart.findMany({
    where: { sessionId },
    select: { partNumber: true },
    orderBy: { partNumber: 'asc' },
  });
  const expired = session.status === 'EXPIRED' || (session.status === 'IN_PROGRESS' && session.expiresAt.getTime() <= Date.now());
  return {
    id: session.id,
    fileId: session.mediaFileId,
    filename: session.filename,
    totalSize: session.totalSize,
    partSize: session.partSize,
    partCount: session.totalChunks,
    projectId: session.projectId,
    folderId: session.folderId,
    status: expired ? 'EXPIRED' : session.status,
    confirmedParts: parts.map((p) => p.partNumber),
    expiresAt: session.expiresAt,
  };
}

/* ------------------------------------------------------------------ */
/* Parts                                                               */
/* ------------------------------------------------------------------ */

export type PartInput = {
  actor: Actor;
  sessionId: string;
  partNumber: number;
  body: Readable;
  /** Content-Length of the request, when sent. */
  contentLength: number | null;
  /** Content-MD5 of the part (base64, or hex). */
  md5: string | null;
};

export async function putPart(input: PartInput) {
  const session = await ownSession(input.actor, input.sessionId);
  assertOpen(session);
  const n = input.partNumber;
  const expected = expectedPartSize({ size: Number(session.totalSize), partSize: session.partSize, partCount: session.totalChunks }, n);
  if (expected < 0) {
    throw fail('INVALID_PART_NUMBER', `Part number must be 1 to ${session.totalChunks}`, 400, { partCount: session.totalChunks });
  }
  if (input.contentLength !== null && input.contentLength !== expected) {
    throw fail('PART_SIZE_MISMATCH', `Part ${n} must be ${expected} bytes`, 400, { expected });
  }
  const md5 = md5Hex(input.md5);
  if (!md5) throw fail('PART_CHECKSUM_REQUIRED', 'Content-MD5 of the part is required', 400);
  if (!session.backendUploadId) throw fail('UPLOAD_SESSION_CLOSED', 'Upload session is not open', 409);

  let stored;
  try {
    stored = await storage().putPart(session.backendUploadId, n, input.body, expected, { md5 });
  } catch (err) {
    if (isStorageError(err, 'CHECKSUM_MISMATCH')) throw fail('PART_CHECKSUM_MISMATCH', `Part ${n} does not match its MD5`, 400);
    if (isStorageError(err, 'PART_SIZE_MISMATCH')) throw fail('PART_SIZE_MISMATCH', `Part ${n} must be ${expected} bytes`, 400, { expected });
    if (isStorageError(err, 'INVALID_UPLOAD') || isStorageError(err, 'NOT_FOUND')) {
      throw fail('UPLOAD_SESSION_CLOSED', 'Upload session is not open', 409);
    }
    // A client that went away mid-body is not a storage failure.
    if ((err as NodeJS.ErrnoException)?.code === 'ERR_STREAM_PREMATURE_CLOSE' || (err as Error)?.name === 'AbortError') {
      throw fail('PART_INCOMPLETE', `Part ${n} was cut off`, 400);
    }
    throw storageFailure(err, 'putPart');
  }

  await prisma.uploadPart.upsert({
    where: { sessionId_partNumber: { sessionId: session.id, partNumber: n } },
    create: { sessionId: session.id, partNumber: n, size: stored.size, etag: stored.etag, md5 },
    update: { size: stored.size, etag: stored.etag, md5, createdAt: new Date() },
  });
  const confirmed = await prisma.uploadPart.count({ where: { sessionId: session.id } });
  // Story 5.5: the part row is committed; the uploader's channel learns it
  // (the subscription loads the session and recounts the parts itself).
  void publishAfterCommit({
    channels: [channels.user(session.uploadedById)],
    event: { type: 'upload.progress', id: session.id, seq: confirmed },
  });
  return { partNumber: n, size: stored.size, confirmedParts: confirmed, partCount: session.totalChunks };
}

/* ------------------------------------------------------------------ */
/* Complete                                                            */
/* ------------------------------------------------------------------ */

async function liveTarget(projectId: string, folderId: string): Promise<boolean> {
  const folder = await prisma.folder.findUnique({ where: { id: folderId }, select: { projectId: true, trashedAt: true, parentId: true } });
  if (!folder || folder.trashedAt || folder.projectId !== projectId) return false;
  let cursor = folder.parentId;
  for (let guard = 0; cursor && guard < 64; guard++) {
    const f = await prisma.folder.findUnique({ where: { id: cursor }, select: { parentId: true, trashedAt: true } });
    if (!f || f.trashedAt) return false;
    cursor = f.parentId;
  }
  return true;
}

type SessionRow = { id: string; mediaFileId: string | null; backendUploadId: string | null };
type SessionStatus = 'IN_PROGRESS' | 'COMPLETING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

/**
 * Ends a session as `status` (only when it is still in one of `from`, so a
 * session another request just claimed or ended is never touched), then
 * drops its staged parts, its `uploading` row and that row's object, plus
 * `extraKey`. Deletes are idempotent. Answers false when the session had
 * moved on.
 */
async function discard(session: SessionRow, from: SessionStatus[], status: 'FAILED' | 'EXPIRED', extraKey: string | null = null): Promise<boolean> {
  const ended = await prisma.uploadSession.updateMany({
    where: { id: session.id, status: { in: from } },
    data: { status, completingAt: null },
  });
  if (!ended.count) return false;
  const store = storage();
  if (session.backendUploadId) await store.abortUpload(session.backendUploadId).catch(() => {});
  const row = session.mediaFileId
    ? await prisma.mediaFile.findFirst({ where: { id: session.mediaFileId, status: 'uploading' }, select: { storageKey: true } })
    : null;
  for (const key of new Set([row?.storageKey, extraKey].filter((k): k is string => !!k))) {
    await store.delete(key).catch((err) => log.warn('delete failed', { key, err: errMessage(err) }));
  }
  await prisma.$transaction([
    prisma.uploadPart.deleteMany({ where: { sessionId: session.id } }),
    ...(session.mediaFileId ? [prisma.mediaFile.deleteMany({ where: { id: session.mediaFileId, status: 'uploading' } })] : []),
  ]);
  return true;
}

const FILE_INCLUDE = { uploadedBy: true, project: true, folder: true } as const;

/** A completion claim older than this may be taken over by a retry. */
export const COMPLETION_TAKEOVER_MS = 15 * 60 * 1000;
/** The sweeper ends a completion claim older than this. */
export const COMPLETION_ABANDON_MS = 60 * 60 * 1000;

/**
 * Development and e2e only: a file whose name starts with this fails once
 * right after its parts were assembled, to prove a retry resumes from there.
 */
const FAIL_AFTER_ASSEMBLY = '__fail_after_assembly__';
const failedOnce = new Set<string>();

export type CompleteInput = { actor: Actor; sessionId: string; md5?: string | null };

/**
 * Completion is resumable: every step records its result before the next
 * one runs (assembly clears `backendUploadId`, the verified MD5 and the
 * final key go on the `uploading` row), so a retry after a crash or an
 * error continues where the previous attempt stopped.
 */
export async function completeUpload(input: CompleteInput) {
  const session = await ownSession(input.actor, input.sessionId);
  // Completing twice answers the same file (a client that lost the first answer).
  if (session.status === 'COMPLETED' && session.mediaFileId) {
    const done = await prisma.mediaFile.findFirst({ where: { id: session.mediaFileId, status: 'ready' }, include: FILE_INCLUDE });
    if (done) return bigIntToNumber(done) as typeof done;
  }
  const staleClaim = new Date(Date.now() - COMPLETION_TAKEOVER_MS);
  if (!(session.status === 'COMPLETING' && session.completingAt && session.completingAt < staleClaim)) assertOpen(session);
  const claimed = await prisma.uploadSession.updateMany({
    where: {
      id: session.id,
      OR: [{ status: 'IN_PROGRESS' }, { status: 'COMPLETING', completingAt: { lt: staleClaim } }],
    },
    data: { status: 'COMPLETING', completingAt: new Date() },
  });
  if (!claimed.count) throw fail('UPLOAD_SESSION_CLOSED', 'Upload session is already completing', 409);
  const reopen = () =>
    prisma.uploadSession
      .updateMany({ where: { id: session.id, status: 'COMPLETING' }, data: { status: 'IN_PROGRESS', completingAt: null } })
      .catch(() => {});

  try {
    return await finishUpload(session, input);
  } catch (err) {
    // Whatever was not settled explicitly goes back to IN_PROGRESS (a
    // FAILED or EXPIRED session is never resurrected: the update is conditional).
    await reopen();
    if (err instanceof UploadFailure) throw err;
    if (isStorageError(err)) throw storageFailure(err, 'complete');
    throw err;
  }
}

async function finishUpload(session: Awaited<ReturnType<typeof ownSession>>, input: CompleteInput) {
  const file = session.mediaFileId ? await prisma.mediaFile.findUnique({ where: { id: session.mediaFileId } }) : null;
  if (!file || file.status !== 'uploading') {
    await discard(session, ['COMPLETING'], 'FAILED');
    throw fail('UPLOAD_SESSION_CLOSED', 'The file of this upload is gone', 409);
  }

  // The target may have been trashed or deleted since initiate.
  if (!(await liveTarget(session.projectId, session.folderId))) {
    await discard(session, ['COMPLETING'], 'FAILED');
    throw fail('NOT_FOUND', 'Section not found', 404);
  }

  const claimedMd5 = md5Hex(input.md5 ?? null);
  if (input.md5 && !claimedMd5) throw fail('BAD_REQUEST', 'md5Checksum must be 32 hex characters', 400);
  if (claimedMd5 && session.md5Expected && claimedMd5 !== session.md5Expected) {
    await discard(session, ['COMPLETING'], 'FAILED');
    throw fail('CHECKSUM_MISMATCH', 'MD5 differs from the one sent at initiate', 422);
  }
  const expectedMd5 = claimedMd5 ?? session.md5Expected;
  if (!expectedMd5) throw fail('CHECKSUM_REQUIRED', 'The MD5 of the whole file is required to complete', 400);

  const store = storage();
  let key = file.storageKey;
  // Set on the row once the assembled bytes matched the client's MD5.
  let md5: string | null = file.md5Checksum || null;
  const noUpload = { ...session, backendUploadId: null };

  if (session.backendUploadId) {
    const parts = await prisma.uploadPart.findMany({ where: { sessionId: session.id }, orderBy: { partNumber: 'asc' } });
    const plan = { size: Number(session.totalSize), partSize: session.partSize, partCount: session.totalChunks };
    const missing: number[] = [];
    for (let n = 1; n <= plan.partCount; n++) {
      const p = parts.find((x) => x.partNumber === n);
      if (!p || p.size !== expectedPartSize(plan, n)) missing.push(n);
    }
    if (missing.length) {
      throw fail('MISSING_PARTS', `Parts not received: ${missing.slice(0, 20).join(', ')}`, 409, {
        missing: missing.slice(0, 200).join(','),
        count: missing.length,
      });
    }
    let assembled;
    try {
      assembled = await store.completeUpload(
        session.backendUploadId,
        parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag, size: p.size })),
      );
    } catch (err) {
      if (isStorageError(err) && (err.code === 'NOT_FOUND' || err.code === 'PART_SIZE_MISMATCH' || err.code === 'INVALID_PART')) {
        await prisma.uploadPart.deleteMany({ where: { sessionId: session.id } });
        throw fail('MISSING_PARTS', 'Stored parts are incomplete: send them again', 409, { missing: '', count: plan.partCount });
      }
      throw err;
    }
    // Assembly is done: a retry must not assemble again.
    await prisma.uploadSession.update({ where: { id: session.id }, data: { backendUploadId: null } });
    if (assembled.md5) {
      if (assembled.md5 !== expectedMd5) {
        await discard(noUpload, ['COMPLETING'], 'FAILED', key);
        throw fail('CHECKSUM_MISMATCH', 'MD5 checksum mismatch: the file was damaged during upload', 422);
      }
      md5 = assembled.md5;
      await prisma.mediaFile.update({ where: { id: file.id }, data: { md5Checksum: md5 } });
    }
    if (process.env.NODE_ENV !== 'production' && file.originalName.startsWith(FAIL_AFTER_ASSEMBLY) && !failedOnce.has(session.id)) {
      failedOnce.add(session.id);
      throw fail('STORAGE_UNAVAILABLE', 'Simulated failure after assembly (development only)', 503);
    }
  } else if (!md5 && !(await store.exists(key))) {
    // Assembled earlier, but the object is gone: nothing left to finish.
    await discard(noUpload, ['COMPLETING'], 'FAILED');
    throw fail('UPLOAD_SESSION_CLOSED', 'The assembled file is gone: start the upload again', 409);
  }

  if (!md5) {
    // The S3 backend reads the object once; a resumed completion too.
    const hashed = await objectMd5(key);
    if (hashed !== expectedMd5) {
      await discard(noUpload, ['COMPLETING'], 'FAILED', key);
      throw fail('CHECKSUM_MISMATCH', 'MD5 checksum mismatch: the file was damaged during upload', 422);
    }
    md5 = hashed;
    await prisma.mediaFile.update({ where: { id: file.id }, data: { md5Checksum: md5 } });
  }

  const originalName = file.originalName;
  const size = Number(file.size);
  const sniffed = sniffType(await readHead(key, SNIFF_BYTES), originalName);
  const mimeType = sniffed.mime;
  const finalKey = storageKeys.original(file.id, sniffed.ext);
  if (finalKey !== key) {
    await store.move(key, finalKey);
    key = finalKey;
    await prisma.mediaFile.update({ where: { id: file.id }, data: { storageKey: key, mimeType } });
  }
  // Flip to ready. The dedup index decides races: two identical uploads
  // finishing together cannot both become originals.
  const flip = () =>
    prisma.$transaction(async (tx) => {
      const original = await findOriginal(tx, session.projectId, md5!, file.id);
      if (original && !session.allowDuplicate) {
        throw fail('DUPLICATE_FILE', 'Identical bytes are already in this project', 409, {
          existingFileId: original.id,
          existingName: original.originalName,
        });
      }
      const row = await tx.mediaFile.update({
        where: { id: file.id },
        data: {
          status: 'ready',
          md5Checksum: md5!,
          storageKey: key,
          filename: `${file.id}.${key.split('.').pop()}`,
          originalName,
          mimeType,
          size: BigInt(size),
          duplicateOfId: original ? original.id : null,
        },
        include: FILE_INCLUDE,
      });
      await tx.uploadSession.update({ where: { id: session.id }, data: { status: 'COMPLETED', completingAt: null } });
      return row;
    });
  let ready;
  try {
    try {
      ready = await flip();
    } catch (err) {
      // The index fired but its winner is not visible yet: look again once.
      if (!isDedupViolation(err) || (await findOriginal(prisma, session.projectId, md5, file.id))) throw err;
      ready = await flip();
    }
  } catch (err) {
    let failure = err instanceof UploadFailure ? err : null;
    if (!failure && isDedupViolation(err)) {
      const original = await findOriginal(prisma, session.projectId, md5, file.id);
      failure = fail('DUPLICATE_FILE', 'Identical bytes are already in this project', 409, {
        existingFileId: original?.id ?? '',
        existingName: original?.originalName ?? '',
      });
    }
    if (failure?.code === 'DUPLICATE_FILE') {
      await discard(noUpload, ['COMPLETING'], 'FAILED', key);
      throw failure;
    }
    throw err;
  }

  // Originals are immutable (Story 4.4): a HEIC stays as uploaded and gets
  // a JPEG preview version, which the thumbnail is rendered from.
  let preview: Buffer | undefined;
  if (isHeicMime(mimeType)) {
    try {
      preview = (await createHeicPreview({ id: ready.id, storageKey: key, size })).jpeg;
    } catch (err) {
      log.warn('HEIC preview failed, keeping the original only', { fileId: ready.id, err: errMessage(err) });
    }
  }
  const thumbVersion =
    isHeicMime(mimeType) && !preview
      ? 0
      : await generateThumbnail({ id: ready.id, storageKey: key, mimeType, thumbVersion: ready.thumbVersion }, { from: preview });
  if (thumbVersion) {
    await prisma.mediaFile.update({ where: { id: ready.id }, data: { thumbVersion } });
    ready.thumbVersion = thumbVersion;
  }

  syncSearchLater([ready.id]);
  await announce(ready, session.uploadedById);
  log.info('completed', { sessionId: session.id, fileId: ready.id, size });
  return bigIntToNumber(ready) as typeof ready;
}

/** System line in project discussion and notifications, as before Story 4.3. */
async function announce(
  file: { id: string; originalName: string; projectId: string; project: { title: string } | null },
  uploadedById: string,
) {
  try {
    await insertChat({
      kind: 'upload',
      message: `Uploaded ${file.originalName}.`,
      projectId: file.projectId,
      senderId: uploadedById,
      referencedFileId: file.id,
    });
  } catch (err) {
    log.error('chat line failed', { err: errMessage(err) });
  }
  const projectTitle = file.project?.title ?? '';
  // Story 5.5: only accounts that may view the Project.
  const members = await listActorsWithAccess(file.projectId);
  for (const member of members) {
    try {
      await createNotification({
        userId: member.id,
        type: 'upload_complete',
        projectId: file.projectId,
        title: 'File uploaded',
        body: `${file.originalName} was added to ${projectTitle || 'the project'}`,
        data: { projectId: file.projectId, fileId: file.id, fileName: file.originalName, projectTitle },
      });
    } catch (err) {
      log.error('notification failed', { err: errMessage(err) });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Cancel and expiry                                                   */
/* ------------------------------------------------------------------ */

export async function cancelUpload(actor: Actor, sessionId: string) {
  const session = await ownSession(actor, sessionId);
  if (session.status === 'COMPLETED') return false;
  if (session.status === 'COMPLETING') throw fail('UPLOAD_SESSION_CLOSED', 'Upload session is completing', 409);
  if (session.status === 'IN_PROGRESS') await discard(session, ['IN_PROGRESS'], 'FAILED');
  return true;
}

/** Staging leftovers (parts, temporary writes) older than this, unknown to any live session, are removed. */
export const STAGING_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Sweeper: sessions past their 24 h lifetime are aborted on the backend,
 * their parts, `uploading` row and its object removed, and marked EXPIRED;
 * a completion claimed more than an hour ago counts as abandoned. Then
 * staging leftovers older than 48 h that no live session references go.
 * A backend error leaves the session for the next sweep.
 */
export async function expireSessions(now: Date = new Date(), limit = 500): Promise<number> {
  const stale = await prisma.uploadSession.findMany({
    where: {
      OR: [
        { status: 'IN_PROGRESS', expiresAt: { lt: now } },
        { status: 'COMPLETING', completingAt: { lt: new Date(now.getTime() - COMPLETION_ABANDON_MS) } },
      ],
    },
    take: limit,
    orderBy: { expiresAt: 'asc' },
  });
  let n = 0;
  for (const s of stale) {
    try {
      if (s.backendUploadId) await storage().abortUpload(s.backendUploadId);
      const ended = await discard({ ...s, backendUploadId: null }, s.status === 'COMPLETING' ? ['COMPLETING'] : ['IN_PROGRESS'], 'EXPIRED');
      if (ended) n++;
    } catch (err) {
      log.warn('expiry failed, retried next sweep', { sessionId: s.id, err: errMessage(err) });
    }
  }
  try {
    const live = await prisma.uploadSession.findMany({
      where: { status: { in: ['IN_PROGRESS', 'COMPLETING'] }, backendUploadId: { not: null } },
      select: { backendUploadId: true },
    });
    const removed = await storage().sweepStaging(
      new Date(now.getTime() - STAGING_MAX_AGE_MS),
      new Set(live.map((l) => l.backendUploadId!)),
    );
    if (removed) log.info('staging leftovers removed', { removed });
  } catch (err) {
    log.warn('staging sweep failed', { err: errMessage(err) });
  }
  return n;
}
