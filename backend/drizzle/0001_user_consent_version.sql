-- Accounts created before this migration accepted the first consent text: they get version '1'.
-- The default exists only for that backfill; afterwards every insert must name the version.
ALTER TABLE "users" ADD COLUMN "gdpr_consent_version" varchar(20) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "gdpr_consent_version" DROP DEFAULT;
