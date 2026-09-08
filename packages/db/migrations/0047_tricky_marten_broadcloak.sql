CREATE TABLE "cotik_tracking_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text DEFAULT 'STANDARD' NOT NULL,
	"source_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_tracking_runs_mode_check" CHECK ("cotik_tracking_runs"."mode" IN ('STANDARD', 'REPLAY')),
	CONSTRAINT "cotik_tracking_runs_replay_source_check" CHECK ("cotik_tracking_runs"."mode" <> 'REPLAY' OR "cotik_tracking_runs"."source_run_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO "cotik_tracking_runs" ("id", "mode") VALUES ('00000000-0000-4000-8000-000000000021', 'STANDARD');
--> statement-breakpoint
DROP INDEX "cotik_post_intents_fingerprint_idx";--> statement-breakpoint
DROP INDEX "cotik_tracking_candidates_fingerprint_idx";--> statement-breakpoint
ALTER TABLE "cotik_post_intents" ADD COLUMN "run_id" uuid DEFAULT '00000000-0000-4000-8000-000000000021' NOT NULL;--> statement-breakpoint
ALTER TABLE "cotik_tracking_candidates" ADD COLUMN "run_id" uuid DEFAULT '00000000-0000-4000-8000-000000000021' NOT NULL;--> statement-breakpoint
ALTER TABLE "cotik_tracking_runs" ADD CONSTRAINT "cotik_tracking_runs_source_run_id_cotik_tracking_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."cotik_tracking_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_post_intents" ADD CONSTRAINT "cotik_post_intents_run_id_cotik_tracking_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."cotik_tracking_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_tracking_candidates" ADD CONSTRAINT "cotik_tracking_candidates_run_id_cotik_tracking_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."cotik_tracking_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_post_intents_fingerprint_idx" ON "cotik_post_intents" USING btree ("run_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_tracking_candidates_fingerprint_idx" ON "cotik_tracking_candidates" USING btree ("run_id","fingerprint");
