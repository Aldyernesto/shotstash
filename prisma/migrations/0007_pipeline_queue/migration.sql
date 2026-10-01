-- Stories 5.1-5.3: pipeline job queue, job kinds and registered workers.
--
-- Jobs are claimed with one UPDATE ... FOR UPDATE SKIP LOCKED statement and
-- leased through heartbeat_at; the in-app sweeper requeues expired claims
-- and fails a job after max_attempts. Kinds are namespaced
-- (`<namespace>/<name>`); the two built-in kinds are seeded below and a
-- worker registering a new kind adds it. Worker tokens are stored only as
-- SHA-256 hashes. Purging a file deletes its jobs (cascade).

-- CreateEnum
CREATE TYPE "PipelineJobStatus" AS ENUM ('queued', 'claimed', 'running', 'done', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "pipeline_jobs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "media_file_id" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" "PipelineJobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "claimed_by" TEXT,
    "claim_token" TEXT,
    "heartbeat_at" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "error" TEXT,
    "output_version_id" TEXT,
    "output_key" TEXT,
    "output_mime_type" TEXT,
    "output_size" BIGINT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "pipeline_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_kinds" (
    "name" TEXT NOT NULL,
    "label" TEXT,
    "built_in" BOOLEAN NOT NULL DEFAULT false,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_kinds_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "pipeline_workers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "kinds" TEXT[],
    "token_hash" TEXT NOT NULL,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_workers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_jobs_status_kind_created_at_idx" ON "pipeline_jobs"("status", "kind", "created_at");

-- CreateIndex
CREATE INDEX "pipeline_jobs_status_heartbeat_at_idx" ON "pipeline_jobs"("status", "heartbeat_at");

-- CreateIndex
CREATE INDEX "pipeline_jobs_media_file_id_idx" ON "pipeline_jobs"("media_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_workers_token_hash_key" ON "pipeline_workers"("token_hash");

-- CreateIndex
CREATE INDEX "pipeline_workers_last_seen_idx" ON "pipeline_workers"("last_seen");

-- AddForeignKey
ALTER TABLE "pipeline_jobs" ADD CONSTRAINT "pipeline_jobs_kind_fkey" FOREIGN KEY ("kind") REFERENCES "pipeline_kinds"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_jobs" ADD CONSTRAINT "pipeline_jobs_media_file_id_fkey" FOREIGN KEY ("media_file_id") REFERENCES "media_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_jobs" ADD CONSTRAINT "pipeline_jobs_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "pipeline_workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_jobs" ADD CONSTRAINT "pipeline_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Built-in kinds: the reference worker's proxy and the full-size HEIC
-- conversion (no worker ships for it yet; it waits for one).
INSERT INTO "pipeline_kinds" ("name", "label", "built_in") VALUES
  ('shotstash/proxy-720p', 'Proxy (720p)', true),
  ('shotstash/heic-to-jpeg', 'Full-size JPEG', true)
ON CONFLICT ("name") DO NOTHING;
