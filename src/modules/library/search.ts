/**
 * Library search (Story 4.5). Search works without Elasticsearch; when it
 * is configured it only narrows the candidates, so both paths answer the
 * same rows in the same order:
 *
 *   database   case-insensitive substring of the name, live rows only,
 *              ordered by name then id, SEARCH_LIMIT rows;
 *   ES         a wildcard on the lowercase keyword `name_lower` (plus the
 *              project filter) yields candidate ids; the database then
 *              applies exactly the same filter, order and limit to them.
 *              ES down, or more candidates than SEARCH_MAX_CANDIDATES:
 *              the database path answers.
 *
 * Sections are searched in the database only (small table). The file index
 * is kept in step on every lifecycle change through `syncSearch(fileIds)`
 * (ready, move, trash, restore, purge); `npm run search:reindex` rebuilds
 * it for existing data.
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { esClient } from '@/lib/elasticsearch';
import { errMessage, logger } from '@/lib/logger';
import { folderChainTrashed } from '@/lib/shareLink';
import {
  SEARCH_INDEX,
  SEARCH_LIMIT,
  SEARCH_MAPPINGS,
  SEARCH_MAX_CANDIDATES,
  escapeLike,
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

function fileWhere(q: string, projectId?: string | null): Prisma.MediaFileWhereInput {
  return {
    originalName: { contains: escapeLike(q), mode: 'insensitive' },
    trashedAt: null,
    status: 'ready',
    ...(projectId ? { projectId } : {}),
  };
}

/** Candidate ids from Elasticsearch, or null when the database must answer alone. */
async function esCandidates(q: string, projectId?: string | null): Promise<string[] | null> {
  const es = esClient();
  if (!es) return null;
  try {
    const result = await es.search({
      index: SEARCH_INDEX,
      size: SEARCH_MAX_CANDIDATES,
      _source: false,
      track_total_hits: SEARCH_MAX_CANDIDATES + 1,
      query: {
        bool: {
          filter: [
            { wildcard: { name_lower: { value: wildcardPattern(q) } } },
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
  const where = fileWhere(q, input.projectId);
  const rows = await prisma.mediaFile.findMany({
    where: candidates ? { AND: [where, { id: { in: candidates } }] } : where,
    orderBy: [{ originalName: 'asc' }, { id: 'asc' }],
    // A file inside a trashed Section is filtered below: read a little more.
    take: SEARCH_LIMIT * 2,
    include: { folder: true, project: true },
  });
  const live = [];
  for (const row of rows) {
    if (row.folder.trashedAt || (await folderChainTrashed(row.folder.parentId))) continue;
    live.push(row);
    if (live.length === SEARCH_LIMIT) break;
  }
  return live;
}

/** Sections whose name contains the query (database only). */
export async function searchFolders(input: SearchInput) {
  const q = normalizeQuery(input.query);
  if (!q) return [];
  const rows = await prisma.folder.findMany({
    where: {
      name: { contains: escapeLike(q), mode: 'insensitive' },
      trashedAt: null,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: SEARCH_LIMIT * 2,
    include: { project: true },
  });
  const live = [];
  for (const row of rows) {
    if (await folderChainTrashed(row.parentId)) continue;
    live.push(row);
    if (live.length === SEARCH_LIMIT) break;
  }
  return live;
}

/* ------------------------------------------------------------------ */
/* Index maintenance                                                   */
/* ------------------------------------------------------------------ */

let indexReady: Promise<void> | null = null;

async function ensureIndex(): Promise<void> {
  const es = esClient();
  if (!es) return;
  if (!indexReady) {
    indexReady = (async () => {
      const exists = await es.indices.exists({ index: SEARCH_INDEX });
      if (!exists) await es.indices.create({ index: SEARCH_INDEX, mappings: SEARCH_MAPPINGS });
    })().catch((err) => {
      indexReady = null;
      throw err;
    });
  }
  return indexReady;
}

/**
 * Brings the index in line with the database for these files: live ones
 * (ready, not trashed) are written, everything else is removed. Best
 * effort: a failure is logged and never fails the caller.
 */
export async function syncSearch(fileIds: string[]): Promise<void> {
  const es = esClient();
  if (!es || !fileIds.length) return;
  try {
    await ensureIndex();
    for (let i = 0; i < fileIds.length; i += 500) {
      const ids = fileIds.slice(i, i + 500);
      const rows = await prisma.mediaFile.findMany({
        where: { id: { in: ids } },
        select: { id: true, originalName: true, projectId: true, folderId: true, trashedAt: true, status: true },
      });
      const live = new Map(rows.filter((r) => !r.trashedAt && r.status === 'ready').map((r) => [r.id, r]));
      const operations: object[] = [];
      for (const id of ids) {
        const row = live.get(id);
        if (row) operations.push({ index: { _index: SEARCH_INDEX, _id: id } }, searchDocument(row));
        else operations.push({ delete: { _index: SEARCH_INDEX, _id: id } });
      }
      await es.bulk({ operations, refresh: 'wait_for' });
    }
  } catch (err) {
    log.warn('index update failed', { count: fileIds.length, err: errMessage(err) });
  }
}

/** Fire-and-forget form for request paths. */
export function syncSearchLater(fileIds: string[]): void {
  if (!fileIds.length || !esClient()) return;
  void syncSearch(fileIds);
}

/** Rebuilds the index from the database (`npm run search:reindex`). Answers the number of documents. */
export async function reindexSearch(): Promise<number> {
  const es = esClient();
  if (!es) throw new Error('ELASTICSEARCH_NODE_URL is not set');
  if (await es.indices.exists({ index: SEARCH_INDEX })) await es.indices.delete({ index: SEARCH_INDEX });
  await es.indices.create({ index: SEARCH_INDEX, mappings: SEARCH_MAPPINGS });
  indexReady = Promise.resolve();
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.mediaFile.findMany({
      where: { trashedAt: null, status: 'ready' },
      select: { id: true, originalName: true, projectId: true, folderId: true },
      orderBy: { id: 'asc' },
      take: 1000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    const operations = rows.flatMap((r) => [{ index: { _index: SEARCH_INDEX, _id: r.id } }, searchDocument(r)]);
    const res = await es.bulk({ operations });
    if (res.errors) throw new Error('bulk indexing reported errors');
    count += rows.length;
    cursor = rows[rows.length - 1].id;
  }
  await es.indices.refresh({ index: SEARCH_INDEX });
  return count;
}
