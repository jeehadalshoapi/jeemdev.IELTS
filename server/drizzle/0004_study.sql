CREATE TABLE "lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"day" integer,
	"week" text,
	"skill" text,
	"kind" text DEFAULT 'lesson' NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mistakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"wrong" text NOT NULL,
	"correct" text NOT NULL,
	"pair_key" text NOT NULL,
	"rule" text,
	"arabic" text,
	"source" jsonb,
	"times_wrong" integer DEFAULT 1 NOT NULL,
	"never_again" boolean DEFAULT false NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_reviewed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mistakes_pair_key_unique" UNIQUE("pair_key")
);
--> statement-breakpoint
CREATE TABLE "vocab_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" text NOT NULL,
	"quiz" integer,
	"date" date NOT NULL,
	"score" integer NOT NULL,
	"total" integer NOT NULL,
	"weak_words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempt_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocab_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer,
	"theme" text NOT NULL,
	"study_day" integer,
	"words" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vocab_results" ADD CONSTRAINT "vocab_results_set_id_vocab_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."vocab_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocab_results" ADD CONSTRAINT "vocab_results_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lessons_day_idx" ON "lessons" USING btree ("day");--> statement-breakpoint
CREATE INDEX "mistakes_category_idx" ON "mistakes" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "vocab_results_set_idx" ON "vocab_results" USING btree ("set_id","date");