CREATE TYPE "public"."risk_desired_state" AS ENUM('HOLIDAY_MODE_ON', 'HOLIDAY_MODE_OFF', 'INSUFFICIENT_DATA');--> statement-breakpoint
CREATE TABLE "risk_control_states" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"desired_state" "risk_desired_state" NOT NULL,
	"observed_holiday_mode_enabled" boolean,
	"automation_owned" boolean DEFAULT false NOT NULL,
	"consecutive_safe_cycles" integer DEFAULT 0 NOT NULL,
	"decision" jsonb NOT NULL,
	"policy_version" text NOT NULL,
	"last_evaluated_at" timestamp with time zone NOT NULL,
	"last_action_at" timestamp with time zone,
	"last_action_status" text,
	"last_action_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_control_states_safe_cycles_nonnegative" CHECK ("risk_control_states"."consecutive_safe_cycles" >= 0),
	CONSTRAINT "risk_control_states_policy_version_not_blank" CHECK (length(btrim("risk_control_states"."policy_version")) > 0),
	CONSTRAINT "risk_control_states_action_error_requires_status" CHECK ("risk_control_states"."last_action_error" is null or "risk_control_states"."last_action_status" is not null)
);
--> statement-breakpoint
ALTER TABLE "risk_control_states" ADD CONSTRAINT "risk_control_states_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade;