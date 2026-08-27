ALTER TABLE "kpi_snapshots" ADD COLUMN "profile_id" text;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD COLUMN "profile_no" text;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD COLUMN "provider_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD COLUMN "policy_provenance" jsonb;--> statement-breakpoint
CREATE INDEX "kpi_snapshots_profile_calculated_idx" ON "kpi_snapshots" USING btree ("profile_no","calculated_at");
--> statement-breakpoint
CREATE FUNCTION reject_kpi_snapshot_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'kpi snapshots are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "kpi_snapshots_immutable"
BEFORE UPDATE OR DELETE ON "kpi_snapshots"
FOR EACH ROW EXECUTE FUNCTION reject_kpi_snapshot_mutation();
