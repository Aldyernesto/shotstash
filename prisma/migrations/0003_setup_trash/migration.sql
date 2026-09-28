-- Stories 2.6 / 2.8: first-run setup singleton and trash cascade roots.

-- AlterTable
ALTER TABLE "folders" ADD COLUMN     "trash_root_id" TEXT;

-- AlterTable
ALTER TABLE "media_files" ADD COLUMN     "trash_root_id" TEXT;

-- CreateTable
CREATE TABLE "instance_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "setup_completed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instance_settings_pkey" PRIMARY KEY ("id"),
    -- Singleton: the only row there can ever be is id 1.
    CONSTRAINT "instance_settings_singleton" CHECK ("id" = 1)
);

-- An install that already has accounts was set up before this migration.
INSERT INTO "instance_settings" ("id", "setup_completed_at")
SELECT 1, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "users");

-- CreateIndex
CREATE INDEX "folders_trashedAt_idx" ON "folders"("trashedAt");

-- CreateIndex
CREATE INDEX "folders_trash_root_id_idx" ON "folders"("trash_root_id");

-- CreateIndex
CREATE INDEX "media_files_trashedAt_idx" ON "media_files"("trashedAt");

-- CreateIndex
CREATE INDEX "media_files_trash_root_id_idx" ON "media_files"("trash_root_id");
