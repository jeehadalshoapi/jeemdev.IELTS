ALTER TABLE "files" ADD COLUMN "pauses_over_3s" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "longest_pause_sec" real;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "speaking_sec" real;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "transcript_status" text;