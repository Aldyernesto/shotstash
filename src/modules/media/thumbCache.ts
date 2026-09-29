/**
 * Cache policy of `/media/t/:fileId?v=<n>` (Story 4.4): the URL of the
 * current thumbnail version never changes content, so it is cached for a
 * year (`immutable`); any other `v` (or none) gets the short policy.
 * Pure: tests import it directly.
 */
export function thumbnailCacheFor(currentVersion: number, requested: string | null): 'immutable' | 'cookie' {
  if (!currentVersion || requested === null || !/^\d{1,9}$/.test(requested)) return 'cookie';
  return Number(requested) === currentVersion ? 'immutable' : 'cookie';
}
