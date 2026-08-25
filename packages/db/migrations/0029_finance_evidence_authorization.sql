ALTER TABLE "finance_capture_items" DROP CONSTRAINT "finance_capture_items_source_hash_not_blank";--> statement-breakpoint
ALTER TABLE "finance_captures" DROP CONSTRAINT "finance_captures_snapshot_hash_not_blank";--> statement-breakpoint
ALTER TABLE "finance_captures" DROP CONSTRAINT "finance_captures_population_hash_not_blank";--> statement-breakpoint
DROP INDEX IF EXISTS "finance_captures_shop_captured_idx";--> statement-breakpoint
ALTER TABLE "finance_capture_items" ADD COLUMN "source_statement_id" text;--> statement-breakpoint
ALTER TABLE "finance_capture_items" ADD COLUMN "source_statement_version" text;--> statement-breakpoint
ALTER TABLE "finance_capture_items" ADD CONSTRAINT "finance_capture_items_statement_identity_complete" CHECK ("finance_capture_items"."source_statement_id" is not null and length(btrim("finance_capture_items"."source_statement_id")) > 0 and "finance_capture_items"."source_statement_version" is not null and length(btrim("finance_capture_items"."source_statement_version")) > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "finance_capture_items" ADD CONSTRAINT "finance_capture_items_expected_nonnegative" CHECK ("finance_capture_items"."expected_settlement_amount" is null or "finance_capture_items"."expected_settlement_amount" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "finance_capture_items" ADD CONSTRAINT "finance_capture_items_settled_nonnegative" CHECK ("finance_capture_items"."settled_amount" is null or "finance_capture_items"."settled_amount" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "finance_capture_items" ADD CONSTRAINT "finance_capture_items_source_hash_sha256" CHECK ("finance_capture_items"."source_hash" ~ '^[0-9a-f]{64}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "finance_captures" ADD CONSTRAINT "finance_captures_snapshot_hash_sha256" CHECK ("finance_captures"."snapshot_hash" ~ '^[0-9a-f]{64}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "finance_captures" ADD CONSTRAINT "finance_captures_population_hash_sha256" CHECK ("finance_captures"."population_hash" ~ '^[0-9a-f]{64}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "finance_captures" ADD CONSTRAINT "finance_captures_official_on_hold_nonnegative" CHECK ("finance_captures"."official_on_hold_amount" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "finance_captures" ADD CONSTRAINT "finance_captures_captured_at_finite" CHECK ("finance_captures"."captured_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)) NOT VALID;--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_official_on_hold_nonnegative" CHECK ("financial_snapshots"."official_on_hold_amount" is null or "financial_snapshots"."official_on_hold_amount" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_captured_at_finite" CHECK ("financial_snapshots"."captured_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)) NOT VALID;--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_snapshot_hash_sha256" CHECK ("financial_snapshots"."snapshot_hash" ~ '^[0-9a-f]{64}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_source_schema_version_not_blank" CHECK (length(btrim("financial_snapshots"."source_schema_version")) > 0) NOT VALID;--> statement-breakpoint
CREATE FUNCTION reject_financial_snapshot_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'financial snapshots are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "financial_snapshots_immutable"
BEFORE UPDATE OR DELETE ON "financial_snapshots"
FOR EACH ROW EXECUTE FUNCTION reject_financial_snapshot_mutation();--> statement-breakpoint
CREATE FUNCTION authorize_finance_capture() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	run_row sync_runs%ROWTYPE;
	snapshot_row financial_snapshots%ROWTYPE;
BEGIN
	SELECT * INTO run_row FROM sync_runs WHERE id = NEW.sync_run_id FOR UPDATE;
	IF NOT FOUND OR run_row.shop_id <> NEW.shop_id OR run_row.mode <> 'FINANCE' OR run_row.status <> 'RUNNING' THEN
		RAISE EXCEPTION 'finance capture requires a same-shop running FINANCE run';
	END IF;
	IF EXISTS (SELECT 1 FROM finance_captures WHERE sync_run_id = NEW.sync_run_id) THEN
		RAISE EXCEPTION 'Finance run already has capture evidence';
	END IF;
	PERFORM pg_advisory_xact_lock(hashtext(NEW.shop_id::text), hashtext(NEW.captured_at::text));
	IF EXISTS (SELECT 1 FROM finance_captures WHERE shop_id = NEW.shop_id AND captured_at = NEW.captured_at) THEN
		RAISE EXCEPTION 'Finance capture instant already has authoritative evidence';
	END IF;
	SELECT * INTO snapshot_row FROM financial_snapshots WHERE id = NEW.snapshot_id;
	IF NOT FOUND OR snapshot_row.shop_id <> NEW.shop_id OR snapshot_row.captured_at <> NEW.captured_at OR snapshot_row.currency <> NEW.currency OR snapshot_row.snapshot_hash <> NEW.snapshot_hash OR snapshot_row.official_on_hold_amount IS DISTINCT FROM NEW.official_on_hold_amount OR snapshot_row.source_schema_version <> NEW.source_schema_version THEN
		RAISE EXCEPTION 'finance capture requires its exact same-shop snapshot';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "finance_captures_authorized"
BEFORE INSERT ON "finance_captures"
FOR EACH ROW EXECUTE FUNCTION authorize_finance_capture();--> statement-breakpoint
CREATE FUNCTION authorize_finance_capture_item_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	run_status sync_run_status;
BEGIN
	SELECT sr.status INTO run_status
	FROM finance_captures fc
	JOIN sync_runs sr ON sr.id = fc.sync_run_id AND sr.shop_id = fc.shop_id
	WHERE fc.id = NEW.capture_id AND fc.shop_id = NEW.shop_id;
	IF NOT FOUND OR run_status <> 'RUNNING' THEN
		RAISE EXCEPTION 'finance capture items require a running evidence run';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "finance_capture_items_insert_authorized"
BEFORE INSERT ON "finance_capture_items"
FOR EACH ROW EXECUTE FUNCTION authorize_finance_capture_item_insert();--> statement-breakpoint
CREATE FUNCTION authorize_finance_run_success() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	capture_row finance_captures%ROWTYPE;
	stored_count integer;
	stored_currency_count integer;
	missing_on_hold integer;
	stored_on_hold numeric;
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.status = 'SUCCEEDED' AND EXISTS (SELECT 1 FROM finance_captures WHERE sync_run_id = OLD.id) THEN
			RAISE EXCEPTION 'successful Finance evidence provenance is immutable';
		END IF;
		RETURN OLD;
	END IF;
	IF OLD.status = 'RUNNING' AND NEW.status = 'SUCCEEDED' AND EXISTS (SELECT 1 FROM finance_captures WHERE sync_run_id = OLD.id) THEN
		SELECT * INTO STRICT capture_row FROM finance_captures WHERE sync_run_id = OLD.id;
		SELECT count(*)::int,
			count(*) FILTER (WHERE currency <> capture_row.currency)::int,
			count(*) FILTER (WHERE settlement_state = 'ON_HOLD' AND expected_settlement_amount IS NULL)::int,
			coalesce(sum(expected_settlement_amount) FILTER (WHERE settlement_state = 'ON_HOLD'), 0)
		INTO stored_count, stored_currency_count, missing_on_hold, stored_on_hold
		FROM finance_capture_items WHERE capture_id = capture_row.id AND shop_id = capture_row.shop_id;
		IF OLD.mode <> 'FINANCE' OR NEW.mode <> 'FINANCE' OR NEW.shop_id <> capture_row.shop_id OR NEW.source_complete IS DISTINCT FROM true OR NEW.source_captured_at IS DISTINCT FROM capture_row.captured_at OR capture_row.item_count <> stored_count OR stored_currency_count <> 0 OR missing_on_hold <> 0 OR stored_on_hold <> capture_row.official_on_hold_amount THEN
			RAISE EXCEPTION 'successful Finance run does not match stored capture evidence';
		END IF;
		RETURN NEW;
	END IF;
	IF OLD.status = 'SUCCEEDED' AND EXISTS (SELECT 1 FROM finance_captures WHERE sync_run_id = OLD.id) THEN
		RAISE EXCEPTION 'successful Finance evidence provenance is immutable';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "sync_runs_finance_evidence_authorized"
BEFORE UPDATE OR DELETE ON "sync_runs"
FOR EACH ROW EXECUTE FUNCTION authorize_finance_run_success();
