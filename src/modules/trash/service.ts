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
 *            and rows deleted in one transaction; bytes and directories go
 *            after the commit.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { GraphQLError } from 'graphql';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { folderChainTrashed } from '@/lib/shareLink';
import { isInsideStorageRoot, storageRoot } from '@/lib/storageRoot';
import { revokeLinksForTargets } from '@/services/share.service';
import { getFolderPhysicalPath } from '@/services/folder.service';
import { getProjectPhysicalPath } from '@/services/project.service';
import { COVER_EXTENSIONS, coversDir } from '@/modules/media';
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
  const file = await prisma.mediaFile.findUnique({ where: { id: fileId }, select: { id: true, trashedAt: true } });
  if (!file) throw trashError('NOT_FOUND', 'File not found');
  if (file.trashedAt) throw trashError('ALREADY_TRASHED', 'File is already in the Trash');
  await prisma.mediaFile.update({ where: { id: fileId }, data: { trashedAt: new Date(), trashRootId: null } });
  return true;
}

export async function trashFolder(folderId: string) {
  await prisma.$transaction(async (tx) => {
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
    const files = await tx.mediaFile.findMany({
      where: { folderId: { in: subtree } },
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
  });
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
  return prisma.mediaFile.update({
    where: { id: fileId },
    data: { trashedAt: null, trashRootId: null },
    include: { folder: true, project: true },
  });
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
  await prisma.$transaction([
    prisma.folder.update({ where: { id: folderId }, data: { trashedAt: null, trashRootId: null } }),
    prisma.folder.updateMany({ where: { trashRootId: folderId }, data: { trashedAt: null, trashRootId: null } }),
    prisma.mediaFile.updateMany({ where: { trashRootId: folderId }, data: { trashedAt: null, trashRootId: null } }),
  ]);
  return prisma.folder.findUnique({
    where: { id: folderId },
    include: { children: { where: { trashedAt: null } }, files: { where: { trashedAt: null } } },
  });
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

/** Trash page rows: trash roots only (cascaded rows come back with their root). */
export function trashedFileRoots() {
  return prisma.mediaFile.findMany({
    where: { trashedAt: { not: null }, trashRootId: null },
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
type PurgedFile = { id: string; storagePath: string; thumbnailPath: string | null };

async function removeBytes(files: (string | null | undefined)[], dirs: (string | null | undefined)[]) {
  const root = storageRoot();
  for (const p of files) {
    if (p && isInsideStorageRoot(p, root)) await fs.unlink(p).catch(() => {});
  }
  for (const d of dirs) {
    // Never recurse outside the storage root, and never remove the root itself.
    if (!d || !isInsideStorageRoot(d, root) || path.resolve(d) === root) continue;
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
}

/** Best effort: drop purged files from the search index when Elasticsearch is configured. */
async function removeFromSearch(fileIds: string[]) {
  if (!fileIds.length) return;
  try {
    const { esClient } = await import('@/lib/elasticsearch');
    const es = esClient();
    if (!es) return;
    await es.deleteByQuery({ index: 'media_files', query: { ids: { values: fileIds } }, conflicts: 'proceed' });
  } catch (err) {
    logger('trash').warn('search index cleanup failed', { err: errMessage(err) });
  }
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
    select: { id: true, storagePath: true, thumbnailPath: true },
  });
  const fileIds = files.map((f) => f.id);
  const allFolderIds = [...folderIds];
  await revokeLinksForTargets({ fileIds, folderIds: allFolderIds }, 'target_deleted', tx);
  if (fileIds.length) await tx.mediaFile.deleteMany({ where: { id: { in: fileIds } } });
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
    // Directory paths derive from the rows, so they are resolved before the delete.
    const dirs: (string | null)[] = [];
    for (const id of folderRootIds) dirs.push(await getFolderPhysicalPath(id).catch(() => null));

    const done = await prisma.$transaction((tx) => purgeBatchTx(tx, folderRootIds, fileRootIds), {
      timeout: PURGE_TX_TIMEOUT_MS,
    });
    await removeBytes(done.files.flatMap((f) => [f.storagePath, f.thumbnailPath]), dirs);
    await removeFromSearch(done.files.map((f) => f.id));
    total.files += done.files.length;
    total.folders += done.folderCount;
  }
  return total;
}

/** Deletes a project with everything in it: links revoked first, then rows, then bytes, cover and directory. */
export async function purgeProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw trashError('NOT_FOUND', 'Project not found');
  const dir = await getProjectPhysicalPath(projectId).catch(() => null);
  // Revoke and delete in one transaction, selecting the final set inside it:
  // a link or file created in between is revoked / removed too.
  const files = await prisma.$transaction(
    async (tx) => {
      const folders = await tx.folder.findMany({ where: { projectId }, select: { id: true } });
      const rows: PurgedFile[] = await tx.mediaFile.findMany({
        where: { projectId },
        select: { id: true, storagePath: true, thumbnailPath: true },
      });
      await revokeLinksForTargets(
        { projectIds: [projectId], folderIds: folders.map((f) => f.id), fileIds: rows.map((f) => f.id) },
        'target_deleted',
        tx,
      );
      await tx.project.delete({ where: { id: projectId } });
      return rows;
    },
    { timeout: PURGE_TX_TIMEOUT_MS },
  );
  const covers = COVER_EXTENSIONS.map((ext) => path.join(coversDir(), `${projectId}${ext}`));
  await removeBytes([...files.flatMap((f) => [f.storagePath, f.thumbnailPath]), ...covers], [dir]);
  await removeFromSearch(files.map((f) => f.id));
  return true;
}

/** Sweeper: purges every trash root trashed more than `retentionDays` ago. */
export async function purgeExpired(retentionDays: number, now: number = Date.now(), opts: { deadline?: number } = {}) {
  const where = expiredRootWhere(retentionCutoff(retentionDays, now));
  const folders = await prisma.folder.findMany({ where, select: { id: true } });
  const files = await prisma.mediaFile.findMany({ where, select: { id: true } });
  return purgeRoots({ folderIds: folders.map((f) => f.id), fileIds: files.map((f) => f.id) }, opts);
}
