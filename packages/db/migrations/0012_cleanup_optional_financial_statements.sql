DROP TABLE IF EXISTS "financial_statement_order_links";--> statement-breakpoint
DROP TABLE IF EXISTS "financial_statements";--> statement-breakpoint
DROP TYPE IF EXISTS "financial_statement_status";--> statement-breakpoint
ALTER TABLE "financial_snapshots" DROP COLUMN IF EXISTS "net_earnings";--> statement-breakpoint
ALTER TABLE "financial_snapshots" DROP COLUMN IF EXISTS "paid_amount";--> statement-breakpoint
ALTER TABLE "financial_snapshots" DROP COLUMN IF EXISTS "processing_amount";
