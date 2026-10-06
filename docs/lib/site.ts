/**
 * Site facts, fixed at build time by next.config.mjs. The repository comes from
 * GitHub Actions (or the root package.json), so a move to another owner or an
 * organisation needs no change here.
 */
export const basePath = process.env.DOCS_BASE_PATH ?? '';
export const repository = process.env.DOCS_REPOSITORY ?? '';
export const repoUrl = `https://github.com/${repository}`;
export const productName = 'Shotstash';
export const tagline = 'Self-hosted media cloud for creators. Your footage, your hardware, your cloud.';

/** Prefix a path inside `public/` with the base path (plain <img> and fetch URLs). */
export function asset(path: string): string {
  return `${basePath}${path}`;
}

/** A file in the repository on GitHub (main branch). */
export function sourceUrl(path: string): string {
  return `${repoUrl}/blob/main/${path.replace(/^\/+/, '')}`;
}
