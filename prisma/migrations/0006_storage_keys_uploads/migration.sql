-- Stories 4.1-4.3: hierarchy-free storage keys, row-first uploads with
-- parts, dedup index, processed versions.
--
-- Pre-1.0 data is throwaway (README upgrade note): keys are computed here
-- from the file id and the extension of the stored name, the old path
-- columns are dropped, and no bytes are moved. Reset dev data after
-- upgrading (npm run dev:db:reset).

-- CreateEnum
CREATE TYPE "MediaFileStatus" AS ENUM ('uploading', 'ready');

-- AlterEnum (new values are not used in this migration)
ALTER TYPE "UploadStatus" ADD VALUE 'COMPLETING';
ALTER TYPE "UploadStatus" ADD VALUE 'EXPIRED';

-- AlterTable: media_files
ALTER TABLE "media_files"
ADD COLUMN     "duplicate_of" TEXT,
ADD COLUMN     "status" "MediaFileStatus" NOT NULL DEFAULT 'ready',
ADD COLUMN     "storage_key" TEXT,
ADD COLUMN     "thumb_version" INTEGER NOT NULL DEFAULT 0;

-- Keys from the file id and the extension of the stored name ("bin" when none).
UPDATE "media_files"
SET "storage_key" = 'files/' || "id" || '/original.' ||
  COALESCE(NULLIF(lower(substring("filename" from '\.([A-Za-z0-9]{1,10})$')), ''), 'bin');

ALTER TABLE "media_files" ALTER COLUMN "storage_key" SET NOT NULL;

ALTER TABLE "media_files" DROP COLUMN "storagePath",
DROP COLUMN "thumbnailPath";

-- Existing identical files in one Project: the oldest stays the original,
-- the others are marked as duplicates of it, so the unique index below can
-- be created on any old database.
UPDATE "media_files" AS m
SET "duplicate_of" = d."first_id"
FROM (
  SELECT "id",
         first_value("id") OVER (PARTITION BY "projectId", "md5Checksum" ORDER BY "createdAt", "id") AS "first_id"
  FROM "media_files"
  WHERE "trashedAt" IS NULL
) AS d
WHERE m."id" = d."id" AND d."first_id" <> m."id";

-- AlterTable: upload_sessions (open sessions of the old chunk uploader cannot resume)
UPDATE "upload_sessions" SET "status" = 'FAILED' WHERE "status" = 'IN_PROGRESS';

ALTER TABLE "upload_sessions" DROP COLUMN "chunkSize",
DROP COLUMN "uploadedChunks",
ADD COLUMN     "allow_duplicate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "backend_upload_id" TEXT,
ADD COLUMN     "completing_at" TIMESTAMP(3),
ADD COLUMN     "media_file_id" TEXT,
ADD COLUMN     "part_size" INTEGER NOT NULL DEFAULT 16777216;

ALTER TABLE "upload_sessions" ALTER COLUMN "part_size" DROP DEFAULT;

-- CreateTable
CREATE TABLE "processed_versions" (
    "id" TEXT NOT NULL,
    "media_file_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "job_id" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_parts" (
    "session_id" TEXT NOT NULL,
    "part_number" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "etag" TEXT NOT NULL,
    "md5" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_parts_pkey" PRIMARY KEY ("session_id","part_number")
);

-- CreateIndex
CREATE INDEX "processed_versions_media_file_id_idx" ON "processed_versions"("media_file_id");

-- CreateIndex
CREATE INDEX "media_files_status_idx" ON "media_files"("status");

-- CreateIndex
CREATE INDEX "upload_sessions_status_expiresAt_idx" ON "upload_sessions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "upload_sessions_media_file_id_idx" ON "upload_sessions"("media_file_id");

-- Dedup authority (Story 4.3): one ready, untrashed original per Project and
-- checksum. "Upload anyway" rows carry duplicate_of and stay outside it.
CREATE UNIQUE INDEX "media_files_project_md5_ready_key"
ON "media_files"("projectId", "md5Checksum")
WHERE "status" = 'ready' AND "trashedAt" IS NULL AND "duplicate_of" IS NULL;

-- AddForeignKey (NO ACTION: the app re-points duplicates before it deletes an original)
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_duplicate_of_fkey" FOREIGN KEY ("duplicate_of") REFERENCES "media_files"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "processed_versions" ADD CONSTRAINT "processed_versions_media_file_id_fkey" FOREIGN KEY ("media_file_id") REFERENCES "media_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_media_file_id_fkey" FOREIGN KEY ("media_file_id") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_parts" ADD CONSTRAINT "upload_parts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "upload_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
