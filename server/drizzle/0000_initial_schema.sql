CREATE TYPE "public"."attempt_mode" AS ENUM('exam', 'practice');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('in_progress', 'submitted', 'marked');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('audio', 'image', 'recording');--> statement-breakpoint
CREATE TYPE "public"."test_kind" AS ENUM('homework', 'practice', 'full_mock');--> statement-breakpoint
CREATE TYPE "public"."test_skill" AS ENUM('reading', 'listening', 'writing', 'speaking', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."test_source" AS ENUM('claude', 'manual');--> statement-breakpoint
CREATE TYPE "public"."test_status" AS ENUM('assigned', 'archived');--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"status" "attempt_status" DEFAULT 'in_progress' NOT NULL,
	"mode" "attempt_mode" DEFAULT 'practice' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"time_spent_sec" jsonb DEFAULT '{"total":0}'::jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"auto_score" jsonb,
	"feedback" jsonb,
	"device_log" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "file_kind" NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_path" text NOT NULL,
	"test_id" uuid,
	"attempt_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"skill" "test_skill" NOT NULL,
	"kind" "test_kind" DEFAULT 'practice' NOT NULL,
	"status" "test_status" DEFAULT 'assigned' NOT NULL,
	"due_date" date,
	"instructions" text,
	"content" jsonb NOT NULL,
	"answer_key" jsonb NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"source" "test_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempts_test_idx" ON "attempts" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "attempts_status_idx" ON "attempts" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "files_test_idx" ON "files" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "files_attempt_idx" ON "files" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "tests_status_created_idx" ON "tests" USING btree ("status","created_at");