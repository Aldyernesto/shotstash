<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-on-dark.svg">
  <img src="public/brand/logo-on-light.svg" alt="Shotstash" height="56">
</picture>

# Shotstash

[![CI](https://github.com/Aldyernesto/shotstash/actions/workflows/pr.yml/badge.svg?branch=main)](https://github.com/Aldyernesto/shotstash/actions/workflows/pr.yml)

**Self-hosted media cloud for creators. Your footage, your hardware, your cloud.**

Shotstash turns the PC, NAS, or spare drive you already own into a media cloud built for work: projects and sections instead of a flat photo stream, a viewer that respects portrait video, resumable chunked uploads straight from the browser, share links you can hand to a client, and roles for the people you work with. All of it behind a dark, deliberately premium UI.

> **Status: pre-release.** The core has been extracted from a production media library (thousands of files, in daily use since 2026) into this repository with a clean history. The security pass, Docker setup and docs land over the next days. Watch or star the repo to follow the first public release.

## Why not Immich / PhotoPrism / a DAM?

- Immich, PhotoPrism and Ente are personal photo libraries: great for your phone's camera roll, not for delivering project footage to a client.
- Enterprise DAMs (ResourceSpace, Pimcore) are heavy, dated, and built for procurement, not for a two-person studio.
- Video review tools (Clapshot, FreeFrame) review clips; they do not store and share a whole library.

Shotstash sits in the gap: **video-first storage and sharing for creators and small teams**, on hardware you already have.

## What you get (v1 scope)

- **Projects → Sections → Files** with 3D folder cards, grid and list views, sort and search.
- **Uploads that survive bad Wi-Fi**: chunked, resumable, parallel; local disk, NAS mount, or any S3-compatible bucket (Cloudflare R2 supported).
- **Viewer** for photos and video that follows the file's real aspect ratio, custom video controls, keyboard navigation, an info panel with dimensions and duration.
- **Share links** per file, section or project, public or private, with a clean client page and ZIP download.
- **Roles and onboarding**: super admin, admin, crew, editor, viewer; account approval; email password reset.
- **API**: GraphQL over HTTP and WebSocket (documented from the schema), plus REST routes for upload, ranged download and sharing (OpenAPI).
- **Bring your own AI**: a small job-pipeline contract (queue, worker heartbeat, progress, finalize) so you can plug in your own model or worker for proxy transcodes, transcription or scene detection. A reference worker is included.
- **One-command install** with Docker Compose.

## Stack

Next.js 16 · React 19 · TypeScript · Apollo GraphQL + graphql-ws · Prisma 7 · PostgreSQL · Dragonfly/Redis · ffmpeg + sharp · Docker.

## Roadmap to the first public release

1. Clean extraction of the core from the production codebase (new history, generic branding, env-driven config). Done.
2. Security review of every public route before the code is readable by the world.
3. Docker Compose, `.env.example`, and a 10-minute quick start.
4. Docs site: install, storage and networking, API reference, bring-your-own-AI guide, user guide.
5. Public demo instance and launch.

## Development

Requires Node.js 24.

```bash
npm install
cp .env.example .env   # set SESSION_SECRET and MEDIA_SIGNING_SECRET (openssl rand -hex 32)
npx prisma generate
npm run dev:db      # embedded PostgreSQL (PGlite) on port 55433; keep it running
npx prisma migrate deploy   # in a second terminal: apply the migrations
npm run dev:seed    # then create the development accounts (refuses NODE_ENV=production)
npm run dev         # app on http://localhost:3005
```

A fresh install without the seed starts at `/setup`: until the first super admin exists, every page redirects there and `/api/*` and `/media/*` answer `503 SETUP_REQUIRED`. The wizard checks that the storage folder (`STORAGE_LOCAL_ROOT`) is writable and creates the owner account. Whoever submits it first becomes the super admin: set `SETUP_TOKEN` (the form then asks for it) or finish setup before exposing the instance. `GET /api/health` answers `{ ok, setupRequired }`; from the server itself (loopback) or with a super admin session it also reports version, database, cache, storage and `schemeMismatch`.

Demo instances: after setup, `SHOTSTASH_DEMO_MODE=true DEMO_ADMIN_PASSWORD=... npm run demo:seed` adds read-only demo accounts and a sample project. Trashed items are deleted for good after `TRASH_RETENTION_DAYS` (default 30) by an hourly sweeper.

Before you push, run the same checks CI runs:

```bash
npx prisma generate
npm run lint
npm run typecheck
npm run check:tokens && npm run check:legacy && npm run brand:css -- --check
npm run security:matrix -- --check    # docs/security/route-matrix.md matches the code
npm test
node scripts/privacy-scan.mjs --all   # uses gitleaks when installed
npm run build
```

Local end-to-end checks (not in CI). First-run setup on an empty database: `npm run dev:db:reset`, `npm run dev:db`, `npx prisma migrate deploy`, `npm run dev`, then `npm run e2e:setup` (gate redirect and 503, setup, concurrent 409, redirect after setup). Security: with `npm run dev:db`, `npx prisma migrate deploy`, `npx tsx prisma/seed.ts` and `npm run dev` running, `npm run e2e:security` exercises login, cookie media, signed shares, access codes, role checks, rate limits, security headers, health and the trash lifecycle (start the server with `EMAIL_TRANSPORT=log` to include the reset-limit rows; login limits mean a second run needs 15 minutes or a server restart) against `http://localhost:3005` (override with `E2E_BASE_URL`). Both refuse to run unless the base URL and `DATABASE_URL` point at localhost, and they write test data into that database.

Every route handler is wrapped in `defineRoute({ auth })` and every GraphQL root field has an entry in `src/graphql/auth-map.ts`; the generated table lives in [docs/security/route-matrix.md](docs/security/route-matrix.md). Media bytes are served only under `/media/*` with an HttpOnly session cookie or a signed share URL; `MEDIA_SIGNING_SECRET` signs those URLs.

Product name, logo and brand colors live in `src/lib/brand.ts`. The identity is blue: the three-bar mark (`#3d6cff`) and a UI accent family (`accent` `#3563f2` with white text) documented in [docs/design/DESIGN.md](docs/design/DESIGN.md). To rebrand: edit `src/lib/brand.ts`, replace the SVG sources in `public/brand/` (`icon.svg`, `logo-on-dark.svg`, `logo-on-light.svg`, `og.svg`), run `npm run brand:assets` (copies the favicon to `src/app/icon.svg` and renders `logo.png`, `og.png` and `src/app/apple-icon.png` with sharp), then `npm run brand:css`.

## License

MIT. See [LICENSE](LICENSE).
