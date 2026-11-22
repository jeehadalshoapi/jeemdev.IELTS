CREATE TABLE "mastery_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"ladder" text NOT NULL,
	"ladder_title" text,
	"step_order" integer NOT NULL,
	"title" text NOT NULL,
	"task" text,
	"lesson_id" text,
	"pass_rule" jsonb NOT NULL,
	"status" text DEFAULT 'locked' NOT NULL,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mastery_steps_ladder_idx" ON "mastery_steps" USING btree ("ladder","step_order");