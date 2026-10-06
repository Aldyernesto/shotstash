// Docs site (Story 7.1): a static export deployed to GitHub Pages.
// Reads only committed files and its own build settings below; never the app's
// code, Prisma client or environment.
import { readFileSync } from 'node:fs';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** Repository `owner/name`: from GitHub Actions, else from the root package.json. */
function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.repository?.url ?? '');
  if (!match) throw new Error('docs: cannot derive the repository from package.json');
  return match[1];
}

/** "/repo" for a project site, "" at a domain root. Always without a trailing slash. */
function basePath() {
  const raw = (process.env.DOCS_BASE_PATH ?? '').trim();
  if (raw === '' || raw === '/') return '';
  const value = raw.startsWith('/') ? raw : `/${raw}`;
  return value.replace(/\/+$/, '');
}

const repo = repository();
const base = basePath();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  trailingSlash: true,
  basePath: base,
  images: { unoptimized: true },
  turbopack: { root: import.meta.dirname },
  outputFileTracingRoot: import.meta.dirname,
  // Inlined at build time (no NEXT_PUBLIC_ variables in this repository).
  env: {
    DOCS_BASE_PATH: base,
    DOCS_REPOSITORY: repo,
  },
};

export default withMDX(config);
