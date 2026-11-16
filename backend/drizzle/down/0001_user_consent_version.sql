-- Reverts 0001_user_consent_version.sql.
ALTER TABLE "users" DROP COLUMN IF EXISTS "gdpr_consent_version";
