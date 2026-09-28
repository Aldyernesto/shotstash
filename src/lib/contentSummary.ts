// Story 2.4 (client side): the content summary from the raw per-bucket
// counts of GraphQL `contentSummary`. The server only sends numbers; word
// order and wording belong to the client, so this one module decides which
// buckets appear and in what order. The words come from the `content`
// message namespace (ICU plurals), applied by the caller: src/lib cannot
// import the i18n layer.

export type ContentSummary = {
  photos?: number | null;
  videos?: number | null;
  documents?: number | null;
  total?: number | null;
};

export type ContentKind = "photos" | "videos" | "documents";

export type ContentPart = { kind: ContentKind; count: number };

const BUCKETS: ContentKind[] = ["photos", "videos", "documents"];

/**
 * Non-empty buckets. A bucket with 0 is never written ("18 documents ·
 * 7 videos", not "... · 0 photos").
 * @param largestFirst true = largest count first (card sentence);
 *   false = fixed order photos, videos, documents (page-head subtitle).
 */
export function contentSummaryParts(
  summary?: ContentSummary | null,
  largestFirst = false,
): ContentPart[] {
  if (!summary) return [];
  const rows = BUCKETS.map((kind) => ({ kind, count: Number(summary[kind] ?? 0) || 0 })).filter(
    (row) => row.count > 0,
  );
  if (largestFirst) rows.sort((a, b) => b.count - a.count);
  return rows;
}
