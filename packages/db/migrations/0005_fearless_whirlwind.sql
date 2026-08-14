CREATE TYPE "public"."ba_decision" AS ENUM('SCALE', 'CONTINUE', 'WATCH', 'PAUSE');--> statement-breakpoint
CREATE TYPE "public"."decision_data_coverage" AS ENUM('COMPLETE', 'PARTIAL', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."decision_rule_result" AS ENUM('PAUSE', 'CONTINUE', 'INSUFFICIENT_DATA');--> statement-breakpoint
CREATE TABLE "ba_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_case_id" uuid NOT NULL,
	"decision" "ba_decision" NOT NULL,
	"confidence" numeric(7, 6),
	"reason_codes" jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ba_decisions_confidence_range" CHECK ("ba_decisions"."confidence" is null or ("ba_decisions"."confidence" >= 0 and "ba_decisions"."confidence" <= 1)),
	CONSTRAINT "ba_decisions_reason_codes_array" CHECK (jsonb_typeof("ba_decisions"."reason_codes") = 'array'),
	CONSTRAINT "ba_decisions_note_not_blank" CHECK ("ba_decisions"."note" is null or length(btrim("ba_decisions"."note")) > 0)
);
--> statement-breakpoint
CREATE TABLE "decision_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"metrics_snapshot" jsonb NOT NULL,
	"risk_snapshot" jsonb NOT NULL,
	"finance_snapshot" jsonb NOT NULL,
	"rule_decision" "decision_rule_result" NOT NULL,
	"rule_triggers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_coverage" "decision_data_coverage" NOT NULL,
	"source_sync_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_cases_metrics_snapshot_object" CHECK (jsonb_typeof("decision_cases"."metrics_snapshot") = 'object'),
	CONSTRAINT "decision_cases_risk_snapshot_object" CHECK (jsonb_typeof("decision_cases"."risk_snapshot") = 'object'),
	CONSTRAINT "decision_cases_finance_snapshot_object" CHECK (jsonb_typeof("decision_cases"."finance_snapshot") = 'object'),
	CONSTRAINT "decision_cases_rule_triggers_array" CHECK (jsonb_typeof("decision_cases"."rule_triggers") = 'array')
);
--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_decision_case_id_decision_cases_id_fk" FOREIGN KEY ("decision_case_id") REFERENCES "public"."decision_cases"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_source_sync_run_shop_fk" FOREIGN KEY ("source_sync_run_id","shop_id") REFERENCES "public"."sync_runs"("id","shop_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ba_decisions_case_created_idx" ON "ba_decisions" USING btree ("decision_case_id","created_at");--> statement-breakpoint
CREATE INDEX "decision_cases_shop_observed_idx" ON "decision_cases" USING btree ("shop_id","observed_at");--> statement-breakpoint
CREATE INDEX "decision_cases_source_sync_run_idx" ON "decision_cases" USING btree ("source_sync_run_id");