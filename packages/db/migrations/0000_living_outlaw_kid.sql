CREATE TYPE "public"."canonical_order_status" AS ENUM('PENDING', 'AWAITING_SHIPMENT', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."evaluation_status" AS ENUM('FRESH', 'STALE', 'ERROR', 'INSUFFICIENT_DATA');--> statement-breakpoint
CREATE TYPE "public"."shop_recommendation" AS ENUM('SCALE', 'CONTINUE', 'WATCH', 'PAUSE');--> statement-breakpoint
CREATE TYPE "public"."settlement_state" AS ENUM('ON_HOLD', 'ELIGIBLE', 'SETTLED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."shop_sync_state" AS ENUM('ACTIVE', 'PAUSED_LOGIN', 'PAUSED_CHALLENGE', 'PAUSED_LAYOUT', 'PAUSED_MANUAL', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."sync_mode" AS ENUM('ORDERS', 'FINANCE', 'BACKFILL', 'RECONCILE');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'ABORTED', 'PAUSED');--> statement-breakpoint
CREATE TABLE "financial_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"available_balance" numeric(20, 4),
	"frozen_balance" numeric(20, 4),
	"total_balance" numeric(20, 4),
	"to_settle_balance" numeric(20, 4),
	"on_hold_balance" numeric(20, 4),
	"reserve_ratio" numeric(10, 6),
	"reserve_days" integer,
	"reserve_level" text,
	"snapshot_hash" text NOT NULL,
	"source_schema_version" text NOT NULL,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"window" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"policy_version" text NOT NULL,
	"metrics_hash" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"trends" jsonb NOT NULL,
	"score" integer,
	"confidence" numeric(7, 6),
	"recommendation" "shop_recommendation",
	"evaluation_status" "evaluation_status" NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"source_order_id" text NOT NULL,
	"source_status" text NOT NULL,
	"source_sub_status" text,
	"canonical_status" "canonical_order_status" NOT NULL,
	"order_created_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"latest_delivery_at" timestamp with time zone,
	"grand_total" numeric(20, 4) NOT NULL,
	"currency" text NOT NULL,
	"tracking_number" text,
	"carrier" text,
	"refund_amount" numeric(20, 4),
	"refund_status" text,
	"delivery_eligible" boolean,
	"source_hash" text NOT NULL,
	"source_schema_version" text NOT NULL,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"source_statement_detail_id" text NOT NULL,
	"trade_order_id" text,
	"placed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"estimated_settlement_at" timestamp with time zone,
	"earning_amount" numeric(20, 4),
	"fee_amount" numeric(20, 4),
	"shipping_amount" numeric(20, 4),
	"expected_settlement_amount" numeric(20, 4),
	"eligible_settlement_amount" numeric(20, 4),
	"settled_amount" numeric(20, 4),
	"currency" text NOT NULL,
	"source_settlement_status" text NOT NULL,
	"settlement_state" "settlement_state" NOT NULL,
	"on_hold_reason" text,
	"source_hash" text NOT NULL,
	"source_schema_version" text NOT NULL,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"profile_no" text NOT NULL,
	"display_name" text,
	"region" text NOT NULL,
	"locale" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sync_state" "shop_sync_state" DEFAULT 'ACTIVE' NOT NULL,
	"pause_reason" text,
	"sync_requested_at" timestamp with time zone,
	"last_orders_synced_at" timestamp with time zone,
	"last_finance_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"mode" "sync_mode" NOT NULL,
	"status" "sync_run_status" DEFAULT 'RUNNING' NOT NULL,
	"checkpoint" jsonb,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"failure_type" text,
	"failure_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_snapshots_shop_hash_unique" ON "financial_snapshots" USING btree ("shop_id","snapshot_hash");--> statement-breakpoint
CREATE INDEX "financial_snapshots_shop_captured_idx" ON "financial_snapshots" USING btree ("shop_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_snapshots_dedup_unique" ON "kpi_snapshots" USING btree ("shop_id","window","policy_version","metrics_hash");--> statement-breakpoint
CREATE INDEX "kpi_snapshots_shop_calculated_idx" ON "kpi_snapshots" USING btree ("shop_id","calculated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_shop_source_order_unique" ON "orders" USING btree ("shop_id","source_order_id");--> statement-breakpoint
CREATE INDEX "orders_shop_paid_at_idx" ON "orders" USING btree ("shop_id","paid_at");--> statement-breakpoint
CREATE INDEX "orders_shop_status_idx" ON "orders" USING btree ("shop_id","canonical_status");--> statement-breakpoint
CREATE INDEX "orders_shop_source_updated_idx" ON "orders" USING btree ("shop_id","source_updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_shop_source_detail_unique" ON "settlement_records" USING btree ("shop_id","source_statement_detail_id");--> statement-breakpoint
CREATE INDEX "settlements_shop_placed_at_idx" ON "settlement_records" USING btree ("shop_id","placed_at");--> statement-breakpoint
CREATE INDEX "settlements_shop_trade_order_idx" ON "settlement_records" USING btree ("shop_id","trade_order_id");--> statement-breakpoint
CREATE INDEX "settlements_shop_status_idx" ON "settlement_records" USING btree ("shop_id","settlement_state");--> statement-breakpoint
CREATE UNIQUE INDEX "shops_profile_id_unique" ON "shops" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shops_profile_no_unique" ON "shops" USING btree ("profile_no");--> statement-breakpoint
CREATE INDEX "shops_enabled_idx" ON "shops" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "sync_runs_shop_started_idx" ON "sync_runs" USING btree ("shop_id","started_at");--> statement-breakpoint
CREATE INDEX "sync_runs_running_idx" ON "sync_runs" USING btree ("status") WHERE "sync_runs"."status" = 'RUNNING';