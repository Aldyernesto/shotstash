# Show HN

Post on a weekday morning, US Eastern time (see [schedule.md](schedule.md)). Link to the repository, not the docs, so the README does the talking. Stay in the thread for the first three hours and answer every question.

## Title

Show HN: Shotstash, a self-hosted media cloud for creators (video-first, MIT)

Under 80 characters. No superlatives, no "alternative to" phrasing.

## URL

https://github.com/Aldyernesto/shotstash

## First comment (post right after submitting)

Hi HN. Shotstash turns a PC, NAS or spare drive you already own into a media cloud for footage. Your footage, your hardware, your cloud.

I built it because the self-hosted options I tried did not fit work footage. Immich, PhotoPrism and Ente are great personal photo libraries, but they are built around a phone's camera roll. Enterprise DAMs like ResourceSpace and Pimcore are heavy. Review tools like Clapshot and FreeFrame review clips; they do not store and share a whole library. I wanted something in between for creators and small teams.

What it does:

- Projects and sections instead of one long photo stream.
- Resumable chunked uploads from the browser that survive bad Wi-Fi and reloads, checksum-verified, with duplicate detection.
- A viewer that respects portrait video and the file's real aspect ratio.
- Share links per file, section or project, public or with an access code, with a clean client page and ZIP download.
- Roles for the people you work with.
- Local disk, a NAS mount or any S3-compatible bucket.
- A small worker contract, so you can plug in your own model or script for proxies, transcription or scene detection. A reference worker that makes 720p proxies on request is included.

Born in production: it started as the media system a working team uses every day, and this repository is a clean extraction of that code, which is why the history is short.

Install is one line with Docker Compose:

    git clone https://github.com/Aldyernesto/shotstash.git && cd shotstash && sh docker/init.sh && docker compose up -d

It pulls the published images (amd64 and arm64), so nothing is built on your machine. On a clean Docker host it goes from clone to a healthy app in about three minutes.

There is a read-only demo at https://demostash.aldyernesto.my.id (it resets every night) and docs at https://aldyernesto.github.io/shotstash/.

What it is not: not a Frame.io-style review tool, not a camera-roll backup, and there is no mobile app in v1.

MIT licensed. No paid tier, no locked features, nothing held back. No telemetry either.

Stack: Next.js, TypeScript, GraphQL, PostgreSQL, Dragonfly, ffmpeg. CI runs about 370 tests plus end-to-end suites for per-role authorization, resumable uploads, backup and restore, the worker contract, S3 storage and ZIP downloads above 4 GiB, on every change.

I would love to hear what breaks, and what you would want a worker to do.

## Answers to have ready

- **Why not Immich?** Immich is a great photo library for your phone. Shotstash is organised around projects you deliver to someone else, and video comes first.
- **Why not a plain file share?** A file share stores files. Shotstash knows media: thumbnails, a real viewer, proxies, client share pages.
- **Is there a hosted version or a paid plan?** No. Everything is in the repository under MIT.
- **Mobile app?** Not in v1. The web app works in a phone browser.
- **Hardware?** Linux x64 is the primary platform; arm64 images are built on a best-effort basis. About 2 GB of memory.
- **AI?** Nothing runs by default and nothing leaves your server. The worker contract lets you bring your own.
- **Why not Nextcloud or Seafile?** They are general file sync. Shotstash is narrower: it knows video (thumbnails, proxies, a viewer that keeps portrait clips portrait) and it shares a clean client page instead of a folder listing.
- **Why not Jellyfin or Plex?** They play finished media. Shotstash is the working library before that: uploads from the field, projects, roles and share links for clients.
- **The repository is two weeks old. Will it be maintained?** The code is older than the repository: it was extracted from a production system I still run and depend on, and that system takes its updates from here. Every release is tagged with a changelog, and backup and restore is rehearsed in CI.
- **What happens to my files if the project dies?** Originals are stored untouched on your disk or bucket, and the database is plain PostgreSQL. A `pg_dump` plus the media folder is a complete backup; the restore procedure is documented and tested.
- **Is uploading huge files safe?** Uploads go in chunks, resume after a dropped connection or a reload, and are checksum-verified before they count as done.
