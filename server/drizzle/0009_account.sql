CREATE TABLE "account" (
	"id" integer PRIMARY KEY NOT NULL,
	"username" text,
	"password_hash" text,
	"env_tag" text,
	"password_changed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
