ALTER TABLE "financial_snapshots" ADD COLUMN IF NOT EXISTS "official_on_hold_amount" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD COLUMN IF NOT EXISTS "settlement_period_days" integer;--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD COLUMN IF NOT EXISTS "settlement_period_type" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ready_to_ship_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'financial_snapshots_period_days_nonnegative'
      AND conrelid = 'financial_snapshots'::regclass
  ) THEN
    ALTER TABLE "financial_snapshots"
      ADD CONSTRAINT "financial_snapshots_period_days_nonnegative"
      CHECK ("settlement_period_days" is null or "settlement_period_days" >= 0);
  END IF;
END
$$;
