import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Story 3.1: next-intl without locale routing; request config in
// src/i18n/request.ts (locale from cookie, DEFAULT_LOCALE, then en).
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Next 16 blocks 127.0.0.1 as a cross-origin dev host: the page stops at
  // "Loading…" with no message because hydration never finishes. Allow both
  // so localhost and 127.0.0.1 work.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  // Pin the project root explicitly (Next docs: turbopack.md, "Root
  // directory"): when another package-lock.json exists in a parent folder
  // (for example the user's home), Next 16 guesses the wrong root and every
  // route, /api included, answers 404 in dev and build. Anchored to this
  // config file's folder rather than cwd; cwd is only a fallback when
  // __dirname is unavailable.
  turbopack: { root: typeof __dirname !== "undefined" ? __dirname : process.cwd() },
};

export default withNextIntl(nextConfig);
