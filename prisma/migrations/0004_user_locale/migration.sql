-- Story 3.1: per-user UI locale. Null means the instance default
-- (DEFAULT_LOCALE env, then English).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locale" TEXT;

-- Only language tags such as "en" or "pt-BR" (the API also checks the
-- supported list).
ALTER TABLE "users" ADD CONSTRAINT "users_locale_format"
  CHECK ("locale" IS NULL OR "locale" ~ '^[a-z]{2}(-[A-Z]{2})?$');
