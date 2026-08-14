CREATE TYPE "public"."ai_decision_status" AS ENUM('AVAILABLE', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."decision_data_origin" AS ENUM('LIVE', 'DEMO_SANITIZED');--> statement-breakpoint
CREATE TYPE "public"."decision_execution_action" AS ENUM('HOLIDAY_MODE_ON');--> statement-breakpoint
CREATE TYPE "public"."decision_execution_mode" AS ENUM('DRY_RUN');--> statement-breakpoint
CREATE TYPE "public"."decision_execution_status" AS ENUM('SIMULATED');--> statement-breakpoint
CREATE TABLE "ai_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"decision_case_id" uuid NOT NULL,
	"status" "ai_decision_status" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"recommendation" "ba_decision",
	"confidence" numeric(7, 6),
	"reason_codes" jsonb,
	"reason" text,
	"human_review_required" boolean NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_decisions_case_unique" UNIQUE("decision_case_id"),
	CONSTRAINT "ai_decisions_provider_not_blank" CHECK (length(btrim("ai_decisions"."provider")) > 0),
	CONSTRAINT "ai_decisions_model_not_blank" CHECK (length(btrim("ai_decisions"."model")) > 0),
	CONSTRAINT "ai_decisions_prompt_version_not_blank" CHECK (length(btrim("ai_decisions"."prompt_version")) > 0),
	CONSTRAINT "ai_decisions_policy_version_not_blank" CHECK (length(btrim("ai_decisions"."policy_version")) > 0),
	CONSTRAINT "ai_decisions_available_shape" CHECK (
        ("ai_decisions"."status" = 'AVAILABLE'
          and "ai_decisions"."recommendation" is not null
          and "ai_decisions"."confidence" is not null
          and "ai_decisions"."confidence" >= 0 and "ai_decisions"."confidence" <= 1
          and "ai_decisions"."reason_codes" is not null
          and jsonb_typeof("ai_decisions"."reason_codes") = 'array'
          and jsonb_array_length("ai_decisions"."reason_codes") > 0
          and "ai_decisions"."reason" is not null and length(btrim("ai_decisions"."reason")) > 0
          and "ai_decisions"."failure_code" is null)
        or
        ("ai_decisions"."status" = 'UNAVAILABLE'
          and "ai_decisions"."recommendation" is null
          and "ai_decisions"."confidence" is null
          and "ai_decisions"."reason_codes" is null
          and "ai_decisions"."reason" is null
          and "ai_decisions"."human_review_required"
          and "ai_decisions"."failure_code" is not null
          and length(btrim("ai_decisions"."failure_code")) > 0)
      )
);
--> statement-breakpoint
CREATE TABLE "decision_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"decision_case_id" uuid NOT NULL,
	"ba_decision_id" uuid NOT NULL,
	"requested_action" "decision_execution_action" NOT NULL,
	"execution_mode" "decision_execution_mode" NOT NULL,
	"execution_status" "decision_execution_status" NOT NULL,
	"seller_center_called" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_executions_case_unique" UNIQUE("decision_case_id"),
	CONSTRAINT "decision_executions_dry_run_only" CHECK ("decision_executions"."requested_action" = 'HOLIDAY_MODE_ON'
        and "decision_executions"."execution_mode" = 'DRY_RUN'
        and "decision_executions"."execution_status" = 'SIMULATED'
        and not "decision_executions"."seller_center_called")
);
--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD COLUMN "request_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_cases" ADD COLUMN "request_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_cases" ADD COLUMN "case_origin" "decision_data_origin" DEFAULT 'LIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "data_origin" "decision_data_origin" DEFAULT 'LIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_case_unique" UNIQUE("decision_case_id");--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_id_case_unique" UNIQUE("id","decision_case_id");--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_id_data_origin_unique" UNIQUE("id","data_origin");--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_decision_case_id_decision_cases_id_fk" FOREIGN KEY ("decision_case_id") REFERENCES "public"."decision_cases"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "decision_executions" ADD CONSTRAINT "decision_executions_decision_case_id_decision_cases_id_fk" FOREIGN KEY ("decision_case_id") REFERENCES "public"."decision_cases"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "decision_executions" ADD CONSTRAINT "decision_executions_ba_case_fk" FOREIGN KEY ("ba_decision_id","decision_case_id") REFERENCES "public"."ba_decisions"("id","decision_case_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_decisions_request_id_unique" ON "ai_decisions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "ai_decisions_case_created_idx" ON "ai_decisions" USING btree ("decision_case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_executions_request_id_unique" ON "decision_executions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "decision_executions_ba_decision_idx" ON "decision_executions" USING btree ("ba_decision_id");--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_shop_origin_fk" FOREIGN KEY ("shop_id","case_origin") REFERENCES "public"."shops"("id","data_origin") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ba_decisions_request_id_unique" ON "ba_decisions" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_cases_request_id_unique" ON "decision_cases" USING btree ("request_id");--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_demo_has_no_sync_run" CHECK ("decision_cases"."case_origin" <> 'DEMO_SANITIZED' or "decision_cases"."source_sync_run_id" is null);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_demo_disabled" CHECK ("shops"."data_origin" <> 'DEMO_SANITIZED' or (not "shops"."enabled" and "shops"."sync_state" = 'DISABLED'));
