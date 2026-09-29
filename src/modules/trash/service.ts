/**
 * Trash lifecycle (Story 2.8).
 *
 *   trash    a Section: the root gets `trashedAt`; every live descendant
 *            folder and file gets `trashedAt` + `trashRootId = root`, in one
 *            transaction. A file on its own: `trashedAt` only.
 *   restore  a root only: clears the root and exactly the rows that carry
 *            its `trashRootId`. Items trashed on their own earlier stay in
 *            the Trash. A cascaded child, or a root inside a trashed
 *            Section, is refused ("restore the containing Section").
 *   purge    one path for Delete forever, project deletion and the sweeper:
 *            links to every purged item are revoked (`target_deleted`)
 *            and rows deleted in one transaction; every storage key of the
 *            purged files (original, thumbnails, processed versions) and a
 *            deleted project's cover are removed through the storage
 *            backend after the commit. A backend error is logged; the keys
 *            of a later sweep are removed independently.
 *
 * Restoring a file whose bytes meanwhile arrived again in its Project marks
 * the restored file as a duplicate (see the upload module's dedup index).
 */
import { GraphQLError } from 'graphql';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { folderChainTrashed } from '@/lib/shareLink';
import { revokeLinksForTargets } from '@/services/share.service';
import { coverIdFromUrl, deleteCover } from '@/modules/media';
import { storage, storageKeys } from '@/modules/storage';
import { detachDuplicates, detachDuplicatesOfProject, markConflictsAsDuplicates, resettle } from '@/modules/upload';
import { syncSearch, syncSearchLater } from '@/modules/library';
import { batches, expiredRootWhere, planFolderTrash, retentionCutoff, subtreeFolderIds } from './plan';
import { errMessage, logger } from '@/lib/logger';

export type TrashErrorCode = 'NOT_FOUND' | 'NOT_IN_TRASH' | 'ALREADY_TRASHED' | 'ANCESTOR_TRASHED';

export function trashError(code: TrashErrorCode, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}

const RESTORE_PARENT_FIRST = 'This item is inside a trashed Section: restore the containing Section.';

/* ------------------------------------------------------------------ */
/* Trash                                                               */
/* ------------------------------------------------------------------ */

export async function trashFile(fileId: string) {
  const file = await prisma.mediaFile.findUnique({ where: { id: fileId }, select: { id: true, trashedAt: true, status: true } });
  if (!file || file.status !== 'ready') throw trashError('NOT_FOUND', 'File not found');
  if (file.trashedAt) throw trashError('ALREADY_TRASHED', 'File is already in the Trash');
  await prisma.mediaFile.update({ where: { id: fileId }, data: { trashedAt: new Date(), trashRootId: null } });
  syncSearchLater([fileId]);
  return true;
}

export async function trashFolder(folderId: string) {
  const trashed = await prisma.$transaction(async (tx) => {
    const root = await tx.folder.findUnique({
      where: { id: folderId },
      select: { id: true, projectId: true, trashedAt: true },
    });
    if (!root) throw trashError('NOT_FOUND', 'Section not found');
    if (root.trashedAt) throw trashError('ALREADY_TRASHED', 'Section is already in the Trash');
    const folders = await tx.folder.findMany({
      where: { projectId: root.projectId },
      select: { id: true, parentId: true, trashedAt: true },
    });
    const subtree = subtreeFolderIds(root.id, folders);
    // Uploads still running into the Section are not trashed: their
    // completion finds the target gone and discards them.
    const files = await tx.mediaFile.findMany({
      where: { folderId: { in: subtree }, status: 'ready' },
      select: { id: true, folderId: true, trashedAt: true },
    });
    const plan = planFolderTrash(root.id, folders, files);
    const now = new Date();
    await tx.folder.update({ where: { id: root.id }, data: { trashedAt: now, trashRootId: null } });
    if (plan.folderIds.length) {
      await tx.folder.updateMany({ where: { id: { in: plan.folderIds } }, data: { trashedAt: now, trashRootId: root.id } });
    }
    if (plan.fileIds.length) {
      await tx.mediaFile.updateMany({ where: { id: { in: plan.fileIds } }, data: { trashedAt: now, trashRootId: root.id } });
    }
    return plan.fileIds;
  });
  syncSearchLater(trashed);
  return true;
}

/* ------------------------------------------------------------------ */
/* Restore                                                             */
/* ------------------------------------------------------------------ */

export async function restoreFile(fileId: string) {
  const file = await prisma.mediaFile.findUnique({
    where: { id: fileId },
    select: { id: true, trashedAt: true, trashRootId: true, folderId: true },
  });
  if (!file) throw trashError('NOT_FOUND', 'File not found');
  if (!file.trashedAt) throw trashError('NOT_IN_TRASH', 'File is not in the Trash');
  if (file.trashRootId || (await folderChainTrashed(file.folderId))) {
    throw trashError('ANCESTOR_TRASHED', RESTORE_PARENT_FIRST);
  }
  const restored = await prisma.$transaction(async (tx) => {
    await markConflictsAsDuplicates(tx, [fileId]);
    return tx.mediaFile.update({
      where: { id: fileId },
      data: { trashedAt: null, trashRootId: null },
      include: { folder: true, project: true },
    });
  });
  syncSearchLater([fileId]);
  return restored;
}

export async function restoreFolder(folderId: string) {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { id: true, trashedAt: true, trashRootId: true, parentId: true },
  });
  if (!folder) throw trashError('NOT_FOUND', 'Section not found');
  if (!folder.trashedAt) throw trashError('NOT_IN_TRASH', 'Section is not in the Trash');
  if (folder.trashRootId || (folder.parentId && (await folderChainTrashed(folder.parentId)))) {
    throw trashError('ANCESTOR_TRASHED', RESTORE_PARENT_FIRST);
  }
  const restored = await prisma.$transaction(async (tx) => {
    const files = await tx.mediaFile.findMany({ where: { trashRootId: folderId }, select: { id: true } });
    await markConflictsAsDuplicates(tx, files.map((f) => f.id));
    await tx.folder.update({ where: { id: folderId }, data: { trashedAt: null, trashRootId: null } });
    await tx.folder.updateMany({ where: { trashRootId: folderId }, data: { trashedAt: null, trashRootId: null } });
    await tx.mediaFile.updateMany({ where: { trashRootId: folderId }, data: { trashedAt: null, trashRootId: null } });
    return files.map((f) => f.id);
  });
  syncSearchLater(restored);
  return prisma.folder.findUnique({
    where: { id: folderId },
    include: { children: { where: { trashedAt: null } }, files: { where: { trashedAt: null, status: 'ready' } } },
  });
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

/** Trash page rows: trash roots only (cascaded rows come back with their root). */
export function trashedFileRoots() {
  return prisma.mediaFile.findMany({
    where: { trashedAt: { not: null }, trashRootId: null, status: 'ready' },
    include: { folder: { include: { project: true } } },
    orderBy: { trashedAt: 'desc' },
  });
}

export function trashedFolderRoots() {
  return prisma.folder.findMany({
    where: { trashedAt: { not: null }, trashRootId: null },
    include: { project: true },
    orderBy: { trashedAt: 'desc' },
  });
}

/* ------------------------------------------------------------------ */
/* Purge                                                               */
/* ------------------------------------------------------------------ */

/** Roots per transaction, and how long one batch may take. */
export const PURGE_BATCH_SIZE = 100;
const PURGE_TX_TIMEOUT_MS = 60_000;

type Tx = Prisma.TransactionClient;
type PurgedFile = {
  id: string;
  storageKey: string;
  thumbVersion: number;
  processedVersions: { storageKey: string }[];
};

const PURGED_FILE_SELECT = {
  id: true,
  storageKey: true,
  thumbVersion: true,
  processedVersions: { select: { storageKey: true } },
} as const;

/** Every storage key a file owns: the original, each thumbnail version and processed versions. */
export function keysOfFile(f: PurgedFile): string[] {
  const keys = [f.storageKey];
  for (let v = 1; v <= f.thumbVersion; v++) keys.push(storageKeys.thumbnail(f.id, v));
  for (const p of f.processedVersions) keys.push(p.storageKey);
  return keys;
}

/** Deletes keys through the backend; failures are logged, never thrown (rows are already gone). */
async function removeKeys(keys: string[]) {
  const store = storage();
  let failed = 0;
  for (const key of keys) {
    try {
      await store.delete(key);
    } catch (err) {
      failed++;
      if (failed <= 5) logger('trash').warn('storage delete failed', { key, err: errMessage(err) });
    }
  }
  if (failed) logger('trash').error('some storage keys could not be deleted', { failed, total: keys.length });
}

/** Best effort: purged files leave the search index (rows are gone, so sync deletes them). */
async function removeFromSearch(fileIds: string[]) {
  await syncSearch(fileIds);
}

/**
 * Inside the deleting transaction: the final set of rows under these trashed
 * roots, links to them revoked, rows deleted. Selecting here (not before)
 * means a row added meanwhile is revoked and its bytes removed too.
 */
async function purgeBatchTx(tx: Tx, folderRootIds: string[], fileRootIds: string[]) {
  const rootFolders = folderRootIds.length
    ? await tx.folder.findMany({
        where: { id: { in: folderRootIds }, trashedAt: { not: null } },
        select: { id: true, projectId: true },
      })
    : [];
  const folderIds = new Set<string>();
  for (const projectId of new Set(rootFolders.map((f) => f.projectId))) {
    const folders = await tx.folder.findMany({ where: { projectId }, select: { id: true, parentId: true, trashedAt: true } });
    for (const r of rootFolders.filter((f) => f.projectId === projectId)) {
      for (const id of subtreeFolderIds(r.id, folders)) folderIds.add(id);
    }
  }
  const files: PurgedFile[] = await tx.mediaFile.findMany({
    where: {
      OR: [
        { id: { in: fileRootIds }, trashedAt: { not: null } },
        ...(folderIds.size ? [{ folderId: { in: [...folderIds] } }] : []),
      ],
    },
    select: PURGED_FILE_SELECT,
  });
  const fileIds = files.map((f) => f.id);
  const allFolderIds = [...folderIds];
  await revokeLinksForTargets({ fileIds, folderIds: allFolderIds }, 'target_deleted', tx);
  const survivors = await detachDuplicates(tx, fileIds);
  if (fileIds.length) await tx.mediaFile.deleteMany({ where: { id: { in: fileIds } } });
  // The oldest surviving duplicate of a purged original becomes the original.
  await resettle(tx, survivors);
  if (allFolderIds.length) await tx.folder.deleteMany({ where: { id: { in: allFolderIds } } });
  return { files, folderCount: allFolderIds.length };
}

export type PurgeResult = { files: number; folders: number; stoppedEarly: boolean };

/**
 * Permanently deletes trashed roots (files, and Sections with everything in
 * them), in batches of `PURGE_BATCH_SIZE` roots per transaction. Items that
 * are not in the Trash are ignored. With `deadline` (epoch ms) it stops
 * between batches once the deadline has passed.
 */
export async function purgeRoots(
  roots: { fileIds?: string[]; folderIds?: string[] },
  opts: { deadline?: number } = {},
): Promise<PurgeResult> {
  const all = [
    ...(roots.folderIds ?? []).map((id) => ({ kind: 'folder' as const, id })),
    ...(roots.fileIds ?? []).map((id) => ({ kind: 'file' as const, id })),
  ];
  const total: PurgeResult = { files: 0, folders: 0, stoppedEarly: false };
  for (const batch of batches(all, PURGE_BATCH_SIZE)) {
    if (opts.deadline && Date.now() > opts.deadline) {
      total.stoppedEarly = true;
      break;
    }
    const folderRootIds = batch.filter((b) => b.kind === 'folder').map((b) => b.id);
    const fileRootIds = batch.filter((b) => b.kind === 'file').map((b) => b.id);

    const done = await prisma.$transaction((tx) => purgeBatchTx(tx, folderRootIds, fileRootIds), {
      timeout: PURGE_TX_TIMEOUT_MS,
    });
    await removeKeys(done.files.flatMap(keysOfFile));
    await removeFromSearch(done.files.map((f) => f.id));
    total.files += done.files.length;
    total.folders += done.folderCount;
  }
  return total;
}

/** Deletes a project with everything in it: links revoked first, then rows, then bytes and the cover. */
export async function purgeProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, coverImage: true } });
  if (!project) throw trashError('NOT_FOUND', 'Project not found');
  // Revoke and delete in one transaction, selecting the final set inside it:
  // a link or file created in between is revoked / removed too.
  const uploads: string[] = [];
  const files = await prisma.$transaction(
    async (tx) => {
      const folders = await tx.folder.findMany({ where: { projectId }, select: { id: true } });
      const rows: PurgedFile[] = await tx.mediaFile.findMany({
        where: { projectId },
        select: PURGED_FILE_SELECT,
      });
      await revokeLinksForTargets(
        { projectIds: [projectId], folderIds: folders.map((f) => f.id), fileIds: rows.map((f) => f.id) },
        'target_deleted',
        tx,
      );
      const survivors = await detachDuplicatesOfProject(tx, projectId);
      // Uploads still running into this project end with it.
      const sessions = await tx.uploadSession.findMany({
        where: { projectId, status: { in: ['IN_PROGRESS', 'COMPLETING'] } },
        select: { backendUploadId: true },
      });
      await tx.uploadSession.updateMany({ where: { projectId, status: { in: ['IN_PROGRESS', 'COMPLETING'] } }, data: { status: 'FAILED' } });
      uploads.push(...sessions.map((u) => u.backendUploadId).filter((u): u is string => !!u));
      await tx.project.delete({ where: { id: projectId } });
      await resettle(tx, survivors);
      return rows;
    },
    { timeout: PURGE_TX_TIMEOUT_MS },
  );
  await removeKeys(files.flatMap(keysOfFile));
  for (const u of uploads) await storage().abortUpload(u).catch(() => {});
  const cover = coverIdFromUrl(project.coverImage);
  if (cover?.kind === 'project') await deleteCover('project', cover.id).catch(() => {});
  await removeFromSearch(files.map((f) => f.id));
  return true;
}

/** Sweeper: purges every trash root trashed more than `retentionDays` ago. */
export async function purgeExpired(retentionDays: number, now: number = Date.now(), opts: { deadline?: number } = {}) {
  const where = expiredRootWhere(retentionCutoff(retentionDays, now));
  const folders = await prisma.folder.findMany({ where, select: { id: true } });
  const files = await prisma.mediaFile.findMany({ where: { ...where, status: 'ready' }, select: { id: true } });
  return purgeRoots({ folderIds: folders.map((f) => f.id), fileIds: files.map((f) => f.id) }, opts);
}
