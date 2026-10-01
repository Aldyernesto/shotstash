/**
 * Story 5.5: read-time filter of notifications. A notification about a
 * Project is shown only while that Project exists and its reader may view
 * it; notifications without a Project are always the reader's own.
 *
 * Pure and alias-free: `node --test` imports it directly.
 */
export function visibleNotifications<T extends { projectId?: string | null }>(rows: readonly T[], viewableProjectIds: ReadonlySet<string>): T[] {
  return rows.filter((r) => !r.projectId || viewableProjectIds.has(r.projectId));
}
