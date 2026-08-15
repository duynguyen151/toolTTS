ALTER TABLE "decision_cases" ADD COLUMN "decision_context_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_decision_context_snapshot_object" CHECK ("decision_cases"."decision_context_snapshot" is null or jsonb_typeof("decision_cases"."decision_context_snapshot") = 'object');--> statement-breakpoint
CREATE FUNCTION "public"."prevent_decision_cases_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'decision_cases are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "decision_cases_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "decision_cases"
  FOR EACH ROW EXECUTE FUNCTION "public"."prevent_decision_cases_mutation"();
