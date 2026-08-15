CREATE TYPE "public"."shop_eligibility_status" AS ENUM('ELIGIBLE', 'INELIGIBLE', 'UNSUPPORTED_REGION');--> statement-breakpoint
CREATE TYPE "public"."shop_verification_status" AS ENUM('NOT_VERIFIED', 'VERIFIED', 'FAILED');--> statement-breakpoint
ALTER TABLE "ba_decisions" DROP CONSTRAINT "ba_decisions_case_unique";--> statement-breakpoint
ALTER TABLE "decision_executions" DROP CONSTRAINT "decision_executions_case_unique";--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD COLUMN "reason_code" text DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD COLUMN "actor" text DEFAULT 'LEGACY_UNATTRIBUTED' NOT NULL;--> statement-breakpoint
UPDATE "ba_decisions" SET "reason_code" = COALESCE("reason_codes"->>0, 'OTHER'), "notes" = "note";--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "tiktok_shop_id" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "verification_status" "shop_verification_status" DEFAULT 'NOT_VERIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "eligibility_status" "shop_eligibility_status" DEFAULT 'ELIGIBLE' NOT NULL;--> statement-breakpoint
UPDATE "shops" SET "eligibility_status" = 'UNSUPPORTED_REGION' WHERE "region" <> 'US' OR "locale" <> 'en-US';--> statement-breakpoint
CREATE UNIQUE INDEX "shops_tiktok_shop_id_unique" ON "shops" USING btree ("tiktok_shop_id");--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_notes_not_blank" CHECK ("ba_decisions"."notes" is null or length(btrim("ba_decisions"."notes")) > 0);--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_actor_not_blank" CHECK (length(btrim("ba_decisions"."actor")) > 0);--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_other_requires_notes" CHECK ("ba_decisions"."reason_code" <> 'OTHER' or coalesce("ba_decisions"."notes", "ba_decisions"."note") is not null or "ba_decisions"."actor" = 'LEGACY_UNATTRIBUTED');--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_tiktok_shop_id_not_blank" CHECK ("shops"."tiktok_shop_id" is null or length(btrim("shops"."tiktok_shop_id")) > 0);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_region_eligibility_consistent" CHECK (("shops"."region" = 'US' and "shops"."locale" = 'en-US') or "shops"."eligibility_status" = 'UNSUPPORTED_REGION');
--> statement-breakpoint
CREATE FUNCTION "public"."prevent_ba_decisions_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ba_decisions is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ba_decisions_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "ba_decisions"
  FOR EACH ROW EXECUTE FUNCTION "public"."prevent_ba_decisions_mutation"();
--> statement-breakpoint
CREATE TYPE "public"."adspower_profile_verification_state" AS ENUM('UNVERIFIED', 'LOGIN_REQUIRED', 'HUMAN_ACTION_REQUIRED', 'NOT_TIKTOK_SELLER', 'UNSUPPORTED_REGION', 'SHOP_SELECTION_REQUIRED', 'SHOP_IDENTITY_CHANGED', 'READY');--> statement-breakpoint
CREATE TABLE "adspower_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" text NOT NULL,
  "profile_no" text NOT NULL,
  "verification_state" "adspower_profile_verification_state" DEFAULT 'UNVERIFIED' NOT NULL,
  "eligibility_status" "shop_eligibility_status" DEFAULT 'INELIGIBLE' NOT NULL,
  "last_verified_at" timestamp with time zone,
  "verified_tiktok_shop_id" text,
  "verified_shop_display_name" text,
  "active_shop_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "adspower_profiles_active_shop_id_shops_id_fk"
    FOREIGN KEY ("active_shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "adspower_profiles_profile_id_not_blank" CHECK (length(btrim("profile_id")) > 0),
  CONSTRAINT "adspower_profiles_profile_no_not_blank" CHECK (length(btrim("profile_no")) > 0),
  CONSTRAINT "adspower_profiles_verified_tiktok_shop_id_not_blank" CHECK ("verified_tiktok_shop_id" is null or length(btrim("verified_tiktok_shop_id")) > 0),
  CONSTRAINT "adspower_profiles_active_shop_requires_proven_identity" CHECK (
    "active_shop_id" is null or (
      "verification_state" = 'READY'
      and "eligibility_status" = 'ELIGIBLE'
      and "verified_tiktok_shop_id" is not null
    )
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "adspower_profiles_profile_id_unique" ON "adspower_profiles" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "adspower_profiles_profile_no_unique" ON "adspower_profiles" USING btree ("profile_no");--> statement-breakpoint
CREATE UNIQUE INDEX "adspower_profiles_active_shop_id_unique" ON "adspower_profiles" USING btree ("active_shop_id");--> statement-breakpoint
INSERT INTO "adspower_profiles" (
  "profile_id", "profile_no", "verification_state", "eligibility_status",
  "last_verified_at", "verified_tiktok_shop_id", "verified_shop_display_name", "active_shop_id",
  "created_at", "updated_at"
)
SELECT
  "profile_id",
  "profile_no",
  CASE
    WHEN "verification_status" = 'VERIFIED'
      AND "eligibility_status" = 'ELIGIBLE'
      AND "tiktok_shop_id" IS NOT NULL THEN 'READY'::"adspower_profile_verification_state"
    ELSE 'UNVERIFIED'::"adspower_profile_verification_state"
  END,
  "eligibility_status",
  CASE WHEN "verification_status" = 'VERIFIED' THEN "updated_at" ELSE NULL END,
  CASE WHEN "verification_status" = 'VERIFIED' THEN "tiktok_shop_id" ELSE NULL END,
  CASE WHEN "verification_status" = 'VERIFIED' THEN "display_name" ELSE NULL END,
  CASE
    WHEN "verification_status" = 'VERIFIED'
      AND "eligibility_status" = 'ELIGIBLE'
      AND "tiktok_shop_id" IS NOT NULL THEN "id"
    ELSE NULL
  END,
  "created_at",
  "updated_at"
FROM "shops";
