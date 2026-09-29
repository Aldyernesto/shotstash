# Storage

Shotstash stores every byte (originals, thumbnails, covers, upload parts and, later, processed versions) through one storage backend. An installation uses exactly one backend, chosen with `STORAGE_BACKEND`; nothing else in the app knows where bytes live.

| Backend | `STORAGE_BACKEND` | Where the bytes go |
| --- | --- | --- |
| Local disk | `local` (default) | A directory: `STORAGE_LOCAL_ROOT` (`./data/media` in development, `/data/media` in the Docker image, which compose maps to `./data/media` next to `docker-compose.yml`). Any path works, including a NAS mount (NFS, SMB). |
| S3-compatible | `s3` | A bucket on AWS S3, Cloudflare R2, MinIO, RustFS, SeaweedFS or any other S3-compatible server. |

All variables are listed in [configuration.md](configuration.md).

## How bytes are laid out

Keys never encode the library's structure. Renaming or moving a Project or Section, or moving a file between Sections, only changes the database; no byte moves.

```text
files/<fileId>/original.<ext>      the uploaded file (ext from the sniffed type)
files/<fileId>/thumb-<n>.jpg       thumbnail version n
files/<fileId>/proc/<id>.<ext>     processed versions (pipeline, later)
covers/project/<id>.jpg            project covers (re-encoded JPEG, at most 2048 px)
covers/user/<id>.jpg               avatars
```

Each key is recorded on its database row and never recomputed. The local backend also keeps `.parts/<uploadId>/` (upload parts staged until completion) and `.tmp/` (writes land there first and are renamed into place, so a reader never sees half a file).

## Local disk

```dotenv
STORAGE_BACKEND=local
STORAGE_LOCAL_ROOT=/data/media
```

The app needs read and write access to the directory. With Docker the app runs as uid 1000; on NFS with `root_squash` or a CIFS/SMB share make the folder writable by that uid (see the README). `/status` shows the backend as "Local disk".

First-run setup writes a marker file, `.shotstash-storage`, into the root. From then on `/api/health` and `/status` report the storage as reachable only when the root exists, is readable and writable, and holds that marker: when a NAS share is not mounted, the empty mountpoint has no marker, so health answers 503 with `storage: false` instead of the app quietly writing onto the local disk underneath. The health check never creates the directory, and its result is cached for 10 seconds. An install from before the marker (the root already holds `files/`) gets the marker on the first check. Remove the marker only if you really mean to point the app at a different, empty directory; the next setup-time probe writes it again.

## S3-compatible buckets

```dotenv
STORAGE_BACKEND=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=shotstash-media
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false
```

- `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are required with `STORAGE_BACKEND=s3`; the app refuses to start and names each one that is missing.
- `S3_ENDPOINT` is empty for AWS S3 and set for everything else.
- The bucket stays private. Shotstash never sets an ACL and never hands a bucket URL or a presigned URL to a browser: every byte goes through the app (`/media/*`), so sign-in, roles and share links keep working exactly as on the local disk.
- The access key needs `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts` and `s3:ListBucket` (for the health check) on the bucket.
- Checksums are calculated only when an operation requires them (`requestChecksumCalculation` and `responseChecksumValidation` set to `WHEN_REQUIRED`), which S3-compatible servers expect. Upload parts carry their own `Content-MD5`.
- When an upload completes, the app reads the finished object once to verify its MD5 (local disk hashes while assembling). On a metered provider this doubles the egress of each upload once.
- Thumbnails of videos: ffmpeg reads the object through a presigned URL valid for 5 minutes that is created and used inside the server only and never logged.
- Add a lifecycle rule that aborts incomplete multipart uploads after a few days (`AbortIncompleteMultipartUpload` with `DaysAfterInitiation: 3`; on R2: Settings, Object lifecycle rules, "Abort incomplete multipart uploads"). The app aborts the uploads it knows about when their session expires, but an upload interrupted by a crash at the wrong moment would otherwise keep its parts (and their storage cost) forever. On the local disk the hourly sweeper removes such leftovers (`.parts/` and `.tmp/` older than 48 hours).
- `/api/health` answers 503 with `storage: false` when the bucket cannot be reached; `/status` shows the backend as "S3" and "Unreachable".

| Provider | `S3_ENDPOINT` | `S3_REGION` | `S3_FORCE_PATH_STYLE` |
| --- | --- | --- | --- |
| AWS S3 | (empty) | your bucket's region | `false` |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | `auto` | `false` |
| MinIO | `http://minio:9000` | `us-east-1` | `true` |
| RustFS | `http://rustfs:9000` | `us-east-1` | `true` |
| SeaweedFS (S3 gateway) | `http://seaweedfs:8333` | `us-east-1` | `true` |

R2 requires every part of a multipart upload except the last to have the same size; Shotstash always sends equal parts, so R2 works without special settings.

## Uploads

- The browser starts an upload with `initiateUpload`; the server creates the file row (status `uploading`), starts a multipart upload on the backend and answers the **part size**, which only the server decides: 16 MiB, raised to the next whole MiB at or above `size / 10000` for files that would otherwise need more than 10,000 parts. Every part except the last has that size.
- Parts go to `PUT /api/v1/uploads/:sessionId/parts/:partNumber` as a raw body with a `Content-MD5` header, three at a time per file, each retried up to five times with exponential backoff. Sending a part again replaces it. Parts are limited per user (1,200 a minute).
- `completeUpload` checks that every part arrived, assembles them, compares the MD5 of the whole file with the one the browser computed, sniffs the file type from its first bytes (the stored extension comes from the type, not the name) and makes the file part of the library.
- **Duplicates:** before sending bytes, the browser asks for files in the Project with the same name and size and hashes only those files; an identical file prompts "Skip" (the default) or "Upload anyway". The database enforces one copy per Project and checksum, so two identical uploads finishing at the same moment cannot both become originals; the second answers `DUPLICATE_FILE`.
- **Resume:** the browser remembers unfinished uploads; after a reload or a dropped connection it lists them and asks for the same file again, then sends only the parts the server does not have. Sessions expire after 24 hours; an hourly sweeper aborts the backend upload and removes its parts and its unfinished file row.

The interrupted-upload harness (`npm run e2e:upload`) uploads a synthetic file through a local proxy that cuts the connection twice. It runs at 256 MiB by default and at 1 GiB in CI; the 20 GiB acceptance run is manual: `E2E_UPLOAD_MB=20480 npm run e2e:upload` against a running instance (it needs about 20 GiB free on the storage backend and takes a while).

## Thumbnails and processed versions

- Thumbnails are 480 px on the long edge with the source aspect ratio, EXIF orientation applied (photos) and the display matrix applied (phone video, frame at second 2). Each is stored as `files/<id>/thumb-<n>.jpg` and served at `/media/t/<id>?v=<n>`, cached for a year when `n` is the current version.
- Originals are never rewritten. A HEIC original stays as uploaded (its MD5 is the stored bytes' MD5); the upload adds a JPEG `preview` processed version (2048 px) that the viewer shows and the thumbnail is made from.
- Processed versions live at `files/<id>/proc/<versionId>.<ext>`, are listed in the viewer info panel and download from `/media/p/<versionId>` with the permission of their file. Share pages never expose them.
- `npm run thumbs:rebuild` regenerates the thumbnails of existing files (`-- --missing` for files without one). Run it from a checkout of the same version with the server's `.env` (database and storage settings).

## ZIP downloads

Share and dashboard ZIPs are streamed in STORE mode (no compression; media is already compressed), with ZIP64 for entries above 4 GiB and no temporary files. Objects that cannot be read when the download starts are listed in `_MISSING_FILES.txt`; a read that fails mid-download aborts the download, and the browser offers its own retry.

## Switching backends

Switching is a copy procedure, not a setting to flip: the database records keys, and the keys are the same on both backends, so you copy the bytes and change the configuration.

1. Stop the app: `docker compose stop app`.
2. Copy every object, keeping the keys (paths relative to the root become object keys, and back). Leave out `.parts/` and `.tmp/`.
   - Local disk to S3: `rclone copy ./data/media remote:shotstash-media --exclude ".parts/**" --exclude ".tmp/**"` (or `aws s3 sync ./data/media s3://shotstash-media --exclude ".parts/*" --exclude ".tmp/*"`).
   - S3 to local disk: `rclone copy remote:shotstash-media ./data/media`.
3. Change `STORAGE_BACKEND` and the `S3_*` (or `STORAGE_LOCAL_ROOT`) variables in `.env`.
4. Start the app: `docker compose up -d`. `/status` shows the new backend.

Unfinished uploads do not survive a switch; they restart.

## Upgrading from a pre-release (before 1.0)

Databases and media from before storage keys existed are throwaway: migration `0006_storage_keys_uploads` computes a key for every existing file but does not move old bytes, so old files show as missing. Reset development data after upgrading: `npm run dev:db:reset`, then `npm run dev:db`, `npx prisma migrate deploy` and `npm run dev:seed`, and empty `./data/media`.
