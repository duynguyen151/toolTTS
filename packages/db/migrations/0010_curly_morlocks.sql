ALTER TABLE "decision_executions" DROP CONSTRAINT "decision_executions_dry_run_only";--> statement-breakpoint
ALTER TABLE "decision_executions" DROP CONSTRAINT "decision_executions_ba_case_fk";
--> statement-breakpoint
ALTER TABLE "decision_executions" ADD COLUMN "ba_decision" "ba_decision";--> statement-breakpoint
UPDATE "decision_executions" AS "execution"
SET "ba_decision" = "ba"."decision"
FROM "ba_decisions" AS "ba"
WHERE "execution"."ba_decision_id" = "ba"."id"
  AND "execution"."decision_case_id" = "ba"."decision_case_id";--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_id_case_decision_unique" UNIQUE("id","decision_case_id","decision");--> statement-breakpoint
ALTER TABLE "decision_executions" ALTER COLUMN "ba_decision" SET DEFAULT 'PAUSE';--> statement-breakpoint
ALTER TABLE "decision_executions" ALTER COLUMN "ba_decision" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_executions" ADD CONSTRAINT "decision_executions_ba_case_decision_fk" FOREIGN KEY ("ba_decision_id","decision_case_id","ba_decision") REFERENCES "public"."ba_decisions"("id","decision_case_id","decision") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
UPDATE "decision_cases"
SET "risk_snapshot" = "risk_snapshot"
  || CASE WHEN "risk_snapshot" ? 'stopOnHoldValueAt'
    THEN '{}'::jsonb ELSE jsonb_build_object('stopOnHoldValueAt', '3500.0000') END
  || CASE WHEN "risk_snapshot" ? 'stopDeliveryRateBelow'
    THEN '{}'::jsonb ELSE jsonb_build_object('stopDeliveryRateBelow', 0.7) END
  || CASE WHEN "risk_snapshot" ? 'minimumOrdersForRateRule'
    THEN '{}'::jsonb ELSE jsonb_build_object('minimumOrdersForRateRule', 0) END
WHERE "risk_snapshot"->>'policyVersion' = 'risk-control-policy.v1';--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_risk_thresholds_present" CHECK ("decision_cases"."risk_snapshot" ?& array[
          'stopOnHoldValueAt',
          'stopDeliveryRateBelow',
          'minimumOrdersForRateRule'
        ]
        and jsonb_typeof("decision_cases"."risk_snapshot"->'stopOnHoldValueAt') = 'string'
        and jsonb_typeof("decision_cases"."risk_snapshot"->'stopDeliveryRateBelow') = 'number'
        and jsonb_typeof("decision_cases"."risk_snapshot"->'minimumOrdersForRateRule') = 'number');--> statement-breakpoint
ALTER TABLE "decision_executions" ADD CONSTRAINT "decision_executions_dry_run_only" CHECK ("decision_executions"."requested_action" = 'HOLIDAY_MODE_ON'
        and "decision_executions"."ba_decision" = 'PAUSE'
        and "decision_executions"."execution_mode" = 'DRY_RUN'
        and "decision_executions"."execution_status" = 'SIMULATED'
        and not "decision_executions"."seller_center_called");--> statement-breakpoint
CREATE FUNCTION "prevent_shops_data_origin_update"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."data_origin" IS DISTINCT FROM OLD."data_origin" THEN
    RAISE EXCEPTION 'shops.data_origin is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "shops_data_origin_immutable"
BEFORE UPDATE OF "data_origin" ON "shops"
FOR EACH ROW
EXECUTE FUNCTION "prevent_shops_data_origin_update"();
