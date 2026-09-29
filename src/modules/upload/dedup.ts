/**
 * Dedup per Project (Story 4.3).
 *
 * The authority is the partial unique index
 *   media_files (projectId, md5Checksum)
 *   WHERE status = 'ready' AND trashedAt IS NULL AND duplicate_of IS NULL
 * (migration 0006). The pre-upload check is advisory; whatever else makes a
 * file live again or brings it into another Project (restore, move, copy)
 * marks it as a duplicate first when an identical original is already live
 * there, so those operations never trip the index.
 *
 * `duplicate_of` points at the original. When an original is purged or
 * moved to another Project, the oldest surviving duplicate becomes the
 * original and the others point at it (`resettle`).
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

type Db = Prisma.TransactionClient | typeof prisma;

/** A live, ready original with these bytes in the Project (the one the index protects), or null. */
export async function findOriginal(db: Db, projectId: string, md5: string, excludeId?: string) {
  if (!md5) return null;
  return db.mediaFile.findFirst({
    where: {
      projectId,
      md5Checksum: md5,
      status: 'ready',
      trashedAt: null,
      duplicateOfId: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, originalName: true, folderId: true },
  });
}

/**
 * Marks each of `fileIds` as a duplicate when an identical live original
 * exists in `projectId` (or, without it, in the file's own Project).
 * Run before the update that makes the files live or moves them.
 */
export async function markConflictsAsDuplicates(db: Db, fileIds: string[], projectId?: string): Promise<number> {
  if (!fileIds.length) return 0;
  if (projectId) {
    return db.$executeRaw`
      UPDATE "media_files" AS r SET "duplicate_of" = l."id"
      FROM "media_files" AS l
      WHERE r."id" = ANY(${fileIds}::text[]) AND r."duplicate_of" IS NULL AND r."status" = 'ready'
        AND l."projectId" = ${projectId} AND l."md5Checksum" = r."md5Checksum"
        AND l."status" = 'ready' AND l."trashedAt" IS NULL AND l."duplicate_of" IS NULL
        AND NOT (l."id" = ANY(${fileIds}::text[]))`;
  }
  return db.$executeRaw`
    UPDATE "media_files" AS r SET "duplicate_of" = l."id"
    FROM "media_files" AS l
    WHERE r."id" = ANY(${fileIds}::text[]) AND r."duplicate_of" IS NULL AND r."status" = 'ready'
      AND l."projectId" = r."projectId" AND l."md5Checksum" = r."md5Checksum"
      AND l."status" = 'ready' AND l."trashedAt" IS NULL AND l."duplicate_of" IS NULL
      AND NOT (l."id" = ANY(${fileIds}::text[]))`;
}

/**
 * Re-decides `duplicate_of` for each of `fileIds`, one at a time, oldest
 * first: a ready file points at the live original with its bytes in its
 * Project, or becomes the original itself when there is none. Used after
 * an original was purged or moved away: the oldest surviving duplicate is
 * promoted and the others point at it. One row at a time, so the index
 * never sees two originals.
 */
export async function resettle(db: Db, fileIds: string[]): Promise<void> {
  if (!fileIds.length) return;
  const rows = await db.mediaFile.findMany({
    where: { id: { in: fileIds }, status: 'ready' },
    select: { id: true, projectId: true, md5Checksum: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  for (const r of rows) {
    const original = await findOriginal(db, r.projectId, r.md5Checksum, r.id);
    await db.mediaFile.update({ where: { id: r.id }, data: { duplicateOfId: original?.id ?? null } });
  }
}

/**
 * Before deleting `fileIds`: rows outside the set that point at them are
 * parked on themselves (the foreign key does not cascade). Answers those
 * rows; call `resettle` with them once the delete ran.
 */
export async function detachDuplicates(db: Db, fileIds: string[]): Promise<string[]> {
  if (!fileIds.length) return [];
  const survivors = await db.mediaFile.findMany({
    where: { duplicateOfId: { in: fileIds }, id: { notIn: fileIds } },
    select: { id: true },
  });
  const ids = survivors.map((r) => r.id);
  if (ids.length) {
    await db.$executeRaw`UPDATE "media_files" SET "duplicate_of" = "id" WHERE "id" = ANY(${ids}::text[])`;
  }
  return ids;
}

/**
 * Before files move to another Project: moving files that point at a file
 * staying behind, and files staying behind that point at a moving one, are
 * parked on themselves. Answers every parked row; call `resettle` with them
 * after the move, so no reference crosses Projects and each side gets its
 * own original again.
 */
export async function detachForMove(db: Db, fileIds: string[]): Promise<string[]> {
  if (!fileIds.length) return [];
  const moving = await db.mediaFile.findMany({
    where: { id: { in: fileIds }, duplicateOfId: { not: null }, NOT: { duplicateOfId: { in: fileIds } } },
    select: { id: true },
  });
  const ids = moving.map((r) => r.id);
  if (ids.length) {
    await db.$executeRaw`UPDATE "media_files" SET "duplicate_of" = "id" WHERE "id" = ANY(${ids}::text[])`;
  }
  return [...ids, ...(await detachDuplicates(db, fileIds))];
}

/** Before deleting a whole Project: rows in other Projects that point into it are parked (see `detachDuplicates`). */
export async function detachDuplicatesOfProject(db: Db, projectId: string): Promise<string[]> {
  const survivors = await db.mediaFile.findMany({
    where: { duplicateOf: { projectId }, NOT: { projectId } },
    select: { id: true },
  });
  const ids = survivors.map((r) => r.id);
  if (ids.length) {
    await db.$executeRaw`UPDATE "media_files" SET "duplicate_of" = "id" WHERE "id" = ANY(${ids}::text[])`;
  }
  return ids;
}

/** True when `err` is the dedup index refusing a second live original. */
export function isDedupViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: Record<string, unknown>; message?: string };
  if (e?.code !== 'P2002' && e?.code !== '23505') return false;
  const text = `${JSON.stringify(e.meta ?? {})} ${e.message ?? ''}`;
  return text.includes('media_files_project_md5_ready_key') || text.includes('md5Checksum');
}

export type DuplicateCandidate = { name: string; size: number; md5?: string | null };

export type DuplicateMatch = {
  name: string;
  size: number;
  md5: string | null;
  /** `name`: same name and size (hash the file and ask again); `exact`: same bytes. */
  match: 'name' | 'exact';
  existingFileId: string;
  existingName: string;
};

/**
 * Advisory pre-upload check. Without an MD5 a candidate matches ready,
 * untrashed files of the Project with the same name and size (the client
 * then hashes only those files); with an MD5 it matches identical bytes.
 */
export async function checkDuplicates(projectId: string, candidates: DuplicateCandidate[]): Promise<DuplicateMatch[]> {
  const list = candidates.slice(0, 1000);
  const out: DuplicateMatch[] = [];
  const hashed = list.filter((c) => c.md5);
  const unhashed = list.filter((c) => !c.md5);
  if (hashed.length) {
    const rows = await prisma.mediaFile.findMany({
      where: { projectId, status: 'ready', trashedAt: null, md5Checksum: { in: hashed.map((c) => String(c.md5).toLowerCase()) } },
      select: { id: true, originalName: true, md5Checksum: true, duplicateOfId: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const c of hashed) {
      const md5 = String(c.md5).toLowerCase();
      const hit = rows.find((r) => r.md5Checksum === md5 && !r.duplicateOfId) ?? rows.find((r) => r.md5Checksum === md5);
      if (hit) out.push({ name: c.name, size: c.size, md5, match: 'exact', existingFileId: hit.id, existingName: hit.originalName });
    }
  }
  if (unhashed.length) {
    const rows = await prisma.mediaFile.findMany({
      where: {
        projectId,
        status: 'ready',
        trashedAt: null,
        OR: unhashed.map((c) => ({ originalName: c.name, size: BigInt(c.size) })),
      },
      select: { id: true, originalName: true, size: true },
    });
    for (const c of unhashed) {
      const hit = rows.find((r) => r.originalName === c.name && Number(r.size) === c.size);
      if (hit) out.push({ name: c.name, size: c.size, md5: null, match: 'name', existingFileId: hit.id, existingName: hit.originalName });
    }
  }
  return out;
}
