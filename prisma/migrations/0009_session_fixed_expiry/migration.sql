-- Story 8.2: a session with a fixed expiry never slides. Only the short
-- read-only sessions of a public demo's try-it console set it; every other
-- session keeps the sliding 7-day lifetime.

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "fixed_expiry" BOOLEAN NOT NULL DEFAULT false;
