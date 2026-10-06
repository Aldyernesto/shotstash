/**
 * Site facts, fixed at build time by next.config.mjs (from lib/repository.mjs).
 * The repository comes from GitHub Actions (or the root package.json), so a
 * move to another owner or an organisation needs no change here.
 */
export const basePath = process.env.DOCS_BASE_PATH ?? '';
export const repository = process.env.DOCS_REPOSITORY ?? '';
/** Public address of the site, with a trailing slash. */
export const siteUrl = process.env.DOCS_SITE_URL ?? 'http://localhost:3100/';
export const repoUrl = `https://github.com/${repository}`;
/** Origin of the public demo (DEMO_ORIGIN at build time); empty: no try-it console. */
export const demoOrigin = process.env.DOCS_DEMO_ORIGIN ?? '';
export const productName = 'Shotstash';
export const tagline = 'Self-hosted media cloud for creators. Your footage, your hardware, your cloud.';

/** Prefix a path inside `public/` with the base path (plain <img> and fetch URLs). */
export function asset(path: string): string {
  return `${basePath}${path}`;
}
