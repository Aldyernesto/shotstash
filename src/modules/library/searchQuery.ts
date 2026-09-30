/**
 * Search query shape (Story 4.5), shared by the database path and the
 * Elasticsearch candidate path so both answer identical results:
 *
 *   - case-insensitive substring of the name (the whole query, trimmed,
 *     wildcards taken literally);
 *   - ordered by name, then id; at most SEARCH_LIMIT rows.
 *
 * Pure and alias-free: tests import it directly.
 */

/** Rows answered by one search. */
export const SEARCH_LIMIT = 50;
/** Longest query accepted (longer input is cut). */
export const SEARCH_MAX_QUERY = 200;
/** Candidate ids asked from Elasticsearch; above this the database answers alone. */
export const SEARCH_MAX_CANDIDATES = 10_000;
/** Elasticsearch index of files (one document per ready, untrashed file). */
export const SEARCH_INDEX = 'media_files';

/** Trimmed, length-capped query; null when there is nothing to search for. */
export function normalizeQuery(query: unknown): string | null {
  if (typeof query !== 'string') return null;
  const q = query.trim().slice(0, SEARCH_MAX_QUERY);
  return q ? q : null;
}

/** Escapes LIKE wildcards (`%`, `_`) and the escape character itself. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Escapes Elasticsearch wildcard syntax (`*`, `?`, `\`). */
export function escapeWildcard(value: string): string {
  return value.replace(/[\\*?]/g, (c) => `\\${c}`);
}

/**
 * The Elasticsearch wildcard pattern for a query that PostgreSQL already
 * lowered (`lower()`): the index stores names lowered by PostgreSQL too, so
 * both paths fold case identically.
 */
export function wildcardPattern(loweredQuery: string): string {
  return `*${escapeWildcard(loweredQuery)}*`;
}

/** LIKE pattern (escaped, unanchored) for the database path; PostgreSQL lowers it. */
export function likePattern(query: string): string {
  return `%${escapeLike(query)}%`;
}

/** The document stored for one file; `nameLower` comes from PostgreSQL `lower()`. */
export function searchDocument(file: { nameLower: string; projectId: string; folderId: string }) {
  return { name_lower: file.nameLower, projectId: file.projectId, folderId: file.folderId };
}

/** True when an index mapping has `name_lower` as a keyword (what the wildcard needs). */
export function mappingIsCurrent(mapping: unknown): boolean {
  const props = (mapping as { mappings?: { properties?: Record<string, { type?: string }> } })?.mappings?.properties;
  return props?.name_lower?.type === 'keyword';
}

/** Index mapping: a lowercase keyword for the wildcard, keywords for filters. */
export const SEARCH_MAPPINGS = {
  properties: {
    name_lower: { type: 'keyword' },
    projectId: { type: 'keyword' },
    folderId: { type: 'keyword' },
  },
} as const;
