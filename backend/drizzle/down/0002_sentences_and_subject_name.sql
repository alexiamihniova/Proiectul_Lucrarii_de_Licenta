-- Reverts 0002_sentences_and_subject_name.sql.
-- The exact-name index is weaker than the lower-case one, so recreating it cannot fail.
DROP INDEX IF EXISTS "subjects_user_id_name_key";
CREATE UNIQUE INDEX "subjects_user_id_name_key" ON "subjects" USING btree ("user_id","name");
DROP TABLE IF EXISTS "sentences";
