CREATE TYPE "public"."refresh_checkpoint_attempt_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."refresh_checkpoint_run_status" AS ENUM('RETRY_WAIT', 'RUNNING', 'SUCCEEDED', 'FAILED_EXHAUSTED');--> statement-breakpoint
CREATE TABLE "refresh_checkpoint_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "refresh_checkpoint_attempt_status" DEFAULT 'RUNNING' NOT NULL,
	"claim_token" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_checkpoint_attempts_run_number_unique" UNIQUE("run_id","attempt_number"),
	CONSTRAINT "refresh_checkpoint_attempts_run_claim_unique" UNIQUE("run_id","claim_token"),
	CONSTRAINT "refresh_checkpoint_attempts_number_positive" CHECK ("refresh_checkpoint_attempts"."attempt_number" > 0),
	CONSTRAINT "refresh_checkpoint_attempts_status_consistent" CHECK ((
      ("refresh_checkpoint_attempts"."status" = 'RUNNING' and "refresh_checkpoint_attempts"."finished_at" is null and "refresh_checkpoint_attempts"."next_attempt_at" is null and "refresh_checkpoint_attempts"."failure_message" is null)
      or ("refresh_checkpoint_attempts"."status" = 'SUCCEEDED' and "refresh_checkpoint_attempts"."finished_at" is not null and "refresh_checkpoint_attempts"."next_attempt_at" is null and "refresh_checkpoint_attempts"."failure_message" is null)
      or ("refresh_checkpoint_attempts"."status" = 'FAILED' and "refresh_checkpoint_attempts"."finished_at" is not null and "refresh_checkpoint_attempts"."failure_message" is not null)
    )),
	CONSTRAINT "refresh_checkpoint_attempts_timestamps_finite" CHECK ("refresh_checkpoint_attempts"."started_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz) and "refresh_checkpoint_attempts"."created_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz) and ("refresh_checkpoint_attempts"."finished_at" is null or "refresh_checkpoint_attempts"."finished_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)) and ("refresh_checkpoint_attempts"."next_attempt_at" is null or "refresh_checkpoint_attempts"."next_attempt_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)))
);
--> statement-breakpoint
CREATE TABLE "refresh_checkpoint_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"business_date" text NOT NULL,
	"status" "refresh_checkpoint_run_status" DEFAULT 'RETRY_WAIT' NOT NULL,
	"retry_offsets_seconds" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"claim_token" uuid,
	"cycle_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_checkpoint_runs_shop_date_checkpoint_unique" UNIQUE("shop_id","business_date","checkpoint_id"),
	CONSTRAINT "refresh_checkpoint_runs_business_date_valid" CHECK ("refresh_checkpoint_runs"."business_date" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "refresh_checkpoint_runs_retry_offsets_valid" CHECK (public.refresh_retry_offsets_valid("refresh_checkpoint_runs"."retry_offsets_seconds")),
	CONSTRAINT "refresh_checkpoint_runs_attempt_count_bounded" CHECK ("refresh_checkpoint_runs"."attempt_count" between 0 and jsonb_array_length("refresh_checkpoint_runs"."retry_offsets_seconds")),
	CONSTRAINT "refresh_checkpoint_runs_status_consistent" CHECK ((
      ("refresh_checkpoint_runs"."status" = 'RETRY_WAIT' and "refresh_checkpoint_runs"."next_attempt_at" is not null and "refresh_checkpoint_runs"."claimed_at" is null and "refresh_checkpoint_runs"."claim_token" is null and "refresh_checkpoint_runs"."completed_at" is null)
      or ("refresh_checkpoint_runs"."status" = 'RUNNING' and "refresh_checkpoint_runs"."next_attempt_at" is null and "refresh_checkpoint_runs"."claimed_at" is not null and "refresh_checkpoint_runs"."claim_token" is not null and "refresh_checkpoint_runs"."completed_at" is null)
      or ("refresh_checkpoint_runs"."status" in ('SUCCEEDED', 'FAILED_EXHAUSTED') and "refresh_checkpoint_runs"."completed_at" is not null and "refresh_checkpoint_runs"."next_attempt_at" is null and "refresh_checkpoint_runs"."claimed_at" is null and "refresh_checkpoint_runs"."claim_token" is null)
    )),
	CONSTRAINT "refresh_checkpoint_runs_timestamps_finite" CHECK ("refresh_checkpoint_runs"."cycle_started_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz) and "refresh_checkpoint_runs"."created_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz) and "refresh_checkpoint_runs"."updated_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz) and ("refresh_checkpoint_runs"."next_attempt_at" is null or "refresh_checkpoint_runs"."next_attempt_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)) and ("refresh_checkpoint_runs"."claimed_at" is null or "refresh_checkpoint_runs"."claimed_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)) and ("refresh_checkpoint_runs"."completed_at" is null or "refresh_checkpoint_runs"."completed_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)))
);
--> statement-breakpoint
ALTER TABLE "refresh_checkpoint_attempts" ADD CONSTRAINT "refresh_checkpoint_attempts_run_id_refresh_checkpoint_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."refresh_checkpoint_runs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "refresh_checkpoint_runs" ADD CONSTRAINT "refresh_checkpoint_runs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "refresh_checkpoint_runs" ADD CONSTRAINT "refresh_checkpoint_runs_checkpoint_id_refresh_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."refresh_checkpoints"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "refresh_checkpoint_attempts_run_started_idx" ON "refresh_checkpoint_attempts" USING btree ("run_id","started_at");--> statement-breakpoint
CREATE INDEX "refresh_checkpoint_runs_due_idx" ON "refresh_checkpoint_runs" USING btree ("status","next_attempt_at","claimed_at");--> statement-breakpoint
CREATE INDEX "refresh_checkpoint_runs_shop_date_idx" ON "refresh_checkpoint_runs" USING btree ("shop_id","business_date");