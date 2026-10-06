# Bring your own AI: the worker contract

> Contract version **1**.

Shotstash does not ship a model. It ships a job queue and a small HTTP contract, so any program that can speak HTTP (in any language) can process files: transcription, scene detection, a blur, a better proxy. The worker never gets database access, storage credentials or storage URLs. It reads the input from the app, sends one output back to the app, and the app stores that output as a **processed version** of the file, next to the untouched original.

The repository includes a reference worker in `worker/` (Node 24 and ffmpeg) that makes 720p H.264/AAC proxies. Read this page to write your own; read `worker/src/` when you want a working example.

## How it fits together

```
person (GraphQL enqueueJob)  ──>  pipeline_jobs (PostgreSQL)
                                        │
worker ── POST jobs/next ───────────────┘  claims the oldest queued job of its kinds
worker ── GET  jobs/:id/input ─────────>  the original file (Range supported)
worker ── POST jobs/:id/progress ──────>  0..100, moves the lease
worker ── PUT  jobs/:id/output ────────>  one output, streamed to storage by the app
worker ── POST jobs/:id/complete ──────>  output becomes a processed version; job done
```

1. A person with the `pipeline.trigger` permission (editor, admin, super admin) queues a job: a **kind** on a **file**.
2. A worker registered for that kind claims it, reads the input, reports progress, uploads its output and completes.
3. The output shows up in the file's viewer info panel as a version that people can open or download.

## Kinds

A kind names what a job does: `<namespace>/<name>`, lowercase letters, digits, `.`, `-` and `_` (each part at most 64 characters). Use your own namespace, for example `acme/whisper-transcript`. Built-in kinds:

| Kind | What it makes |
| --- | --- |
| `shotstash/proxy-720p` | 720p H.264/AAC MP4 proxy of a video (the reference worker); videos only |
| `shotstash/heic-to-jpeg` | full-size JPEG of a HEIC photo (no worker ships for it yet); HEIC/HEIF only |

A kind exists once a worker registers it (or it is built in); kinds are never deleted. Queueing a kind that does not exist answers `KIND_UNKNOWN`. A kind may list the file types it applies to (MIME prefixes such as `video/`, stored in `pipeline_kinds.accepts`; a kind a worker registers applies to every file); queueing it for another type answers `KIND_NOT_APPLICABLE`. A file has at most one unfinished job per kind: queueing the same kind again answers that job. A queued job whose kind no live worker serves shows the state `waiting_for_worker` until a worker for it shows up.

## Authentication

Two tokens, both sent as headers, never in a URL:

| Header | Where it comes from | Used for |
| --- | --- | --- |
| `X-Worker-Bootstrap-Token` | `WORKER_BOOTSTRAP_TOKEN` in the app's `.env` (shared, at least 32 characters) | `POST workers/register` only |
| `X-Worker-Token` | answered once by registration (per worker) | every other route |
| `X-Claim-Token` | answered by `jobs/next` (per claim) | every call about that job |

The app stores only the SHA-256 hash of a worker token; keep the token in memory or a secret store, never in logs.

**One row per name.** `manifest.name` identifies a worker. Registering a name again (after a restart, or after a `401`) keeps the same worker and its claims and issues a new token; the old token stops working. Give every worker process its own name (the reference worker reads `WORKER_NAME`), or two processes with one name keep taking the token from each other. Worker rows not seen for 30 days that hold no claim are removed by the sweeper.

**Revoking.** A super admin lists workers with the GraphQL query `pipelineWorkers` and revokes one with `revokeWorker(id)`. Its token answers `401` at once, its name cannot register again (`403 WORKER_REVOKED`; register under a new name), and its claims return to the queue when their lease expires.

**Rotating the bootstrap token.** Change `WORKER_BOOTSTRAP_TOKEN` in `.env` and restart the app: registrations with the old value answer `401`, so no new worker (and no new name) can join with it. Workers that already registered keep their own tokens; revoke them to remove them, and give the new value to the workers you keep (they need it the next time they register). Worker calls are limited to 600 per minute per worker (`429 RATE_LIMITED` with `Retry-After`), and registrations to 60 per hour per IP.

## Versioning

Every answer under `/api/v1/pipeline/*` carries `X-Shotstash-Pipeline: 1`. Your manifest says which contract major you speak (`"contract": 1`, or a string such as `"1.2"`, read by its major). Another major answers `422 CONTRACT_UNSUPPORTED`. A breaking change gets a new path version (`/api/v2/pipeline`), a new contract major and migration notes in a major release; additions within version 1 (new optional fields, new kinds) do not break workers, so ignore fields you do not know.

## Job states

| Status | Meaning |
| --- | --- |
| `queued` | waiting for a worker (shown as `waiting_for_worker` when no live worker serves its kind) |
| `claimed` | a worker has it; nothing reported yet |
| `running` | the worker reported progress |
| `done` | completed; the processed version exists (final) |
| `failed` | gave up: a non-retryable failure, or 3 attempts used (final) |
| `cancelled` | a person cancelled it (final) |

`seq` grows with every state or progress change, so clients can order updates.

### Heartbeats, leases and requeue

- `heartbeat_at` is the only lease. It moves when the job is claimed, on every progress report and output upload, and on every heartbeat that lists the job in `activeJobIds`.
- Send `POST workers/heartbeat` every **30 s** (`heartbeatSeconds`), with the ids of the jobs you are working on.
- A claim without any of these for **90 s** (`leaseSeconds`, `SHOTSTASH_PIPELINE_LEASE_SECONDS`) expires: the in-app sweeper (every 30 s) puts the job back in the queue. Each claim counts as one attempt; when the third claim expires the job fails with "The worker stopped sending heartbeats".
- A requeued job waits before another claim: 30 s times the attempts used (`run_after`), so a failing job is not retried in a tight loop.
- After a requeue your claim is **stale**: every call with the old claim token answers `409 CLAIM_STALE`, and any output you uploaded under it is deleted. Stop and drop the work.
- When a person cancels the job, or it already finished, calls answer `409 JOB_TERMINAL`, and a heartbeat lists the job in `lostJobIds`. Stop and drop the work.
- Moving the file to the Trash cancels its unfinished jobs (error "file trashed"); completing such a job answers `409 FILE_GONE` and its output is deleted.
- To give a job back without spending an attempt (your worker is shutting down), call `POST jobs/:id/release`; it is queued again at once.

### Outputs

- One output per job: the raw bytes as the request body of `PUT jobs/:id/output` (not multipart), with `Content-Type` set to its media type and `X-Output-Ext` to its extension (`mp4`, `jpg`, `json`, `vtt`, 1 to 10 letters or digits). Send `Content-Length` when you know it.
- `Content-Type` must be one of `video/mp4`, `video/webm`, `video/quicktime`, `image/jpeg`, `image/png`, `image/webp`, `audio/mpeg`, `audio/mp4`, `audio/wav`, `application/pdf`, `application/json`, `text/plain`, `text/vtt`; anything else answers `400 INVALID_OUTPUT`.
- Uploading again under the same claim replaces the previous output.
- The limit is `SHOTSTASH_PIPELINE_MAX_OUTPUT_MB` (20480 MB by default); larger bodies answer `413 OUTPUT_TOO_LARGE`.
- The output becomes a processed version only on `complete`, in the same transaction that verifies your claim. Its `kind` is the job's kind; it records the job id and the attempt.

### Retries

`POST jobs/:id/fail` with `retryable: true` puts the job back in the queue while attempts remain (3 in total); `retryable: false` (bad input, unsupported format) fails it at once. Either way any uploaded output is deleted and the error text is kept on the job, where people with access to the file can read it.

### Backing off

On `401`, `503` or a network error, wait **30 s** and try again; never exit. Keep retrying an output upload or a `complete` the same way while your claim is valid (stop on `409`): the work is done, only the delivery failed. The app answers `503 SETUP_REQUIRED` until first-run setup is done, `503 PIPELINE_DISABLED` to registration while `WORKER_BOOTSTRAP_TOKEN` is not set, and connections fail while it restarts. On `401` register again before going on.

## Errors

Every refusal is JSON: `{ "code": "CLAIM_STALE", "message": "..." }`. Act on `code`; `message` is for logs.

| Status | Code | When |
| --- | --- | --- |
| 400 | `INVALID_BODY`, `INVALID_MANIFEST` | the JSON body or the manifest is malformed |
| 413 | `BODY_TOO_LARGE` | a JSON body over 64 KiB (counted as it arrives, with or without `Content-Length`) |
| 400 | `CLAIM_TOKEN_REQUIRED` | a job call without `X-Claim-Token` |
| 400 | `INVALID_OUTPUT` | missing, bad or disallowed `Content-Type`, bad `X-Output-Ext`, empty output, body shorter than `Content-Length` |
| 401 | `UNAUTHENTICATED` | missing, unknown or revoked token |
| 403 | `WORKER_REVOKED` | registering a name that a super admin revoked |
| 404 | `JOB_NOT_FOUND`, `FILE_NOT_FOUND` | the job does not exist; the file is gone or in the Trash |
| 409 | `CLAIM_STALE` | your claim is no longer valid (requeued, or not yours) |
| 409 | `JOB_TERMINAL` | the job is done, failed or cancelled |
| 409 | `OUTPUT_MISSING` | `complete` before an output was uploaded |
| 409 | `FILE_GONE` | `complete` for a file that was trashed or deleted (the output is deleted) |
| 413 | `OUTPUT_TOO_LARGE` | the output exceeds the limit |
| 422 | `CONTRACT_UNSUPPORTED` | your manifest speaks another contract major |
| 429 | `RATE_LIMITED` | too many calls (per worker, and per IP before the token is checked); wait `Retry-After` seconds |
| 503 | `SETUP_REQUIRED`, `PIPELINE_DISABLED`, `STORAGE_UNAVAILABLE` | try again later |

## Routes

All paths are relative to the app's URL, for example `http://app:3005` inside docker compose. The examples use these shell variables:

```bash
BASE=http://localhost:3005
BOOT=<WORKER_BOOTSTRAP_TOKEN from .env>
```

### `POST /api/v1/pipeline/workers/register`

Header `X-Worker-Bootstrap-Token`. Body: the manifest.

```bash
curl -s -X POST "$BASE/api/v1/pipeline/workers/register" \
  -H "X-Worker-Bootstrap-Token: $BOOT" -H 'Content-Type: application/json' \
  -d '{"manifest":{"name":"my-transcriber","version":"1.0.0","kinds":["acme/transcript"],"contract":1}}'
```

`201` (the same `workerId` when the name registered before):

```json
{ "workerId": "0192...", "token": "ssw_...", "contract": 1, "heartbeatSeconds": 30, "leaseSeconds": 90 }
```

`manifest.name` is 1 to 100 characters, `version` 1 to 50, `kinds` 1 to 32 kind names. Keep `token`: it is not shown again.

```bash
TOKEN=ssw_...   # from the answer
```

### `POST /api/v1/pipeline/workers/heartbeat`

Every 30 s. Body: the manifest again (it may change: a new version or kind) and the jobs you are working on.

```bash
curl -s -X POST "$BASE/api/v1/pipeline/workers/heartbeat" \
  -H "X-Worker-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"manifest":{"name":"my-transcriber","version":"1.0.0","kinds":["acme/transcript"],"contract":1},"activeJobIds":["0192..."]}'
```

`200`: `{ "contract": 1, "lostJobIds": [] }`. Stop every job listed in `lostJobIds`.

### `POST /api/v1/pipeline/jobs/next`

Claims the oldest queued job of the kinds you registered (the kinds come from your registration, never from the request). Two workers never get the same job.

```bash
curl -s -X POST "$BASE/api/v1/pipeline/jobs/next" -H "X-Worker-Token: $TOKEN"
```

`204` when there is nothing to do (wait a few seconds and ask again). `200`:

```json
{
  "job": {
    "id": "0192...",
    "kind": "acme/transcript",
    "params": {},
    "attempt": 1,
    "maxAttempts": 3,
    "claimToken": "5f0c...",
    "input": { "url": "/api/v1/pipeline/jobs/0192.../input", "name": "interview.mov", "mimeType": "video/quicktime", "size": 734003200 }
  }
}
```

```bash
JOB=0192...; CLAIM=5f0c...   # from the answer
```

### `GET /api/v1/pipeline/jobs/:id/input`

The original file, whole or one range (`Range: bytes=start-end`, answered `206`). `Cache-Control: no-store`. Only the worker holding the claim may read it.

```bash
curl -s -o input.bin "$BASE/api/v1/pipeline/jobs/$JOB/input" -H "X-Worker-Token: $TOKEN" -H "X-Claim-Token: $CLAIM"
curl -s -r 0-1023 "$BASE/api/v1/pipeline/jobs/$JOB/input" -H "X-Worker-Token: $TOKEN" -H "X-Claim-Token: $CLAIM" | xxd | head
```

Download the whole file to disk when your tool needs to seek (an MP4 whose index sits at the end, for example).

### `POST /api/v1/pipeline/jobs/:id/progress`

Body `{ "progress": 0..100 }`. The first report moves the job from `claimed` to `running`; every report moves the lease. Report when the whole percent changes, at most every few seconds.

```bash
curl -s -X POST "$BASE/api/v1/pipeline/jobs/$JOB/progress" \
  -H "X-Worker-Token: $TOKEN" -H "X-Claim-Token: $CLAIM" -H 'Content-Type: application/json' -d '{"progress":42}'
```

`200`: `{ "status": "running", "progress": 42, "seq": 3 }`.

### `PUT /api/v1/pipeline/jobs/:id/output`

The raw output bytes.

```bash
curl -s -X PUT "$BASE/api/v1/pipeline/jobs/$JOB/output" \
  -H "X-Worker-Token: $TOKEN" -H "X-Claim-Token: $CLAIM" \
  -H 'Content-Type: text/vtt' -H 'X-Output-Ext: vtt' --data-binary @transcript.vtt
```

`200`: `{ "versionId": "0192...", "size": 18234, "mimeType": "text/vtt" }`.

### `POST /api/v1/pipeline/jobs/:id/complete`

```bash
curl -s -X POST "$BASE/api/v1/pipeline/jobs/$JOB/complete" -H "X-Worker-Token: $TOKEN" -H "X-Claim-Token: $CLAIM"
```

`200`: `{ "status": "done", "versionId": "0192..." }`. The version is now listed with the file and downloadable from `/media/p/<versionId>` by anyone who may download the file.

### `POST /api/v1/pipeline/jobs/:id/release`

Gives the job back without spending an attempt (for example on shutdown); it is queued again at once and any uploaded output is deleted.

```bash
curl -s -X POST "$BASE/api/v1/pipeline/jobs/$JOB/release" -H "X-Worker-Token: $TOKEN" -H "X-Claim-Token: $CLAIM"
```

`200`: `{ "status": "queued", "attempts": 0 }`.

### `POST /api/v1/pipeline/jobs/:id/fail`

Body `{ "error": "what went wrong", "retryable": true }` (`error` at most 2000 characters).

```bash
curl -s -X POST "$BASE/api/v1/pipeline/jobs/$JOB/fail" \
  -H "X-Worker-Token: $TOKEN" -H "X-Claim-Token: $CLAIM" -H 'Content-Type: application/json' \
  -d '{"error":"The model server is not reachable","retryable":true}'
```

`200`: `{ "status": "queued", "attempts": 1, "maxAttempts": 3 }` (or `"failed"`).

## Queueing jobs (people)

Jobs are queued through GraphQL with a session of a user who has `pipeline.trigger`:

```graphql
mutation { enqueueJob(fileId: "...", kind: "acme/transcript") { id status state progress } }
mutation { cancelJob(id: "...") { id status } }
query { pipelineJob(id: "...") { status state progress attempts error outputVersion { id downloadUrl } } }
query { folder(id: "...") { files { id jobs { id kind state progress } } } }
```

Queueing a kind that already has an unfinished job on the same file answers that job instead of a second one.

## Writing a worker in another language

The loop of every worker, whatever the language:

```
register (bootstrap token)  ->  keep the worker token in memory
every 30 s: heartbeat(manifest, ids of jobs in progress); stop jobs in lostJobIds
loop:
  job = POST jobs/next            (204: sleep 5 s, continue)
  download GET jobs/:id/input to a temp file
  process it, POST progress now and then
  PUT the output, POST complete
  on your own error: POST fail (retryable: true when another try could work)
  on 409 CLAIM_STALE or JOB_TERMINAL: drop the job, no fail call
  always delete the temp files
on 401: register again (same name); on 401, 503 or a network error: wait 30 s; never exit
retry PUT output and complete on 429, 503 or a network error while the claim is valid
on shutdown (SIGTERM): stop claiming, release the current job (POST jobs/:id/release)
```

A minimal sketch in Python (standard library only):

```python
import json, os, time, urllib.request, urllib.error

BASE = os.environ["SHOTSTASH_URL"]
MANIFEST = {"name": "py-example", "version": "0.1.0", "kinds": ["acme/word-count"], "contract": 1}

def call(method, path, headers=None, body=None, raw=False):
    data = body if raw else (json.dumps(body).encode() if body is not None else None)
    h = {"Content-Type": "application/json"} if body is not None and not raw else {}
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={**h, **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as res:
        payload = res.read()
        return res.status, (json.loads(payload) if payload and not raw else payload)

token = None
while True:
    try:
        if token is None:
            _, reg = call("POST", "/api/v1/pipeline/workers/register",
                          {"X-Worker-Bootstrap-Token": os.environ["WORKER_BOOTSTRAP_TOKEN"]}, {"manifest": MANIFEST})
            token = reg["token"]
        auth = {"X-Worker-Token": token}
        status, res = call("POST", "/api/v1/pipeline/jobs/next", auth, {})
        if status == 204:
            time.sleep(5)
            continue
        job = res["job"]
        claim = {**auth, "X-Claim-Token": job["claimToken"]}
        _, data = call("GET", job["input"]["url"], claim, raw=True)
        result = json.dumps({"bytes": len(data)}).encode()
        call("PUT", f"/api/v1/pipeline/jobs/{job['id']}/output",
             {**claim, "Content-Type": "application/json", "X-Output-Ext": "json"}, result, raw=True)
        call("POST", f"/api/v1/pipeline/jobs/{job['id']}/complete", claim, {})
    except urllib.error.HTTPError as e:
        if e.code == 401:
            token = None
        time.sleep(30 if e.code in (401, 503) else 5)
    except OSError:
        time.sleep(30)
```

(A real worker also sends heartbeats from a timer and reports progress; see `worker/src/worker.mjs`.)

## Running a worker

- With docker compose the reference worker runs as the `worker` service. To run yours instead, build your image and replace `image:` / `build:` of that service (keep `SHOTSTASH_URL: http://app:3005` and `WORKER_BOOTSTRAP_TOKEN`).
- On another machine, point `SHOTSTASH_URL` at the app's address and give it the same `WORKER_BOOTSTRAP_TOKEN`. The app does not need to reach the worker; the worker only makes outgoing requests.
- Any number of workers may run at once, for the same or different kinds.
- `/status` (super admin) shows the number of live workers (seen within the lease) and of queued jobs.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `WORKER_BOOTSTRAP_TOKEN` | (none) | shared registration token; required by docker compose |
| `SHOTSTASH_PIPELINE_MAX_OUTPUT_MB` | 20480 | largest output per job |
| `SHOTSTASH_PIPELINE_LEASE_SECONDS` | 90 | a claim without a heartbeat for this long is requeued (more than twice the 30 s heartbeat) |
| `SHOTSTASH_PIPELINE_SWEEP_SECONDS` | 30 | how often the sweeper looks (at least 5 in production, at most half the lease) |
