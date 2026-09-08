CREATE TABLE "cotik_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_shop_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"sku" text NOT NULL,
	"sku_name" text NOT NULL,
	"ref_link" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"provider_evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_order_items_quantity_positive" CHECK ("cotik_order_items"."quantity" > 0),
	CONSTRAINT "cotik_order_items_sku_not_blank" CHECK (length(btrim("cotik_order_items"."sku")) > 0)
);
--> statement-breakpoint
CREATE TABLE "cotik_order_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"logical_shop_id" uuid NOT NULL,
	"cotik_shop_id" text NOT NULL,
	"order_id" text NOT NULL,
	"order_status" text NOT NULL,
	"order_create_time" timestamp with time zone NOT NULL,
	"order_update_time" timestamp with time zone NOT NULL,
	"tracking" text,
	"carrier" text,
	"shipping_provider" text,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_order_observations_order_id_not_blank" CHECK (length(btrim("cotik_order_observations"."order_id")) > 0),
	CONSTRAINT "cotik_order_observations_status_not_blank" CHECK (length(btrim("cotik_order_observations"."order_status")) > 0)
);
--> statement-breakpoint
CREATE TABLE "cotik_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_shop_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"order_status" text NOT NULL,
	"order_create_time" timestamp with time zone NOT NULL,
	"order_update_time" timestamp with time zone NOT NULL,
	"winner_account_id" uuid NOT NULL,
	"winner_observed_at" timestamp with time zone NOT NULL,
	"tracking" text,
	"carrier" text,
	"shipping_provider" text,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_orders_order_id_not_blank" CHECK (length(btrim("cotik_orders"."order_id")) > 0),
	CONSTRAINT "cotik_orders_status_not_blank" CHECK (length(btrim("cotik_orders"."order_status")) > 0)
);
--> statement-breakpoint
ALTER TABLE "cotik_order_items" ADD CONSTRAINT "cotik_order_items_logical_shop_id_cotik_logical_shops_id_fk" FOREIGN KEY ("logical_shop_id") REFERENCES "public"."cotik_logical_shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_order_observations" ADD CONSTRAINT "cotik_order_observations_account_id_cotik_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."cotik_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_order_observations" ADD CONSTRAINT "cotik_order_observations_logical_shop_id_cotik_logical_shops_id_fk" FOREIGN KEY ("logical_shop_id") REFERENCES "public"."cotik_logical_shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_orders" ADD CONSTRAINT "cotik_orders_logical_shop_id_cotik_logical_shops_id_fk" FOREIGN KEY ("logical_shop_id") REFERENCES "public"."cotik_logical_shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_orders" ADD CONSTRAINT "cotik_orders_winner_account_id_cotik_accounts_id_fk" FOREIGN KEY ("winner_account_id") REFERENCES "public"."cotik_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cotik_order_items_logical_order_idx" ON "cotik_order_items" USING btree ("logical_shop_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_order_observations_acc_shop_order_unique" ON "cotik_order_observations" USING btree ("account_id","logical_shop_id","order_id");--> statement-breakpoint
CREATE INDEX "cotik_order_observations_logical_order_idx" ON "cotik_order_observations" USING btree ("logical_shop_id","order_id");--> statement-breakpoint
CREATE INDEX "cotik_order_observations_observed_at_idx" ON "cotik_order_observations" USING btree ("observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_orders_logical_shop_order_unique" ON "cotik_orders" USING btree ("logical_shop_id","order_id");--> statement-breakpoint
CREATE INDEX "cotik_orders_update_time_idx" ON "cotik_orders" USING btree ("order_update_time");