CREATE TABLE "cotik_supplementary_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider_payment_id" text NOT NULL,
	"provider_shop_id" text NOT NULL,
	"payment_status" text NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"settlement_amount" numeric(20, 4) NOT NULL,
	"reserve_amount" numeric(20, 4) NOT NULL,
	"payment_amount_before_exchange" numeric(20, 4) NOT NULL,
	"created_at_provider" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source_hash" text NOT NULL,
	"source_schema_version" text NOT NULL,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_supplementary_payments_provider_payment_not_blank" CHECK (length(btrim("cotik_supplementary_payments"."provider_payment_id")) > 0),
	CONSTRAINT "cotik_supplementary_payments_provider_shop_not_blank" CHECK (length(btrim("cotik_supplementary_payments"."provider_shop_id")) > 0),
	CONSTRAINT "cotik_supplementary_payments_status_not_blank" CHECK (length(btrim("cotik_supplementary_payments"."payment_status")) > 0),
	CONSTRAINT "cotik_supplementary_payments_currency_format" CHECK ("cotik_supplementary_payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "cotik_supplementary_payments_created_at_finite" CHECK ("cotik_supplementary_payments"."created_at_provider" not in ('infinity'::timestamptz, '-infinity'::timestamptz)),
	CONSTRAINT "cotik_supplementary_payments_paid_at_finite" CHECK ("cotik_supplementary_payments"."paid_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)),
	CONSTRAINT "cotik_supplementary_payments_observed_at_finite" CHECK ("cotik_supplementary_payments"."observed_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)),
	CONSTRAINT "cotik_supplementary_payments_source_hash_sha256" CHECK ("cotik_supplementary_payments"."source_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "cotik_supplementary_payments_schema_version_not_blank" CHECK (length(btrim("cotik_supplementary_payments"."source_schema_version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "cotik_supplementary_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider_statement_id" text NOT NULL,
	"provider_payment_id" text,
	"provider_shop_id" text NOT NULL,
	"statement_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"revenue_amount" numeric(20, 4) NOT NULL,
	"fee_amount" numeric(20, 4) NOT NULL,
	"adjustment_amount" numeric(20, 4) NOT NULL,
	"shipping_cost_amount" numeric(20, 4) NOT NULL,
	"net_sales_amount" numeric(20, 4) NOT NULL,
	"settlement_amount" numeric(20, 4) NOT NULL,
	"payment_status" text NOT NULL,
	"order_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source_hash" text NOT NULL,
	"source_schema_version" text NOT NULL,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_supplementary_statements_provider_statement_not_blank" CHECK (length(btrim("cotik_supplementary_statements"."provider_statement_id")) > 0),
	CONSTRAINT "cotik_supplementary_statements_provider_shop_not_blank" CHECK (length(btrim("cotik_supplementary_statements"."provider_shop_id")) > 0),
	CONSTRAINT "cotik_supplementary_statements_payment_status_not_blank" CHECK (length(btrim("cotik_supplementary_statements"."payment_status")) > 0),
	CONSTRAINT "cotik_supplementary_statements_currency_format" CHECK ("cotik_supplementary_statements"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "cotik_supplementary_statements_order_ids_array" CHECK (jsonb_typeof("cotik_supplementary_statements"."order_ids") = 'array'),
	CONSTRAINT "cotik_supplementary_statements_observed_at_finite" CHECK ("cotik_supplementary_statements"."observed_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)),
	CONSTRAINT "cotik_supplementary_statements_statement_at_finite" CHECK ("cotik_supplementary_statements"."statement_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)),
	CONSTRAINT "cotik_supplementary_statements_source_hash_sha256" CHECK ("cotik_supplementary_statements"."source_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "cotik_supplementary_statements_schema_version_not_blank" CHECK (length(btrim("cotik_supplementary_statements"."source_schema_version")) > 0)
);
--> statement-breakpoint
ALTER TABLE "cotik_supplementary_payments" ADD CONSTRAINT "cotik_supplementary_payments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cotik_supplementary_statements" ADD CONSTRAINT "cotik_supplementary_statements_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_supplementary_payments_shop_provider_payment_unique" ON "cotik_supplementary_payments" USING btree ("shop_id","provider_payment_id");--> statement-breakpoint
CREATE INDEX "cotik_supplementary_payments_shop_paid_at_idx" ON "cotik_supplementary_payments" USING btree ("shop_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_supplementary_statements_shop_provider_statement_unique" ON "cotik_supplementary_statements" USING btree ("shop_id","provider_statement_id");--> statement-breakpoint
CREATE INDEX "cotik_supplementary_statements_shop_payment_idx" ON "cotik_supplementary_statements" USING btree ("shop_id","provider_payment_id");--> statement-breakpoint
CREATE INDEX "cotik_supplementary_statements_shop_statement_at_idx" ON "cotik_supplementary_statements" USING btree ("shop_id","statement_at");