# r/selfhosted

Read the subreddit rules on the day you post (they change) and use the flair they ask for. Post from the maintainer account, answer comments for the first few hours, and never post on the same day as Show HN (see [schedule.md](schedule.md)).

## Title

Shotstash: a self-hosted media cloud for creators. Projects, resumable uploads, client share links, MIT

## Body

Hi r/selfhosted. I have been building Shotstash, a media cloud for creators that runs on hardware you already own. Your footage, your hardware, your cloud.

It is aimed at people who shoot video for work, alone or in a small team, and need somewhere to put footage and hand it to a client. It is not a photo backup for your phone (Immich, PhotoPrism and Ente do that well), and it is not a heavy enterprise DAM.

**What you get**

- Projects and sections, grid and list views, search
- Resumable chunked uploads in the browser (they survive bad Wi-Fi, reloads and dropped connections), checksum-verified, duplicate detection per project
- A viewer that follows the real aspect ratio, so portrait video looks right
- Share links per file, section or project, public or with an access code, ZIP download
- Roles: admin, crew, editor, viewer, with account approval
- Storage on a local disk, a NAS mount, or any S3-compatible bucket (MinIO, R2, RustFS, SeaweedFS, AWS)
- Bring your own AI: a small HTTP worker contract for proxies, transcription or scene detection; a 720p proxy worker is included
- GraphQL and REST APIs, both fully documented

**Install**

    git clone https://github.com/Aldyernesto/shotstash.git && cd shotstash && sh docker/init.sh && docker compose up -d

The init script writes `.env` with random secrets and checks your machine first; Compose then pulls the published images (amd64 and arm64), so nothing builds on your machine. The app, PostgreSQL, Dragonfly and the worker run in Compose; only the app port is published. Linux x64 first, arm64 best effort, about 2 GB of RAM.

**Links**

- Repository: https://github.com/Aldyernesto/shotstash
- Docs: https://aldyernesto.github.io/shotstash/
- Read-only demo (resets every night): https://demostash.aldyernesto.my.id

Born in production: it has run a real media library with thousands of files every day since 2026.

MIT licensed. No paid tier, no locked features, nothing held back. No telemetry.

What is missing: no mobile app in v1, and it is not a frame-accurate review tool. Feedback and bug reports are very welcome, especially from anyone running it behind a reverse proxy or on a NAS.
