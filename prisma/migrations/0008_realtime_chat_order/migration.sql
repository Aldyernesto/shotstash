-- Stories 5.4-5.5: ordered realtime for project discussion and notifications.
--
-- Chat messages get a per-Project sequence: `projects.chat_seq` is bumped in
-- the transaction that inserts a message, and the message keeps the value in
-- `project_chats.seq`. History is read in (createdAt, id) order; new rows use
-- UUID v7 ids, so two messages of the same millisecond still sort the same
-- way for every reader. Existing rows are numbered in that order.
--
-- Mention and upload notifications keep their Project in a column
-- (`notifications.project_id`, backfilled from the JSON data) so reads can
-- drop notifications of a Project the reader can no longer view.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "chat_seq" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "project_chats" ADD COLUMN "seq" BIGINT NOT NULL DEFAULT 0;

-- Backfill: number existing messages per Project in history order.
UPDATE "project_chats" c
SET "seq" = n.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "createdAt", "id") AS rn
  FROM "project_chats"
) n
WHERE c."id" = n."id";

UPDATE "projects" p
SET "chat_seq" = m.max_seq
FROM (SELECT "projectId", MAX("seq") AS max_seq FROM "project_chats" GROUP BY "projectId") m
WHERE p."id" = m."projectId";

-- History order and the per-Project sequence.
DROP INDEX IF EXISTS "project_chats_projectId_idx";
CREATE INDEX "project_chats_projectId_createdAt_id_idx" ON "project_chats"("projectId", "createdAt", "id");
CREATE INDEX "project_chats_projectId_seq_idx" ON "project_chats"("projectId", "seq");

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "project_id" TEXT;

-- Backfill from the JSON data written since Story 2.5.
UPDATE "notifications"
SET "project_id" = "data"->>'projectId'
WHERE "data" IS NOT NULL AND jsonb_typeof("data") = 'object' AND COALESCE("data"->>'projectId', '') <> '';

-- CreateIndex
CREATE INDEX "notifications_project_id_idx" ON "notifications"("project_id");
