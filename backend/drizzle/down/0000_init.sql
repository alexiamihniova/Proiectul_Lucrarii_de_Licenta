-- Reverts 0000_init.sql: drops everything it created, children first.
DROP TRIGGER IF EXISTS documents_enforce_status_transition ON "documents";
DROP FUNCTION IF EXISTS documents_enforce_status_transition();
DROP TABLE IF EXISTS "settings";
DROP TABLE IF EXISTS "llm_calls";
DROP TABLE IF EXISTS "reviews";
DROP TABLE IF EXISTS "concept_progress";
DROP TABLE IF EXISTS "material_reports";
DROP TABLE IF EXISTS "answers";
DROP TABLE IF EXISTS "tests";
DROP TABLE IF EXISTS "materials";
DROP TABLE IF EXISTS "concept_passages";
DROP TABLE IF EXISTS "concepts";
DROP TABLE IF EXISTS "passages";
DROP TABLE IF EXISTS "documents";
DROP TABLE IF EXISTS "subjects";
DROP TABLE IF EXISTS "password_reset_tokens";
DROP TABLE IF EXISTS "preferences";
DROP TABLE IF EXISTS "users";
