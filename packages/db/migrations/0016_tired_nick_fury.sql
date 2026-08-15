ALTER TABLE "sync_runs" ADD COLUMN "source_complete" boolean;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "source_captured_at" timestamp with time zone;