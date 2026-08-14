ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_available_nonnegative" CHECK ("financial_snapshots"."available_balance" is null or "financial_snapshots"."available_balance" >= 0);--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_frozen_nonnegative" CHECK ("financial_snapshots"."frozen_balance" is null or "financial_snapshots"."frozen_balance" >= 0);--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_total_nonnegative" CHECK ("financial_snapshots"."total_balance" is null or "financial_snapshots"."total_balance" >= 0);--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_to_settle_nonnegative" CHECK ("financial_snapshots"."to_settle_balance" is null or "financial_snapshots"."to_settle_balance" >= 0);--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_on_hold_nonnegative" CHECK ("financial_snapshots"."on_hold_balance" is null or "financial_snapshots"."on_hold_balance" >= 0);--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_reserve_ratio_range" CHECK ("financial_snapshots"."reserve_ratio" is null or ("financial_snapshots"."reserve_ratio" >= 0 and "financial_snapshots"."reserve_ratio" <= 1));--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_reserve_days_nonnegative" CHECK ("financial_snapshots"."reserve_days" is null or "financial_snapshots"."reserve_days" >= 0);--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_currency_format" CHECK ("financial_snapshots"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_period_valid" CHECK ("kpi_snapshots"."period_start" < "kpi_snapshots"."period_end");--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_score_range" CHECK ("kpi_snapshots"."score" is null or ("kpi_snapshots"."score" >= 0 and "kpi_snapshots"."score" <= 100));--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_confidence_range" CHECK ("kpi_snapshots"."confidence" is null or ("kpi_snapshots"."confidence" >= 0 and "kpi_snapshots"."confidence" <= 1));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_grand_total_nonnegative" CHECK ("orders"."grand_total" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_refund_amount_nonnegative" CHECK ("orders"."refund_amount" is null or "orders"."refund_amount" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_currency_format" CHECK ("orders"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlements_earning_nonnegative" CHECK ("settlement_records"."earning_amount" is null or "settlement_records"."earning_amount" >= 0);--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlements_fee_nonnegative" CHECK ("settlement_records"."fee_amount" is null or "settlement_records"."fee_amount" >= 0);--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlements_shipping_nonnegative" CHECK ("settlement_records"."shipping_amount" is null or "settlement_records"."shipping_amount" >= 0);--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlements_expected_nonnegative" CHECK ("settlement_records"."expected_settlement_amount" is null or "settlement_records"."expected_settlement_amount" >= 0);--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlements_eligible_nonnegative" CHECK ("settlement_records"."eligible_settlement_amount" is null or "settlement_records"."eligible_settlement_amount" >= 0);--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlements_settled_nonnegative" CHECK ("settlement_records"."settled_amount" is null or "settlement_records"."settled_amount" >= 0);--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlements_currency_format" CHECK ("settlement_records"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_profile_id_not_blank" CHECK (length(btrim("shops"."profile_id")) > 0);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_profile_no_not_blank" CHECK (length(btrim("shops"."profile_no")) > 0);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_currency_format" CHECK ("shops"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_rows_read_nonnegative" CHECK ("sync_runs"."rows_read" >= 0);--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_rows_written_nonnegative" CHECK ("sync_runs"."rows_written" >= 0);--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_retry_count_nonnegative" CHECK ("sync_runs"."retry_count" >= 0);