CREATE TYPE "public"."risk_action_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'SKIPPED_MANUAL', 'SKIPPED_IDEMPOTENT');--> statement-breakpoint
ALTER TABLE "risk_control_states" ALTER COLUMN "last_action_status" SET DATA TYPE "public"."risk_action_status" USING "last_action_status"::"public"."risk_action_status";--> statement-breakpoint
ALTER TABLE "risk_control_states" ADD COLUMN "last_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "risk_control_states" ADD CONSTRAINT "risk_control_states_action_error_matches_status" CHECK (
        ("risk_control_states"."last_action_status" = 'FAILED' and "risk_control_states"."last_action_error" is not null)
        or ("risk_control_states"."last_action_status" is distinct from 'FAILED' and "risk_control_states"."last_action_error" is null)
      );--> statement-breakpoint
ALTER TABLE "risk_control_states" ADD CONSTRAINT "risk_control_states_automation_ownership_requires_enabled_observation" CHECK (not "risk_control_states"."automation_owned" or "risk_control_states"."observed_holiday_mode_enabled" is true);