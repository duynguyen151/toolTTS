CREATE TABLE "cotik_post_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"request_payload" jsonb NOT NULL,
	"response_payload" jsonb,
	"http_status" integer,
	"outcome" text NOT NULL,
	"readback_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_post_attempts_outcome_check" CHECK ("cotik_post_attempts"."outcome" IN ('SUCCESS', 'HTTP_ERROR', 'TIMEOUT', 'UNCONFIRMED')),
	CONSTRAINT "cotik_post_attempts_attempt_no_bound" CHECK ("cotik_post_attempts"."attempt_no" >= 1 AND "cotik_post_attempts"."attempt_no" <= 3)
);
--> statement-breakpoint
CREATE TABLE "cotik_post_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"order_id" text NOT NULL,
	"tracking" text NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"logical_shop_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_post_intents_status_check" CHECK ("cotik_post_intents"."status" IN ('PENDING', 'IN_PROGRESS', 'CONFIRMED', 'FAILED', 'ABORTED')),
	CONSTRAINT "cotik_post_intents_attempt_bound" CHECK ("cotik_post_intents"."attempt_count" <= "cotik_post_intents"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "cotik_tracking_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"tracking" text NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"logical_shop_id" uuid NOT NULL,
	"region" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotik_tracking_candidates_region_check" CHECK ("cotik_tracking_candidates"."region" IN ('US', 'UK')),
	CONSTRAINT "cotik_tracking_candidates_status_check" CHECK ("cotik_tracking_candidates"."status" IN ('PENDING', 'POSTED', 'REJECTED', 'FAILED')),
	CONSTRAINT "cotik_tracking_candidates_order_id_not_blank" CHECK (length(btrim("cotik_tracking_candidates"."order_id")) > 0),
	CONSTRAINT "cotik_tracking_candidates_tracking_not_blank" CHECK (length(btrim("cotik_tracking_candidates"."tracking")) > 0)
);
--> statement-breakpoint
ALTER TABLE "cotik_post_attempts" ADD CONSTRAINT "cotik_post_attempts_intent_id_cotik_post_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."cotik_post_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_post_intents" ADD CONSTRAINT "cotik_post_intents_account_id_cotik_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."cotik_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_post_intents" ADD CONSTRAINT "cotik_post_intents_logical_shop_id_cotik_logical_shops_id_fk" FOREIGN KEY ("logical_shop_id") REFERENCES "public"."cotik_logical_shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_tracking_candidates" ADD CONSTRAINT "cotik_tracking_candidates_account_id_cotik_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."cotik_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotik_tracking_candidates" ADD CONSTRAINT "cotik_tracking_candidates_logical_shop_id_cotik_logical_shops_id_fk" FOREIGN KEY ("logical_shop_id") REFERENCES "public"."cotik_logical_shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_post_attempts_intent_attempt_idx" ON "cotik_post_attempts" USING btree ("intent_id","attempt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_post_intents_fingerprint_idx" ON "cotik_post_intents" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "cotik_post_intents_order_idx" ON "cotik_post_intents" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "cotik_post_intents_status_idx" ON "cotik_post_intents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "cotik_tracking_candidates_fingerprint_idx" ON "cotik_tracking_candidates" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "cotik_tracking_candidates_order_idx" ON "cotik_tracking_candidates" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "cotik_tracking_candidates_status_idx" ON "cotik_tracking_candidates" USING btree ("status");