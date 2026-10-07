# Configuration

<!-- Generated from src/lib/config.ts by `npm run env:example`. Do not edit by hand. -->

Shotstash reads its whole configuration from environment variables when the
server starts. There are no build-time settings: change a value in `.env`
and restart (`docker compose up -d`); nothing needs a rebuild.

At startup the server checks every variable and refuses to start when one
is wrong, listing each bad variable by name. Values are checked for shape
only (a number, a URL, a long enough secret); whether the database, cache
and storage are reachable is reported by `/api/health` and the setup page.

Naming: product settings start with `SHOTSTASH_`; infrastructure and
secrets keep their usual names (`DATABASE_URL`, `SESSION_SECRET`).

Secrets: generate each with `openssl rand -hex 32`.

The browser reads the public part of this configuration (app URL, Google
client id, enabled features, version, default language) from
`GET /api/v1/config`.

## Server

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `NODE_ENV` |  |  | development, production or test. The Docker image sets production; leave unset for local development. |
| `PORT` | `3005` |  | Port the server listens on inside the machine or container. |
| `APP_URL` |  |  | Public URL of this installation (the address people open: LAN IP or domain), used in emails and share links. Defaults to http://localhost:<PORT> (with docker compose: http://localhost:<SHOTSTASH_PORT>). /api/health reports schemeMismatch when this says https but requests arrive as http. |
| `TRUST_PROXY` | `false` |  | Set to true ONLY when the app is reachable exclusively through a reverse proxy (Cloudflare, nginx) that sets cf-connecting-ip, x-forwarded-for and x-forwarded-proto. Otherwise clients could spoof those headers. |
| `SHOTSTASH_CORS_ORIGINS` |  |  | Comma-separated exact origins (scheme://host[:port], no path, never a wildcard) allowed to call /api/* from a browser, without credentials. Empty: no cross-origin access. A public demo sets the docs origin here for the try-it console. |
| `LOG_LEVEL` | `info` |  | fatal, error, warn, info, debug, trace or silent. Logs are JSON lines on stdout. |

## Database

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` |  | yes | PostgreSQL connection string. Local development: `npm run dev:db` starts an embedded PGlite server on port 55433. docker compose sets this for the app container itself. |

## Secrets

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `SESSION_SECRET` |  | yes | Signs sessions and password reset codes. At least 32 characters. Secret. |
| `MEDIA_SIGNING_SECRET` |  |  | Signs share media URLs, share access cookies and access codes. Falls back to SESSION_SECRET when empty. Secret. |
| `SETUP_TOKEN` |  |  | Recommended on any reachable host. While first-run setup is open, whoever submits /setup first becomes the super admin; with SETUP_TOKEN set the form requires it. Secret. |

## Storage

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `STORAGE_BACKEND` | `local` |  | local (a directory, STORAGE_LOCAL_ROOT) or s3 (any S3-compatible bucket: AWS S3, Cloudflare R2, MinIO, RustFS, SeaweedFS). One backend per installation; switching later is a copy procedure (docs/storage.md). |
| `STORAGE_LOCAL_ROOT` | `./data/media` |  | local backend: directory for originals, thumbnails, covers and upload parts (any path, including a NAS mount). The Docker image uses /data/media. |
| `S3_ENDPOINT` |  |  | s3 backend: endpoint URL, such as https://<account>.r2.cloudflarestorage.com or http://minio:9000. Empty for AWS S3. |
| `S3_REGION` | `us-east-1` |  | s3 backend: region. R2 uses auto; MinIO and RustFS accept us-east-1. |
| `S3_BUCKET` |  |  | s3 backend: bucket name (required with STORAGE_BACKEND=s3). Keep the bucket private. |
| `S3_ACCESS_KEY_ID` |  |  | s3 backend: access key id (required with STORAGE_BACKEND=s3). |
| `S3_SECRET_ACCESS_KEY` |  |  | s3 backend: secret access key (required with STORAGE_BACKEND=s3). Secret. |
| `S3_FORCE_PATH_STYLE` | `false` |  | s3 backend: true for servers that need path-style URLs (MinIO, RustFS, SeaweedFS); false for AWS S3 and R2. |

## Cache

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `DRAGONFLY_HOST` | `127.0.0.1` |  | Dragonfly (or Redis) host for realtime events, rate limits and locks. docker compose sets this for the app container. |
| `DRAGONFLY_PORT` | `6379` |  | Dragonfly port. |
| `DRAGONFLY_PASSWORD` |  |  | Dragonfly password, when the server requires one. docker compose ignores it (the bundled cache is reachable only on the compose network). Secret. |

## Search

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `ELASTICSEARCH_NODE_URL` |  |  | Optional. Elasticsearch accelerates search; leave empty to search in PostgreSQL only. With docker compose: `--profile search` and http://elasticsearch:9200. |

## Sign-in

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `SHOTSTASH_FEATURE_SIGNUP` | `true` |  | Public sign-up (new accounts wait for admin approval). Set to false to allow only admin-created accounts. |
| `GOOGLE_CLIENT_ID` |  |  | Optional. Google sign-in OAuth client id; leave empty to hide the button. A restart applies it, no rebuild. |

## Email

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `EMAIL_TRANSPORT` |  |  | Optional. Email for password reset. resend (or RESEND_API_KEY set): sent through Resend. log: nothing is sent, the last message is kept in memory (development and tests). Empty and no key: password reset stays hidden. |
| `EMAIL_FROM` | `Shotstash <no-reply@example.com>` |  | Sender address of outgoing email. |
| `RESEND_API_KEY` |  |  | Resend API key. Secret. |

## Product

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `SHOTSTASH_DEFAULT_LOCALE` | `en` |  | Language for visitors and new accounts until they pick one. Unknown values fall back to en. |
| `SHOTSTASH_DEFAULT_TIMEZONE` | `UTC` |  | Time zone for server-written text (emails, share pages). Browsers show times in the viewer's own zone. |
| `SHOTSTASH_TRASH_RETENTION_DAYS` | `30` |  | Days an item stays in the Trash before the hourly sweeper deletes it for good. |
| `SHOTSTASH_FEATURE_DISCUSSION` | `true` |  | Project discussion (chat and @mentions). Set to false to hide it: its API answers FEATURE_DISABLED and the UI hides it; no data is removed. |
| `SHOTSTASH_VERSION` |  |  | Set by the Docker image. Leave unset; the version in package.json is used otherwise. |

## Pipeline

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `WORKER_BOOTSTRAP_TOKEN` |  |  | Shared token a processing worker presents once to register (POST /api/v1/pipeline/workers/register); each worker then gets its own token. docker compose requires it (the bundled reference worker uses it). Empty: no worker can register. Secret. |
| `SHOTSTASH_PIPELINE_MAX_OUTPUT_MB` | `20480` |  | Largest output a worker may upload for one job, in megabytes (MiB). |
| `SHOTSTASH_PIPELINE_LEASE_SECONDS` | `90` |  | A claimed job whose worker sent no heartbeat for this long goes back to the queue (it fails after 3 attempts). Workers heartbeat every 30 s; a worker seen within this time counts as live. |
| `SHOTSTASH_PIPELINE_SWEEP_SECONDS` | `30` |  | How often the job sweeper looks for expired claims. At least 5 in production; shorter values are for tests. |

## Demo

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `SHOTSTASH_DEMO_MODE` | `false` |  | Public demo instances only. With true: the sign-in page lists the read-only demo accounts and their password, sign-up is off, a demo banner shows, POST /api/v1/demo/session hands out short read-only sessions and the demo data is reset every night at 03:00 (SHOTSTASH_DEFAULT_TIMEZONE). Seed it once after setup with `docker compose exec -u node app node dist/demo.js seed` (`npm run demo:seed` from source). Needs DEMO_ADMIN_PASSWORD. |
| `DEMO_ADMIN_PASSWORD` |  |  | Public demo instances only. Password of every demo account, at least 10 characters. It is shown on the sign-in page in demo mode (the accounts are read-only), so never reuse a real password. Public in demo mode (shown on the sign-in page). |

## Docker Compose

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` |  | yes | docker compose only: password of the bundled PostgreSQL, fixed when the database is first created (changing it later breaks the connection). Letters, digits, - and _ only. Secret. |
| `SHOTSTASH_PORT` | `3005` |  | docker compose only: host port published for the app. Change it when 3005 is taken. |
| `COMPOSE_FILE` |  |  | docker compose only: the compose files every docker compose command reads, as relative paths separated by : (no Windows drive letters). Set by docker/init.sh to the published images (docker-compose.images.yml); unset means Compose's own fallback, docker-compose.yml plus docker-compose.override.yml. While it is set, Compose no longer loads docker-compose.override.yml by itself: append your override to the list instead. To build from source, set it to docker-compose.yml and run `docker compose up -d --build`. A public demo appends :docker-compose.demo.yml. The images and demo overrides need Docker Compose 2.24.4 or newer. |
| `COMPOSE_PATH_SEPARATOR` |  |  | docker compose only: separator between the files in COMPOSE_FILE. Compose uses ; on Windows and : elsewhere; setting : keeps the same COMPOSE_FILE working with Docker Desktop on Windows. |
| `IMAGE_TAG` | `latest` |  | docker compose only, with the published images: the release to run, without the leading v of the git tag (0.3.0, not v0.3.0). latest is the newest release; pin X.Y to get fixes but no new minor version, X.Y.Z to change nothing until you edit it, or the previous release to roll back. |
| `IMAGE_REGISTRY` | `ghcr.io/aldyernesto` |  | docker compose only, with the published images: the registry and owner the images come from. Change it only if the project moves or you publish your own images. |
