ALTER TABLE "ai_decisions" DROP CONSTRAINT "ai_decisions_model_not_blank";--> statement-breakpoint
ALTER TABLE "ai_decisions" DROP CONSTRAINT "ai_decisions_failure_code_known";--> statement-breakpoint
ALTER TABLE "ai_decisions" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD COLUMN "requested_model" text;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD COLUMN "reported_model" text;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD COLUMN "actual_model_used" text;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD COLUMN "auth_mode" text;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD COLUMN "output_schema_version" text;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD COLUMN "ai_policy_version" text;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD COLUMN "risk_level" text;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD COLUMN "rule_override" boolean;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD COLUMN "supporting_factors" jsonb;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD COLUMN "risk_factors" jsonb;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD COLUMN "what_would_change_decision" jsonb;--> statement-breakpoint
ALTER TABLE "decision_cases" ADD COLUMN "coverage_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_requested_model_not_blank" CHECK ("ai_decisions"."requested_model" is null or length(btrim("ai_decisions"."requested_model")) > 0);--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_reported_model_not_blank" CHECK ("ai_decisions"."reported_model" is null or length(btrim("ai_decisions"."reported_model")) > 0);--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_actual_model_not_blank" CHECK ("ai_decisions"."actual_model_used" is null or length(btrim("ai_decisions"."actual_model_used")) > 0);--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_auth_mode_known" CHECK ("ai_decisions"."auth_mode" is null or "ai_decisions"."auth_mode" in ('LOCAL_NO_AUTH', 'BEARER', 'CONFIG_MISSING'));--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_risk_level_known" CHECK ("ai_decisions"."risk_level" is null or "ai_decisions"."risk_level" in ('LOW', 'MEDIUM', 'HIGH'));--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_v1_structured_shape" CHECK ("ai_decisions"."output_schema_version" is null or (
        "ai_decisions"."output_schema_version" = 'decision-ai-output.v1'
        and "ai_decisions"."requested_model" is not null
        and "ai_decisions"."ai_policy_version" is not null
        and "ai_decisions"."auth_mode" is not null
        and (
          ("ai_decisions"."status" = 'AVAILABLE'
            and "ai_decisions"."model" is not null
            and "ai_decisions"."reported_model" is not null
            and "ai_decisions"."actual_model_used" is not null
            and "ai_decisions"."risk_level" is not null
            and "ai_decisions"."rule_override" is not null
            and "ai_decisions"."supporting_factors" is not null
            and jsonb_typeof("ai_decisions"."supporting_factors") = 'array'
            and "ai_decisions"."risk_factors" is not null
            and jsonb_typeof("ai_decisions"."risk_factors") = 'array'
            and "ai_decisions"."what_would_change_decision" is not null
            and jsonb_typeof("ai_decisions"."what_would_change_decision") = 'array')
          or
          ("ai_decisions"."status" = 'UNAVAILABLE'
            and "ai_decisions"."model" is null
            and "ai_decisions"."reported_model" is null
            and "ai_decisions"."actual_model_used" is null
            and "ai_decisions"."risk_level" is null
            and "ai_decisions"."rule_override" is null
            and "ai_decisions"."supporting_factors" is null
            and "ai_decisions"."risk_factors" is null
            and "ai_decisions"."what_would_change_decision" is null)
        )
      ));--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_model_not_blank" CHECK ("ai_decisions"."model" is null or length(btrim("ai_decisions"."model")) > 0);--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_failure_code_known" CHECK ("ai_decisions"."failure_code" is null or "ai_decisions"."failure_code" in (
        'FEATURE_DISABLED', 'CONFIG_MISSING', 'TIMEOUT', 'NETWORK_ERROR',
        'HTTP_ERROR', 'RATE_LIMITED', 'INVALID_RESPONSE', 'PROVIDER_UNAVAILABLE',
        'MODEL_UNAVAILABLE', 'MODEL_NOT_ALLOWED',
        'MISSING_API_KEY', 'NOT_CONFIGURED', 'MALFORMED_RESPONSE', 'INVALID_OUTPUT'
      ));--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_coverage_snapshot_object" CHECK ("decision_cases"."coverage_snapshot" is null or jsonb_typeof("decision_cases"."coverage_snapshot") = 'object');