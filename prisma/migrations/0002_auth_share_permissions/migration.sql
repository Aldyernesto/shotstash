-- Stories 2.1-2.4: read-only accounts, PRIVATE link access codes, soft revocation.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "read_only" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "share_links" ADD COLUMN     "access_code_hash" TEXT,
ADD COLUMN     "revoked_at" TIMESTAMP(3),
ADD COLUMN     "revoked_reason" TEXT;

-- Links whose target was already deleted (all target columns null) or that
-- carry more than one target are revoked before the constraint is added.
UPDATE "share_links"
SET "revoked_at" = CURRENT_TIMESTAMP,
    "revoked_reason" = CASE
      WHEN num_nonnulls("fileId", "folderId", "projectId2") = 0 THEN 'target_deleted'
      ELSE 'invalid_target'
    END
WHERE num_nonnulls("fileId", "folderId", "projectId2") <> 1
  AND "revoked_at" IS NULL;

-- PRIVATE links created before access codes existed can never be opened:
-- revoke them so the owner creates a new link with a code.
UPDATE "share_links"
SET "revoked_at" = CURRENT_TIMESTAMP,
    "revoked_reason" = 'access_code_missing'
WHERE "mode" = 'PRIVATE'
  AND "access_code_hash" IS NULL
  AND "revoked_at" IS NULL;

-- Exactly one target (file, folder or project) per link. A revoked link may
-- lose its target: the target foreign keys are ON DELETE SET NULL, and every
-- hard delete revokes the links that point at it first.
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_exactly_one_target"
  CHECK (num_nonnulls("fileId", "folderId", "projectId2") = 1 OR "revoked_at" IS NOT NULL);
