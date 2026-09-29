/**
 * Folder-tree helpers for media delivery: which folders and files are live
 * (nothing in the Trash, no trashed ancestor) and how a ZIP lays them out.
 */

import prisma from '@/lib/prisma';

export type TreeFolder = { id: string; name: string; parentId: string | null };

/** Live folders reachable from `rootIds` (roots included), breadth first. Trashed folders cut their subtree. */
export async function liveSubtree(rootIds: string[]): Promise<TreeFolder[]> {
  if (!rootIds.length) return [];
  const roots = await prisma.folder.findMany({
    where: { id: { in: rootIds }, trashedAt: null },
    select: { id: true, name: true, parentId: true },
  });
  const out: TreeFolder[] = [...roots];
  let frontier = roots.map((r) => r.id);
  let guard = 0;
  while (frontier.length && guard++ < 64) {
    const children = await prisma.folder.findMany({
      where: { parentId: { in: frontier }, trashedAt: null },
      select: { id: true, name: true, parentId: true },
    });
    out.push(...children);
    frontier = children.map((c) => c.id);
  }
  return out;
}

export type ZipPlan = {
  entries: { key: string; name: string }[];
  emptyDirs: string[];
};

function safeSegment(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return cleaned === '.' || cleaned === '..' || !cleaned ? '_' : cleaned;
}

/** ZIP layout for the live subtrees of `rootIds`: `Root/Sub/file.ext`, empty folders kept. */
export async function zipPlanForFolders(rootIds: string[]): Promise<ZipPlan> {
  const folders = await liveSubtree(rootIds);
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (id: string): string => {
    const parts: string[] = [];
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 64) {
      parts.unshift(safeSegment(cur.name));
      if (rootIds.includes(cur.id)) break;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join('/');
  };

  const files = folders.length
    ? await prisma.mediaFile.findMany({
        where: { folderId: { in: folders.map((f) => f.id) }, trashedAt: null, status: 'ready' },
        select: { folderId: true, originalName: true, storageKey: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const used = new Set<string>();
  const entries = files.map((f) => {
    let name = `${pathOf(f.folderId)}/${safeSegment(f.originalName)}`;
    if (used.has(name)) {
      const dot = name.lastIndexOf('.');
      let n = 2;
      const stem = dot > name.lastIndexOf('/') ? name.slice(0, dot) : name;
      const ext = dot > name.lastIndexOf('/') ? name.slice(dot) : '';
      while (used.has(`${stem} (${n})${ext}`)) n++;
      name = `${stem} (${n})${ext}`;
    }
    used.add(name);
    return { key: f.storageKey, name };
  });

  const nonEmpty = new Set<string>();
  for (const f of files) {
    let cur = byId.get(f.folderId);
    while (cur) {
      nonEmpty.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  const emptyDirs = folders.filter((f) => !nonEmpty.has(f.id)).map((f) => pathOf(f.id));
  return { entries, emptyDirs };
}

export function zipFileName(base: string): string {
  return `${safeSegment(base).slice(0, 120)}.zip`;
}
