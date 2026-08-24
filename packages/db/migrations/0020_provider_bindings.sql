CREATE TABLE "shop_provider_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_shop_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"provenance" jsonb NOT NULL,
	"provider_updated_at" timestamp with time zone,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checkpoint" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_provider_bindings_provider_known" CHECK ("shop_provider_bindings"."provider" in ('SELLER_CENTER', 'COTIK')),
	CONSTRAINT "shop_provider_bindings_provider_shop_id_not_blank" CHECK ("shop_provider_bindings"."provider_shop_id" is null or length(btrim("shop_provider_bindings"."provider_shop_id")) > 0),
	CONSTRAINT "shop_provider_bindings_enabled_requires_identity" CHECK (not "shop_provider_bindings"."enabled" or "shop_provider_bindings"."provider_shop_id" is not null),
	CONSTRAINT "shop_provider_bindings_provenance_object" CHECK (jsonb_typeof("shop_provider_bindings"."provenance") = 'object'
        and "shop_provider_bindings"."provenance" ? 'source'
        and "shop_provider_bindings"."provenance" ? 'capabilities'
        and jsonb_typeof("shop_provider_bindings"."provenance"->'capabilities') = 'array'),
	CONSTRAINT "shop_provider_bindings_cotik_no_official_on_hold" CHECK ("shop_provider_bindings"."provenance"->>'source' <> 'COTIK'
        or not ("shop_provider_bindings"."provenance"->'capabilities' ? 'OFFICIAL_ON_HOLD')),
	CONSTRAINT "shop_provider_bindings_checkpoint_object" CHECK ("shop_provider_bindings"."checkpoint" is null or jsonb_typeof("shop_provider_bindings"."checkpoint") = 'object')
);
--> statement-breakpoint
ALTER TABLE "shop_provider_bindings" ADD CONSTRAINT "shop_provider_bindings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_provider_bindings_shop_provider_unique" ON "shop_provider_bindings" USING btree ("shop_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_provider_bindings_provider_shop_id_unique" ON "shop_provider_bindings" USING btree ("provider","provider_shop_id") WHERE "shop_provider_bindings"."provider_shop_id" is not null;--> statement-breakpoint
CREATE INDEX "shop_provider_bindings_enabled_provider_idx" ON "shop_provider_bindings" USING btree ("provider") WHERE "shop_provider_bindings"."enabled";