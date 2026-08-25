CREATE TABLE "finance_capture_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"source_statement_detail_id" text NOT NULL,
	"expected_settlement_amount" numeric(20, 4),
	"settled_amount" numeric(20, 4),
	"currency" text NOT NULL,
	"source_settlement_status" text NOT NULL,
	"settlement_state" "settlement_state" NOT NULL,
	"on_hold_reason" text,
	"source_hash" text NOT NULL,
	"source_schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_capture_items_currency_format" CHECK ("finance_capture_items"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "finance_capture_items_source_id_not_blank" CHECK (length(btrim("finance_capture_items"."source_statement_detail_id")) > 0),
	CONSTRAINT "finance_capture_items_source_status_not_blank" CHECK (length(btrim("finance_capture_items"."source_settlement_status")) > 0),
	CONSTRAINT "finance_capture_items_source_hash_not_blank" CHECK (length(btrim("finance_capture_items"."source_hash")) > 0),
	CONSTRAINT "finance_capture_items_source_schema_version_not_blank" CHECK (length(btrim("finance_capture_items"."source_schema_version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "finance_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"snapshot_hash" text NOT NULL,
	"population_hash" text NOT NULL,
	"currency" text NOT NULL,
	"official_on_hold_amount" numeric(20, 4) NOT NULL,
	"item_count" integer NOT NULL,
	"source_schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_captures_id_shop_unique" UNIQUE("id","shop_id"),
	CONSTRAINT "finance_captures_snapshot_hash_not_blank" CHECK (length(btrim("finance_captures"."snapshot_hash")) > 0),
	CONSTRAINT "finance_captures_population_hash_not_blank" CHECK (length(btrim("finance_captures"."population_hash")) > 0),
	CONSTRAINT "finance_captures_currency_format" CHECK ("finance_captures"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "finance_captures_item_count_nonnegative" CHECK ("finance_captures"."item_count" >= 0),
	CONSTRAINT "finance_captures_source_schema_version_not_blank" CHECK (length(btrim("finance_captures"."source_schema_version")) > 0)
);
--> statement-breakpoint
DROP INDEX "financial_snapshots_shop_hash_unique";--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_id_shop_unique" UNIQUE("id","shop_id");--> statement-breakpoint
ALTER TABLE "finance_capture_items" ADD CONSTRAINT "finance_capture_items_capture_shop_fk" FOREIGN KEY ("capture_id","shop_id") REFERENCES "public"."finance_captures"("id","shop_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "finance_captures" ADD CONSTRAINT "finance_captures_sync_run_shop_fk" FOREIGN KEY ("sync_run_id","shop_id") REFERENCES "public"."sync_runs"("id","shop_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "finance_captures" ADD CONSTRAINT "finance_captures_snapshot_shop_fk" FOREIGN KEY ("snapshot_id","shop_id") REFERENCES "public"."financial_snapshots"("id","shop_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_capture_items_capture_source_unique" ON "finance_capture_items" USING btree ("capture_id","source_statement_detail_id");--> statement-breakpoint
CREATE INDEX "finance_capture_items_shop_capture_idx" ON "finance_capture_items" USING btree ("shop_id","capture_id");--> statement-breakpoint
CREATE INDEX "finance_capture_items_capture_state_reason_idx" ON "finance_capture_items" USING btree ("capture_id","settlement_state","on_hold_reason");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_captures_shop_captured_unique" ON "finance_captures" USING btree ("shop_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_captures_sync_run_unique" ON "finance_captures" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "finance_captures_shop_captured_idx" ON "finance_captures" USING btree ("shop_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_snapshots_shop_capture_hash_unique" ON "financial_snapshots" USING btree ("shop_id","captured_at","snapshot_hash");--> statement-breakpoint
CREATE INDEX "financial_snapshots_shop_hash_idx" ON "financial_snapshots" USING btree ("shop_id","snapshot_hash");--> statement-breakpoint
CREATE FUNCTION reject_finance_capture_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'finance capture evidence is immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "finance_capture_items_immutable"
BEFORE UPDATE OR DELETE ON "finance_capture_items"
FOR EACH ROW EXECUTE FUNCTION reject_finance_capture_evidence_mutation();--> statement-breakpoint
CREATE TRIGGER "finance_captures_immutable"
BEFORE UPDATE OR DELETE ON "finance_captures"
FOR EACH ROW EXECUTE FUNCTION reject_finance_capture_evidence_mutation();