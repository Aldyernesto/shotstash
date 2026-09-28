-- Story 3.5: typed system lines in project discussion. Null is a message a
-- person wrote; "upload" is the line added when a file finishes uploading
-- (rendered from messages; `message` keeps an English fallback).

-- AlterTable
ALTER TABLE "project_chats" ADD COLUMN     "kind" TEXT;
