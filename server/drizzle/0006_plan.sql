CREATE TABLE "plan_days" (
	"day" integer PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"title" text NOT NULL,
	"skill" text,
	"notes" text,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_days_date_unique" UNIQUE("date")
);
