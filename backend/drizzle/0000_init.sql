CREATE TABLE "password_reset_tokens" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "password_reset_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_expiry_check" CHECK ("password_reset_tokens"."expires_at" > "password_reset_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"theme" varchar(20) DEFAULT 'light' NOT NULL,
	"mascot_enabled" boolean DEFAULT true NOT NULL,
	"reminder_time" time DEFAULT '18:00' NOT NULL,
	"reminder_channel" varchar(20) DEFAULT 'in_app' NOT NULL,
	"daily_goal" integer DEFAULT 20 NOT NULL,
	"last_reminder_sent_on" date,
	CONSTRAINT "preferences_theme_check" CHECK ("preferences"."theme" in ('light', 'dark')),
	CONSTRAINT "preferences_reminder_channel_check" CHECK ("preferences"."reminder_channel" in ('email', 'in_app', 'both')),
	CONSTRAINT "preferences_daily_goal_check" CHECK ("preferences"."daily_goal" between 5 and 100)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" varchar(254) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" varchar(20) DEFAULT 'student' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"gdpr_consent_at" timestamp with time zone NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('student', 'admin')),
	CONSTRAINT "users_status_check" CHECK ("users"."status" in ('active', 'blocked')),
	CONSTRAINT "users_failed_login_attempts_check" CHECK ("users"."failed_login_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "documents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subject_id" bigint NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"format" varchar(10) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"page_count" integer,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"error_reason" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_started_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_format_check" CHECK ("documents"."format" in ('pdf', 'docx', 'txt')),
	CONSTRAINT "documents_status_check" CHECK ("documents"."status" in ('queued', 'processing', 'ready', 'error', 'deleted')),
	CONSTRAINT "documents_file_name_check" CHECK (char_length(btrim("documents"."file_name")) >= 1),
	CONSTRAINT "documents_size_bytes_check" CHECK ("documents"."size_bytes" > 0),
	CONSTRAINT "documents_page_count_check" CHECK ("documents"."page_count" is null or "documents"."page_count" >= 1),
	CONSTRAINT "documents_error_reason_check" CHECK (("documents"."status" = 'error') = ("documents"."error_reason" is not null)),
	CONSTRAINT "documents_deleted_at_check" CHECK (("documents"."status" = 'deleted') = ("documents"."deleted_at" is not null)),
	CONSTRAINT "documents_processing_started_at_check" CHECK ("documents"."status" <> 'processing' or "documents"."processing_started_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "passages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "passages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"document_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"page" integer NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "passages_position_check" CHECK ("passages"."position" >= 0),
	CONSTRAINT "passages_page_check" CHECK ("passages"."page" >= 1),
	CONSTRAINT "passages_offsets_check" CHECK ("passages"."start_offset" >= 0 and "passages"."end_offset" > "passages"."start_offset"),
	CONSTRAINT "passages_text_check" CHECK (char_length("passages"."text") >= 1)
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subjects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_name_check" CHECK (char_length(btrim("subjects"."name")) >= 1)
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "answers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"test_id" bigint,
	"material_id" bigint NOT NULL,
	"given_answer" text NOT NULL,
	"score" numeric(2, 1),
	"quality" smallint,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answers_score_check" CHECK ("answers"."score" is null or "answers"."score" in (0, 0.5, 1)),
	CONSTRAINT "answers_quality_check" CHECK ("answers"."quality" is null or "answers"."quality" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "concept_passages" (
	"concept_id" bigint NOT NULL,
	"passage_id" bigint NOT NULL,
	CONSTRAINT "concept_passages_concept_id_passage_id_pk" PRIMARY KEY("concept_id","passage_id")
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "concepts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subject_id" bigint NOT NULL,
	"name" varchar(80) NOT NULL,
	"definition" varchar(300) DEFAULT '' NOT NULL,
	"origin" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concepts_name_check" CHECK (char_length(btrim("concepts"."name")) >= 1),
	CONSTRAINT "concepts_origin_check" CHECK ("concepts"."origin" in ('model', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "material_reports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "material_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"material_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"reason" varchar(300) NOT NULL,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_reports_reason_check" CHECK (char_length(btrim("material_reports"."reason")) >= 1),
	CONSTRAINT "material_reports_status_check" CHECK ("material_reports"."status" in ('new', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "materials_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"concept_id" bigint NOT NULL,
	"passage_id" bigint NOT NULL,
	"type" varchar(20) NOT NULL,
	"statement" text NOT NULL,
	"correct_answer" text,
	"options" jsonb,
	"explanation" text,
	"quote" text,
	"source_verified" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'valid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_type_check" CHECK ("materials"."type" in ('summary', 'flashcard', 'multiple_choice', 'open', 'true_false')),
	CONSTRAINT "materials_status_check" CHECK ("materials"."status" in ('valid', 'reported', 'removed')),
	CONSTRAINT "materials_statement_check" CHECK (char_length(btrim("materials"."statement")) >= 1),
	CONSTRAINT "materials_options_check" CHECK (case when "materials"."type" = 'multiple_choice'
            then "materials"."options" is not null
                 and jsonb_typeof("materials"."options") = 'array'
                 and jsonb_array_length("materials"."options") = 4
            else "materials"."options" is null end),
	CONSTRAINT "materials_correct_answer_check" CHECK ("materials"."type" = 'summary' or "materials"."correct_answer" is not null),
	CONSTRAINT "materials_valid_requires_verified_source_check" CHECK ("materials"."status" <> 'valid' or "materials"."source_verified")
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"subject_id" bigint NOT NULL,
	"config" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"total_score" numeric(5, 2),
	CONSTRAINT "tests_total_score_check" CHECK ("tests"."total_score" is null or "tests"."total_score" between 0 and 100),
	CONSTRAINT "tests_finished_at_check" CHECK ("tests"."finished_at" is null or "tests"."finished_at" >= "tests"."started_at"),
	CONSTRAINT "tests_score_requires_finish_check" CHECK ("tests"."total_score" is null or "tests"."finished_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "concept_progress" (
	"user_id" bigint NOT NULL,
	"concept_id" bigint NOT NULL,
	"mastery" smallint DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"celebrated" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_progress_user_id_concept_id_pk" PRIMARY KEY("user_id","concept_id"),
	CONSTRAINT "concept_progress_mastery_check" CHECK ("concept_progress"."mastery" between 0 and 100),
	CONSTRAINT "concept_progress_status_check" CHECK ("concept_progress"."status" in ('new', 'to_review', 'in_progress', 'mastered'))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"user_id" bigint NOT NULL,
	"concept_id" bigint NOT NULL,
	"ease_factor" numeric(4, 2) DEFAULT 2.5 NOT NULL,
	"repetitions" integer DEFAULT 0 NOT NULL,
	"interval_days" integer DEFAULT 0 NOT NULL,
	"due_date" date NOT NULL,
	CONSTRAINT "reviews_user_id_concept_id_pk" PRIMARY KEY("user_id","concept_id"),
	CONSTRAINT "reviews_ease_factor_check" CHECK ("reviews"."ease_factor" >= 1.3),
	CONSTRAINT "reviews_repetitions_check" CHECK ("reviews"."repetitions" >= 0),
	CONSTRAINT "reviews_interval_days_check" CHECK ("reviews"."interval_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "llm_calls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint,
	"document_id" bigint,
	"operation" varchar(30) NOT NULL,
	"status" varchar(20) NOT NULL,
	"error_code" varchar(50),
	"attempt" smallint DEFAULT 1 NOT NULL,
	"duration_ms" integer NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost" numeric(12, 6) DEFAULT 0 NOT NULL,
	"items_received" integer,
	"items_accepted" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_calls_operation_check" CHECK ("llm_calls"."operation" in ('extract_concepts', 'generate_materials', 'evaluate_answer')),
	CONSTRAINT "llm_calls_status_check" CHECK ("llm_calls"."status" in ('success', 'error', 'timeout', 'invalid_response')),
	CONSTRAINT "llm_calls_error_code_check" CHECK (("llm_calls"."status" = 'success') = ("llm_calls"."error_code" is null)),
	CONSTRAINT "llm_calls_attempt_check" CHECK ("llm_calls"."attempt" between 1 and 3),
	CONSTRAINT "llm_calls_counters_check" CHECK ("llm_calls"."duration_ms" >= 0 and "llm_calls"."input_tokens" >= 0 and "llm_calls"."output_tokens" >= 0 and "llm_calls"."estimated_cost" >= 0),
	CONSTRAINT "llm_calls_items_check" CHECK (("llm_calls"."items_received" is null and "llm_calls"."items_accepted" is null)
          or ("llm_calls"."items_accepted" >= 0 and "llm_calls"."items_received" >= "llm_calls"."items_accepted"))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_passages" ADD CONSTRAINT "concept_passages_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_passages" ADD CONSTRAINT "concept_passages_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_reports" ADD CONSTRAINT "material_reports_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_reports" ADD CONSTRAINT "material_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_progress" ADD CONSTRAINT "concept_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_progress" ADD CONSTRAINT "concept_progress_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "documents_subject_id_uploaded_at_idx" ON "documents" USING btree ("subject_id","uploaded_at");--> statement-breakpoint
CREATE INDEX "documents_queue_idx" ON "documents" USING btree ("uploaded_at") WHERE "documents"."status" = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "passages_document_id_position_key" ON "passages" USING btree ("document_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_user_id_name_key" ON "subjects" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "answers_material_id_answered_at_idx" ON "answers" USING btree ("material_id","answered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_test_id_material_id_key" ON "answers" USING btree ("test_id","material_id") WHERE "answers"."test_id" is not null;--> statement-breakpoint
CREATE INDEX "concept_passages_passage_id_idx" ON "concept_passages" USING btree ("passage_id");--> statement-breakpoint
CREATE INDEX "concepts_subject_id_idx" ON "concepts" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_reports_material_id_user_id_key" ON "material_reports" USING btree ("material_id","user_id");--> statement-breakpoint
CREATE INDEX "material_reports_status_created_at_idx" ON "material_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "material_reports_user_id_idx" ON "material_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "materials_concept_id_type_idx" ON "materials" USING btree ("concept_id","type");--> statement-breakpoint
CREATE INDEX "materials_passage_id_idx" ON "materials" USING btree ("passage_id");--> statement-breakpoint
CREATE INDEX "tests_user_id_started_at_idx" ON "tests" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "tests_subject_id_idx" ON "tests" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "concept_progress_concept_id_idx" ON "concept_progress" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "reviews_user_id_due_date_idx" ON "reviews" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "reviews_concept_id_idx" ON "reviews" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "llm_calls_created_at_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_user_id_idx" ON "llm_calls" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "llm_calls_document_id_idx" ON "llm_calls" USING btree ("document_id");--> statement-breakpoint
-- Hand-written part (not produced by drizzle-kit): the document state machine.
-- Encodes Dosar, Tabelul 3.1. Allowed: queued->processing (PP), processing->ready (PR),
-- processing->error (PE), ready|error->queued (RP), any active state->deleted (ȘT),
-- same state (RD: rename). Everything else, and any change to a deleted row, is rejected,
-- which also makes late model results harmless (C-08, C-10).
CREATE FUNCTION documents_enforce_status_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'a document must be created in status "queued", got "%"', NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'documents_status_transition';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'deleted' THEN
    RAISE EXCEPTION 'document % is deleted and cannot be changed', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'documents_status_transition';
  END IF;

  IF NEW.status = OLD.status OR NEW.status = 'deleted' THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('queued', 'processing'),
    ('processing', 'ready'),
    ('processing', 'error'),
    ('ready', 'queued'),
    ('error', 'queued')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid document status transition: % -> %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation', CONSTRAINT = 'documents_status_transition';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER documents_enforce_status_transition
  BEFORE INSERT OR UPDATE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION documents_enforce_status_transition();
