-- W21 persistence corrective migration.
-- This is forward-only because the applied state of the dirty 0045 artifacts is uncertain.
-- Reconcile the account status constraint without relying on an unjournaled 0045 file.
ALTER TABLE "cotik_accounts" DROP CONSTRAINT IF EXISTS "cotik_accounts_status_valid";
ALTER TABLE "cotik_accounts" ADD CONSTRAINT "cotik_accounts_status_valid"
  CHECK (status IN (
    'ACTIVE',
    'TOKEN_EXPIRED',
    'BLOCKED',
    'SUBSCRIPTION_EXPIRED',
    'DISABLED',
    'SHOP_DISCONNECTED',
    'RATE_LIMITED',
    'NETWORK_ERROR',
    'UNKNOWN'
  ));

-- Region is derived from the logical shop. Unknown legacy mappings abort the migration.
ALTER TABLE "cotik_post_intents"
  ADD COLUMN IF NOT EXISTS "region" text;
ALTER TABLE "cotik_post_intents" ALTER COLUMN "region" DROP DEFAULT;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "cotik_post_intents" intents
    LEFT JOIN "cotik_logical_shops" shops ON shops."id" = intents."logical_shop_id"
    WHERE shops."id" IS NULL
      OR shops."region" NOT IN ('US', 'UK')
      OR intents."region" IS NOT NULL AND intents."region" NOT IN ('US', 'UK')
      OR intents."status" IN ('PENDING', 'IN_PROGRESS')
        AND intents."region" IS NOT NULL
        AND intents."region" <> shops."region"
  ) THEN
    RAISE EXCEPTION 'Cannot safely reconcile legacy cotik_post_intents.region';
  END IF;
END $$;
UPDATE "cotik_post_intents" intents
SET "region" = shops."region"
FROM "cotik_logical_shops" shops
WHERE shops."id" = intents."logical_shop_id"
  AND intents."region" IS NULL;
ALTER TABLE "cotik_post_intents" ALTER COLUMN "region" SET NOT NULL;
ALTER TABLE "cotik_post_intents" DROP CONSTRAINT IF EXISTS "cotik_post_intents_region_check";
ALTER TABLE "cotik_post_intents" ADD CONSTRAINT "cotik_post_intents_region_check"
  CHECK ("region" IN ('US', 'UK'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "cotik_post_intents"
    WHERE "attempt_count" < 0
      OR "max_attempts" < 1
      OR "max_attempts" > 3
      OR "attempt_count" > "max_attempts"
  ) THEN
    RAISE EXCEPTION 'Cannot safely enforce Cotik post intent attempt budget';
  END IF;
END $$;
ALTER TABLE "cotik_post_intents" DROP CONSTRAINT IF EXISTS "cotik_post_intents_attempt_bound";
ALTER TABLE "cotik_post_intents" ADD CONSTRAINT "cotik_post_intents_attempt_bound"
  CHECK (
    "attempt_count" >= 0
    AND "attempt_count" <= "max_attempts"
    AND "max_attempts" >= 1
    AND "max_attempts" <= 3
  );

-- Normalize every pre-existing settings row before deduplicating the singleton.
ALTER TABLE "cotik_workflow_settings"
  ADD COLUMN IF NOT EXISTS "singleton_key" text DEFAULT 'SINGLETON';
UPDATE "cotik_workflow_settings"
SET
  "singleton_key" = 'SINGLETON',
  "cotik_sync_enabled" = false,
  "cotik_post_enabled" = false,
  "updated_at" = now();

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "singleton_key"
      ORDER BY "updated_at" DESC, "id" ASC
    ) AS row_number
  FROM "cotik_workflow_settings"
)
DELETE FROM "cotik_workflow_settings" settings
USING ranked
WHERE settings."id" = ranked."id"
  AND ranked.row_number > 1;

ALTER TABLE "cotik_workflow_settings"
  ALTER COLUMN "singleton_key" SET DEFAULT 'SINGLETON',
  ALTER COLUMN "singleton_key" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "cotik_workflow_settings_singleton_key_unique"
  ON "cotik_workflow_settings" USING btree ("singleton_key");
