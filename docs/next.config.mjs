// Docs site (Story 7.1): a static export deployed to GitHub Pages.
// Reads only committed files and its own build settings (lib/repository.mjs);
// never the app's code, Prisma client or environment.
import { createMDX } from 'fumadocs-mdx/next';
import { site } from './lib/repository.mjs';

const withMDX = createMDX();
const s = site();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  trailingSlash: true,
  basePath: s.basePath,
  images: { unoptimized: true },
  turbopack: { root: import.meta.dirname },
  outputFileTracingRoot: import.meta.dirname,
  // Inlined at build time (the app itself has no public build-time variables).
  env: {
    DOCS_BASE_PATH: s.basePath,
    DOCS_REPOSITORY: s.repo,
    DOCS_SITE_URL: s.url,
    // Story 8.2: the public demo's origin; empty means no try-it console.
    DOCS_DEMO_ORIGIN: s.demoOrigin,
  },
};

export default withMDX(config);
