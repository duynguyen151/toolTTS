CREATE TYPE "public"."risk_policy_scope" AS ENUM('GLOBAL', 'SHOP');--> statement-breakpoint
CREATE TABLE "risk_policy_revisions" (
  "revision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sequence" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "scope" "risk_policy_scope" NOT NULL,
  "shop_id" uuid,
  "enabled" boolean DEFAULT true NOT NULL,
  "payload" jsonb NOT NULL,
  "effective_from" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "risk_policy_revisions_sequence_unique" UNIQUE("sequence"),
  CONSTRAINT "risk_policy_revisions_shop_id_shops_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "risk_policy_revisions_scope_shop_consistent" CHECK (
    ("scope" = 'GLOBAL' and "shop_id" is null and "enabled")
    or ("scope" = 'SHOP' and "shop_id" is not null)
  ),
  CONSTRAINT "risk_policy_revisions_payload_object" CHECK (jsonb_typeof("payload") = 'object')
);--> statement-breakpoint
CREATE INDEX "risk_policy_revisions_global_effective_idx"
  ON "risk_policy_revisions" USING btree ("effective_from", "sequence")
  WHERE "scope" = 'GLOBAL';--> statement-breakpoint
CREATE INDEX "risk_policy_revisions_shop_effective_idx"
  ON "risk_policy_revisions" USING btree ("shop_id", "effective_from", "sequence")
  WHERE "scope" = 'SHOP';--> statement-breakpoint
CREATE FUNCTION "public"."prevent_risk_policy_revisions_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'risk_policy_revisions are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "risk_policy_revisions_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "risk_policy_revisions"
  FOR EACH ROW EXECUTE FUNCTION "public"."prevent_risk_policy_revisions_mutation"();--> statement-breakpoint
ALTER TABLE "decision_cases" ADD COLUMN "resolved_policy_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_resolved_policy_snapshot_object"
  CHECK ("resolved_policy_snapshot" is null or jsonb_typeof("resolved_policy_snapshot") = 'object');
