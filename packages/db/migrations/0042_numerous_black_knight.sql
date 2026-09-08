CREATE TABLE "cotik_account_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"key_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"encrypted_token" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_account_secrets_key_id_not_blank" CHECK (length(btrim("cotik_account_secrets"."key_id")) > 0),
	CONSTRAINT "cotik_account_secrets_version_positive" CHECK ("cotik_account_secrets"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "cotik_account_shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"logical_shop_id" uuid NOT NULL,
	"cotik_shop_id" text NOT NULL,
	"discovery_state" text DEFAULT 'DISCOVERED' NOT NULL,
	"last_discovered_at" timestamp with time zone,
	"checkpoint" jsonb,
	"missing_day_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_account_shops_cotik_shop_id_not_blank" CHECK (length(btrim("cotik_account_shops"."cotik_shop_id")) > 0),
	CONSTRAINT "cotik_account_shops_discovery_state_valid" CHECK ("cotik_account_shops"."discovery_state" in ('DISCOVERED', 'DISCONNECTED', 'ERROR')),
	CONSTRAINT "cotik_account_shops_missing_day_count_non_negative" CHECK ("cotik_account_shops"."missing_day_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cotik_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_accounts_display_name_not_blank" CHECK (length(btrim("cotik_accounts"."display_name")) > 0),
	CONSTRAINT "cotik_accounts_status_valid" CHECK ("cotik_accounts"."status" in ('ACTIVE', 'TOKEN_EXPIRED', 'BLOCKED', 'SUBSCRIPTION_EXPIRED', 'DISABLED'))
);
--> statement-breakpoint
CREATE TABLE "cotik_logical_shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ma_shop_noi_bo" text NOT NULL,
	"region" text NOT NULL,
	"canonical_shop_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_logical_shops_ma_shop_noi_bo_not_blank" CHECK (length(btrim("cotik_logical_shops"."ma_shop_noi_bo")) > 0),
	CONSTRAINT "cotik_logical_shops_region_valid" CHECK ("cotik_logical_shops"."region" in ('US', 'UK'))
);
--> statement-breakpoint
CREATE TABLE "cotik_provider_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"carrier_name" text NOT NULL,
	"region" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_provider_catalog_provider_id_not_blank" CHECK (length(btrim("cotik_provider_catalog"."provider_id")) > 0),
	CONSTRAINT "cotik_provider_catalog_carrier_name_not_blank" CHECK (length(btrim("cotik_provider_catalog"."carrier_name")) > 0),
	CONSTRAINT "cotik_provider_catalog_region_valid" CHECK ("cotik_provider_catalog"."region" in ('US', 'UK'))
);
--> statement-breakpoint
CREATE TABLE "cotik_provider_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region" text NOT NULL,
	"prefix" text NOT NULL,
	"tracking_length" integer,
	"charset_pattern" text,
	"provider_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_provider_rules_region_valid" CHECK ("cotik_provider_rules"."region" in ('US', 'UK')),
	CONSTRAINT "cotik_provider_rules_prefix_not_blank" CHECK (length(btrim("cotik_provider_rules"."prefix")) > 0),
	CONSTRAINT "cotik_provider_rules_tracking_length_valid" CHECK ("cotik_provider_rules"."tracking_length" is null or "cotik_provider_rules"."tracking_length" > 0),
	CONSTRAINT "cotik_provider_rules_version_positive" CHECK ("cotik_provider_rules"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "cotik_workflow_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cotik_sync_enabled" boolean DEFAULT false NOT NULL,
	"cotik_post_enabled" boolean DEFAULT false NOT NULL,
	"deployment_id" text,
	"last_reset_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_provider_catalog_provider_id_unique" ON "cotik_provider_catalog" USING btree ("provider_id");--> statement-breakpoint
ALTER TABLE "cotik_account_secrets" ADD CONSTRAINT "cotik_account_secrets_account_id_cotik_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."cotik_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_account_shops" ADD CONSTRAINT "cotik_account_shops_account_id_cotik_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."cotik_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_account_shops" ADD CONSTRAINT "cotik_account_shops_logical_shop_id_cotik_logical_shops_id_fk" FOREIGN KEY ("logical_shop_id") REFERENCES "public"."cotik_logical_shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_logical_shops" ADD CONSTRAINT "cotik_logical_shops_canonical_shop_id_shops_id_fk" FOREIGN KEY ("canonical_shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_provider_rules" ADD CONSTRAINT "cotik_provider_rules_provider_id_cotik_provider_catalog_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."cotik_provider_catalog"("provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_account_secrets_account_id_unique" ON "cotik_account_secrets" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_account_shops_account_cotik_unique" ON "cotik_account_shops" USING btree ("account_id","cotik_shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_account_shops_account_logical_unique" ON "cotik_account_shops" USING btree ("account_id","logical_shop_id");--> statement-breakpoint
CREATE INDEX "cotik_account_shops_discovery_state_idx" ON "cotik_account_shops" USING btree ("discovery_state");--> statement-breakpoint
CREATE INDEX "cotik_accounts_status_idx" ON "cotik_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cotik_accounts_priority_idx" ON "cotik_accounts" USING btree ("priority");--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_logical_shops_ma_shop_noi_bo_unique" ON "cotik_logical_shops" USING btree ("ma_shop_noi_bo");--> statement-breakpoint
CREATE INDEX "cotik_logical_shops_region_idx" ON "cotik_logical_shops" USING btree ("region");--> statement-breakpoint
CREATE INDEX "cotik_provider_catalog_region_idx" ON "cotik_provider_catalog" USING btree ("region");--> statement-breakpoint
CREATE INDEX "cotik_provider_rules_region_prefix_idx" ON "cotik_provider_rules" USING btree ("region","prefix");
