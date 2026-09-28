/**
 * Trash cascade planning (Story 2.8): pure functions that compute which rows
 * a trash, restore or purge touches. Alias-free: `node --test` imports it.
 */

export type FolderNode = { id: string; parentId: string | null; trashedAt: Date | string | null };
export type FileNode = { id: string; folderId: string; trashedAt: Date | string | null };

function childrenIndex(folders: FolderNode[]): Map<string, FolderNode[]> {
  const byParent = new Map<string, FolderNode[]>();
  for (const f of folders) {
    if (!f.parentId) continue;
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  return byParent;
}

/** Every folder id in the subtree of `rootId` (root first), trashed or not. Cycle safe. */
export function subtreeFolderIds(rootId: string, folders: FolderNode[]): string[] {
  const byParent = childrenIndex(folders);
  const seen = new Set<string>([rootId]);
  const out = [rootId];
  for (let i = 0; i < out.length; i++) {
    for (const c of byParent.get(out[i]) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c.id);
    }
  }
  return out;
}

/**
 * Rows that trashing Section `rootId` cascades to: live descendant folders
 * and live files inside the root or those folders. A descendant that is
 * already in the Trash (trashed on its own earlier) keeps its own trash
 * entry, and so does everything below it, so those subtrees are skipped.
 */
export function planFolderTrash(
  rootId: string,
  folders: FolderNode[],
  files: FileNode[],
): { folderIds: string[]; fileIds: string[] } {
  const byParent = childrenIndex(folders);
  const cascaded: string[] = [];
  const live = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const c of byParent.get(id) ?? []) {
      if (live.has(c.id) || c.trashedAt) continue;
      live.add(c.id);
      cascaded.push(c.id);
      queue.push(c.id);
    }
  }
  const fileIds = files.filter((f) => !f.trashedAt && live.has(f.folderId)).map((f) => f.id);
  return { folderIds: cascaded, fileIds };
}

/** Cutoff for the sweeper: items trashed before this instant are purged. */
export function retentionCutoff(retentionDays: number, now: number = Date.now()): Date {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 30;
  return new Date(now - days * 24 * 60 * 60 * 1000);
}

/** `TRASH_RETENTION_DAYS`, default 30; invalid values fall back to 30. */
export function retentionDaysFromEnv(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 30;
}

export type TrashRow = { trashedAt: Date | string | null; trashRootId: string | null };

/** Sweeper selection: trash roots (not cascaded rows) trashed before `cutoff`. */
export function isExpiredRoot(row: TrashRow, cutoff: Date): boolean {
  if (row.trashRootId !== null || !row.trashedAt) return false;
  return new Date(row.trashedAt).getTime() < cutoff.getTime();
}

/** The same rule as a Prisma `where` (folders and media files). */
export function expiredRootWhere(cutoff: Date) {
  return { trashedAt: { lt: cutoff }, trashRootId: null };
}

/** Splits `items` into batches of at most `size`. */
export function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
