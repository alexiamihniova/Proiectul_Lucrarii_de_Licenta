CREATE TABLE "sentences" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sentences_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"document_id" bigint NOT NULL,
	"passage_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"paragraph" integer NOT NULL,
	"page" integer NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "sentences_position_check" CHECK ("sentences"."position" >= 0),
	CONSTRAINT "sentences_paragraph_check" CHECK ("sentences"."paragraph" >= 0),
	CONSTRAINT "sentences_page_check" CHECK ("sentences"."page" >= 1),
	CONSTRAINT "sentences_offsets_check" CHECK ("sentences"."start_offset" >= 0 and "sentences"."end_offset" > "sentences"."start_offset"),
	CONSTRAINT "sentences_text_check" CHECK (char_length("sentences"."text") >= 1)
);
--> statement-breakpoint
DROP INDEX "subjects_user_id_name_key";--> statement-breakpoint
ALTER TABLE "sentences" ADD CONSTRAINT "sentences_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentences" ADD CONSTRAINT "sentences_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sentences_document_id_position_key" ON "sentences" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "sentences_passage_id_idx" ON "sentences" USING btree ("passage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_user_id_name_key" ON "subjects" USING btree ("user_id",lower("name"));