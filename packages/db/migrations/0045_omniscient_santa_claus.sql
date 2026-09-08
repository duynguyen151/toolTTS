ALTER TABLE "cotik_accounts" DROP CONSTRAINT "cotik_accounts_status_valid";--> statement-breakpoint
ALTER TABLE "cotik_post_attempts" DROP CONSTRAINT "cotik_post_attempts_intent_id_cotik_post_intents_id_fk";
--> statement-breakpoint
ALTER TABLE "cotik_post_intents" DROP CONSTRAINT "cotik_post_intents_account_id_cotik_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "cotik_post_intents" DROP CONSTRAINT "cotik_post_intents_logical_shop_id_cotik_logical_shops_id_fk";
--> statement-breakpoint
ALTER TABLE "cotik_post_intents" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "cotik_workflow_settings" ADD COLUMN "singleton_key" text DEFAULT 'SINGLETON' NOT NULL;--> statement-breakpoint
ALTER TABLE "cotik_post_attempts" ADD CONSTRAINT "cotik_post_attempts_intent_id_cotik_post_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."cotik_post_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_post_intents" ADD CONSTRAINT "cotik_post_intents_account_id_cotik_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."cotik_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_post_intents" ADD CONSTRAINT "cotik_post_intents_logical_shop_id_cotik_logical_shops_id_fk" FOREIGN KEY ("logical_shop_id") REFERENCES "public"."cotik_logical_shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "cotik_post_intents" intents
    LEFT JOIN "cotik_logical_shops" shops ON shops."id" = intents."logical_shop_id"
    WHERE shops."id" IS NULL OR shops."region" NOT IN ('US', 'UK')
  ) THEN
    RAISE EXCEPTION 'Cannot safely backfill cotik_post_intents.region from logical shops';
  END IF;
END $$;--> statement-breakpoint
UPDATE "cotik_post_intents" intents
SET "region" = shops."region"
FROM "cotik_logical_shops" shops
WHERE shops."id" = intents."logical_shop_id";--> statement-breakpoint
ALTER TABLE "cotik_post_intents" ALTER COLUMN "region" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cotik_accounts" ADD CONSTRAINT "cotik_accounts_status_valid" CHECK ("cotik_accounts"."status" in ('ACTIVE', 'TOKEN_EXPIRED', 'BLOCKED', 'SUBSCRIPTION_EXPIRED', 'DISABLED', 'SHOP_DISCONNECTED', 'RATE_LIMITED', 'NETWORK_ERROR', 'UNKNOWN'));
