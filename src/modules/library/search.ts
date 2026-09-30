/**
 * Library search (Story 4.5). Search works without Elasticsearch; when it
 * is configured it only narrows the candidates, so both paths answer the
 * same rows in the same order:
 *
 *   database   case-insensitive substring of the name (PostgreSQL `lower()`
 *              on both sides), live rows only (not trashed, no trashed
 *              ancestor Section, checked in SQL), ordered by name then id,
 *              SEARCH_LIMIT rows;
 *   ES         a wildcard on the keyword `name_lower` (written with
 *              PostgreSQL `lower()`, queried with a PostgreSQL-lowered
 *              pattern) plus the project filter yields candidate ids; the
 *              database then applies exactly the same filter, order and
 *              limit to them. ES down, or more candidates than
 *              SEARCH_MAX_CANDIDATES: the database path answers.
 *
 * Sections are searched in the database only (small table). The file index
 * is kept in step on every lifecycle change through `syncSearch(fileIds)`
 * (ready, move, copy, trash, restore, purge; syncs of one file run in
 * order), the hourly sweeper reindexes when the index count drifts from
 * the database, and `npm run search:reindex` rebuilds it by hand.
 */
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { esClient } from '@/lib/elasticsearch';
import { errMessage, logger } from '@/lib/logger';
import {
  SEARCH_INDEX,
  SEARCH_LIMIT,
  SEARCH_MAPPINGS,
  SEARCH_MAX_CANDIDATES,
  likePattern,
  mappingIsCurrent,
  normalizeQuery,
  searchDocument,
  wildcardPattern,
} from './searchQuery.ts';

const log = logger('search');

type SearchInput = {
  query: string;
  projectId?: string | null;
  /** false forces the database path (parity checks); default: use the index when configured. */
  useIndex?: boolean;
};

/** Folders that are trashed or sit under a trashed Section (the trash cascade marks them, this also covers drift). */
const DEAD_FOLDERS = Prisma.sql`
  WITH RECURSIVE dead AS (
    SELECT id FROM folders WHERE "trashedAt" IS NOT NULL
    UNION
    SELECT f.id FROM folders f JOIN dead d ON f."parentId" = d.id
  )`;

/** PostgreSQL's lower() of the query, the one case fold both paths use. */
async function lowerQuery(q: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ q: string }[]>`SELECT lower(${q}) AS q`;
  return rows[0]?.q ?? q.toLowerCase();
}

/** Candidate ids from Elasticsearch, or null when the database must answer alone. */
async function esCandidates(q: string, projectId?: string | null): Promise<string[] | null> {
  const es = esClient();
  if (!es) return null;
  try {
    await ensureIndex();
    const result = await es.search({
      index: SEARCH_INDEX,
      size: SEARCH_MAX_CANDIDATES,
      _source: false,
      track_total_hits: SEARCH_MAX_CANDIDATES + 1,
      query: {
        bool: {
          filter: [
            { wildcard: { name_lower: { value: wildcardPattern(await lowerQuery(q)) } } },
            ...(projectId ? [{ term: { projectId } }] : []),
          ],
        },
      },
    });
    const total = typeof result.hits.total === 'number' ? result.hits.total : (result.hits.total?.value ?? 0);
    if (total > SEARCH_MAX_CANDIDATES) return null;
    return result.hits.hits.map((h) => String(h._id));
  } catch (err) {
    log.warn('Elasticsearch failed, using the database', { err: errMessage(err) });
    return null;
  }
}

/** Files whose name contains the query (see the module comment for the ES path). */
export async function searchFiles(input: SearchInput) {
  const q = normalizeQuery(input.query);
  if (!q) return [];
  const candidates = input.useIndex === false ? null : await esCandidates(q, input.projectId);
  if (candidates && !candidates.length) return [];
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    ${DEAD_FOLDERS}
    SELECT m.id FROM media_files m
    WHERE m."trashedAt" IS NULL
      AND m.status = 'ready'
      AND lower(m."originalName") LIKE lower(${likePattern(q)}) ESCAPE '\\'
      AND m."folderId" NOT IN (SELECT id FROM dead)
      ${input.projectId ? Prisma.sql`AND m."projectId" = ${input.projectId}` : Prisma.empty}
      ${candidates ? Prisma.sql`AND m.id = ANY(${candidates}::text[])` : Prisma.empty}
    ORDER BY m."originalName" ASC, m.id ASC
    LIMIT ${SEARCH_LIMIT}`;
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const full = await prisma.mediaFile.findMany({ where: { id: { in: ids } }, include: { folder: true, project: true } });
  const byId = new Map(full.map((f) => [f.id, f]));
  return ids.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => !!f);
}

/** Sections whose name contains the query (database only). */
export async function searchFolders(input: SearchInput) {
  const q = normalizeQuery(input.query);
  if (!q) return [];
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    ${DEAD_FOLDERS}
    SELECT f.id FROM folders f
    WHERE lower(f.name) LIKE lower(${likePattern(q)}) ESCAPE '\\'
      AND f.id NOT IN (SELECT id FROM dead)
      ${input.projectId ? Prisma.sql`AND f."projectId" = ${input.projectId}` : Prisma.empty}
    ORDER BY f.name ASC, f.id ASC
    LIMIT ${SEARCH_LIMIT}`;
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const full = await prisma.folder.findMany({ where: { id: { in: ids } }, include: { project: true } });
  const byId = new Map(full.map((f) => [f.id, f]));
  return ids.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => !!f);
}

/* ------------------------------------------------------------------ */
/* Index maintenance                                                   */
/* ------------------------------------------------------------------ */

type IndexedRow = { id: string; nameLower: string; projectId: string; folderId: string };

/** Live files (ready, not trashed, no trashed ancestor) among `ids`, names lowered by PostgreSQL. */
async function liveRows(ids: string[] | null, after?: string, take = 1000): Promise<IndexedRow[]> {
  return prisma.$queryRaw<IndexedRow[]>`
    ${DEAD_FOLDERS}
    SELECT m.id, lower(m."originalName") AS "nameLower", m."projectId", m."folderId"
    FROM media_files m
    WHERE m."trashedAt" IS NULL
      AND m.status = 'ready'
      AND m."folderId" NOT IN (SELECT id FROM dead)
      ${ids ? Prisma.sql`AND m.id = ANY(${ids}::text[])` : Prisma.empty}
      ${after ? Prisma.sql`AND m.id > ${after}` : Prisma.empty}
    ORDER BY m.id ASC
    LIMIT ${ids ? ids.length : take}`;
}

let indexReady: Promise<void> | null = null;

/**
 * Creates the index when missing; recreates and reindexes it when its
 * `name_lower` field is not a keyword (an index from an older release or
 * made by hand would silently drop results).
 */
async function ensureIndex(): Promise<void> {
  const es = esClient();
  if (!es) return;
  if (!indexReady) {
    indexReady = (async () => {
      const exists = await es.indices.exists({ index: SEARCH_INDEX });
      if (!exists) {
        await es.indices.create({ index: SEARCH_INDEX, mappings: SEARCH_MAPPINGS });
        await fillIndex();
        return;
      }
      const mapping = await es.indices.getMapping({ index: SEARCH_INDEX });
      if (!mappingIsCurrent(Object.values(mapping)[0])) {
        log.warn('index mapping is outdated: rebuilding');
        await es.indices.delete({ index: SEARCH_INDEX });
        await es.indices.create({ index: SEARCH_INDEX, mappings: SEARCH_MAPPINGS });
        await fillIndex();
      }
    })().catch((err) => {
      indexReady = null;
      throw err;
    });
  }
  return indexReady;
}

/** Sends bulk operations and logs every item that failed (first 5 in detail). */
async function bulk(operations: object[], refresh?: 'wait_for'): Promise<number> {
  const es = esClient();
  if (!es || !operations.length) return 0;
  const res = await es.bulk({ operations, ...(refresh ? { refresh } : {}) });
  if (!res.errors) return 0;
  const failed = res.items.filter((item) => {
    const op = Object.values(item)[0];
    // Deleting a document that is not indexed is fine.
    return op?.error && !(op.status === 404 && 'delete' in item);
  });
  if (failed.length) {
    log.error('bulk indexing reported errors', {
      failed: failed.length,
      items: failed.slice(0, 5).map((item) => {
        const [action, op] = Object.entries(item)[0];
        return { action, id: op?._id, status: op?.status, error: op?.error?.reason ?? op?.error?.type };
      }),
    });
  }
  return failed.length;
}

async function syncNow(fileIds: string[]): Promise<void> {
  await ensureIndex();
  for (let i = 0; i < fileIds.length; i += 500) {
    const ids = fileIds.slice(i, i + 500);
    const live = new Map((await liveRows(ids)).map((r) => [r.id, r]));
    const operations: object[] = [];
    for (const id of ids) {
      const row = live.get(id);
      if (row) operations.push({ index: { _index: SEARCH_INDEX, _id: id } }, searchDocument(row));
      else operations.push({ delete: { _index: SEARCH_INDEX, _id: id } });
    }
    await bulk(operations, 'wait_for');
  }
}

/** Last pending sync per file id: a later sync of a file always starts after the earlier one finished. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Brings the index in line with the database for these files: live ones
 * are written, everything else is removed. Syncs of the same file run one
 * after the other, so an older snapshot never lands last. Best effort: a
 * failure is logged and never fails the caller.
 */
export async function syncSearch(fileIds: string[]): Promise<void> {
  if (!esClient() || !fileIds.length) return;
  const ids = [...new Set(fileIds)];
  const before = [...new Set(ids.map((id) => inFlight.get(id)).filter((p): p is Promise<void> => !!p))];
  const run = Promise.allSettled(before)
    .then(() => syncNow(ids))
    .catch((err) => log.warn('index update failed', { count: ids.length, err: errMessage(err) }));
  for (const id of ids) inFlight.set(id, run);
  await run;
  for (const id of ids) if (inFlight.get(id) === run) inFlight.delete(id);
}

/** Fire-and-forget form for request paths. */
export function syncSearchLater(fileIds: string[]): void {
  if (!fileIds.length || !esClient()) return;
  void syncSearch(fileIds);
}

/** Writes every live file into the (existing, empty) index. Answers the number of documents. */
async function fillIndex(): Promise<number> {
  const es = esClient();
  if (!es) return 0;
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await liveRows(null, cursor);
    if (!rows.length) break;
    const failed = await bulk(rows.flatMap((r) => [{ index: { _index: SEARCH_INDEX, _id: r.id } }, searchDocument(r)]));
    if (failed) throw new Error(`bulk indexing failed for ${failed} documents`);
    count += rows.length;
    cursor = rows[rows.length - 1].id;
  }
  await es.indices.refresh({ index: SEARCH_INDEX });
  return count;
}

/** Rebuilds the index from the database (`npm run search:reindex`). Answers the number of documents. */
export async function reindexSearch(): Promise<number> {
  const es = esClient();
  if (!es) throw new Error('ELASTICSEARCH_NODE_URL is not set');
  if (await es.indices.exists({ index: SEARCH_INDEX })) await es.indices.delete({ index: SEARCH_INDEX });
  await es.indices.create({ index: SEARCH_INDEX, mappings: SEARCH_MAPPINGS });
  indexReady = Promise.resolve();
  return fillIndex();
}

/**
 * Sweeper check (hourly, under the sweeper lock): when the index holds a
 * different number of documents than the database has live files, the
 * index is rebuilt. Answers what was found; never throws.
 */
export async function checkSearchIndex(): Promise<{ checked: boolean; indexed?: number; live?: number; reindexed?: number }> {
  const es = esClient();
  if (!es) return { checked: false };
  try {
    await ensureIndex();
    await es.indices.refresh({ index: SEARCH_INDEX });
    const indexed = (await es.count({ index: SEARCH_INDEX })).count;
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      ${DEAD_FOLDERS}
      SELECT count(*) AS n FROM media_files m
      WHERE m."trashedAt" IS NULL AND m.status = 'ready' AND m."folderId" NOT IN (SELECT id FROM dead)`;
    const live = Number(rows[0]?.n ?? 0);
    if (indexed === live) return { checked: true, indexed, live };
    log.warn('index count differs from the database: reindexing', { indexed, live });
    return { checked: true, indexed, live, reindexed: await reindexSearch() };
  } catch (err) {
    log.error('index check failed', { err: errMessage(err) });
    return { checked: false };
  }
}
