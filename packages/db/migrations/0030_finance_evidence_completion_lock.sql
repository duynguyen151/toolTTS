ALTER TABLE "finance_capture_items" DROP CONSTRAINT "finance_capture_items_expected_nonnegative";--> statement-breakpoint
CREATE OR REPLACE FUNCTION authorize_finance_capture_item_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	run_status sync_run_status;
BEGIN
	SELECT sr.status INTO run_status
	FROM finance_captures fc
	JOIN sync_runs sr ON sr.id = fc.sync_run_id AND sr.shop_id = fc.shop_id
	WHERE fc.id = NEW.capture_id AND fc.shop_id = NEW.shop_id
	FOR UPDATE OF sr;
	IF NOT FOUND OR run_status <> 'RUNNING' THEN
		RAISE EXCEPTION 'finance capture items require a running evidence run';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION authorize_finance_run_success() RETURNS trigger
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
	IF NEW.status = 'SUCCEEDED' AND EXISTS (SELECT 1 FROM finance_captures WHERE sync_run_id = OLD.id) THEN
		IF OLD.status <> 'RUNNING' THEN
			RAISE EXCEPTION 'Finance evidence requires a direct RUNNING to SUCCEEDED transition';
		END IF;
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
$$;
