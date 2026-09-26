# Shotstash

**Self-hosted media cloud for creators. Your footage, your hardware, your cloud.**

Shotstash turns the PC, NAS, or spare drive you already own into a media cloud built for work: projects and sections instead of a flat photo stream, a viewer that respects portrait video, resumable chunked uploads straight from the browser, share links you can hand to a client, and roles for the people you work with. All of it behind a dark, deliberately premium UI.

> **Status: pre-release.** The code is being extracted from a production media library (thousands of files, in daily use since 2026) into this public repository with a clean history. Watch or star the repo to follow the first public release.

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
- **Roles and onboarding**: super admin, admin, crew, editor, agent; account approval; email password reset.
- **API**: GraphQL over HTTP and WebSocket (documented from the schema), plus REST routes for upload, ranged download and sharing (OpenAPI).
- **Bring your own AI**: a small job-pipeline contract (queue, worker heartbeat, progress, finalize) so you can plug in your own model or worker for blurring, transcription or scene detection. A reference worker is included.
- **One-command install** with Docker Compose.

## Stack

Next.js 16 · React 19 · TypeScript · Apollo GraphQL + graphql-ws · Prisma 7 · PostgreSQL · Dragonfly/Redis · ffmpeg + sharp · Docker.

## Roadmap to the first public release

1. Clean extraction of the core from the production codebase (new history, generic branding, env-driven config).
2. Security review of every public route before the code is readable by the world.
3. Docker Compose, `.env.example`, and a 10-minute quick start.
4. Docs site: install, storage and networking, API reference, bring-your-own-AI guide, user guide.
5. Public demo instance and launch.

## License

MIT. See [LICENSE](LICENSE).
