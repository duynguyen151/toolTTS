CREATE TABLE "ai_task_configs" (
	"revision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "ai_task_configs_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"task_id" text NOT NULL,
	"provider" text NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ref" text NOT NULL,
	"enabled" boolean NOT NULL,
	"status" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_task_configs_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "ai_task_configs_task_id_not_blank" CHECK (length(btrim("ai_task_configs"."task_id")) > 0),
	CONSTRAINT "ai_task_configs_task_id_valid" CHECK ("task_id" IN ('SHOP_HEALTH_REVIEWER', 'FINANCE_SPECIALIST', 'ORDER_ANOMALY_REVIEWER', 'BA_ASSISTANT')),
	CONSTRAINT "ai_task_configs_provider_not_blank" CHECK (length(btrim("ai_task_configs"."provider")) > 0),
	CONSTRAINT "ai_task_configs_provider_valid" CHECK ("provider" IN ('9router', 'openai-compatible', 'huggingface-hosted')),
	CONSTRAINT "ai_task_configs_model_not_blank" CHECK (length(btrim("ai_task_configs"."model")) > 0),
	CONSTRAINT "ai_task_configs_model_valid" CHECK (("provider" <> '9router' or "model" IN ('oc/deepseek-v4-flash-free', 'oc/big-pickle', 'oc/hy3-free', 'oc/laguna-s-2.1-free', 'oc/nemotron-3-ultra-free', 'oc/nemotron-3.5-lightning-free'))),
	CONSTRAINT "ai_task_configs_base_url_valid" CHECK ("base_url" ~ '^https?://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?(/[^?#[:space:]]*)?$'),
	CONSTRAINT "ai_task_configs_secret_ref_not_blank" CHECK (length(btrim("ai_task_configs"."secret_ref")) > 0),
	CONSTRAINT "ai_task_configs_secret_ref_valid" CHECK ("secret_ref" ~ '^[A-Z][A-Z0-9_]{0,127}$'),
	CONSTRAINT "ai_task_configs_status_enabled_consistent" CHECK (("enabled" and "status" = 'ENABLED' and "task_id" = 'SHOP_HEALTH_REVIEWER') or (not "enabled" and "status" = 'DISABLED')),
	CONSTRAINT "ai_task_configs_parameters_valid" CHECK (jsonb_typeof("parameters") = 'object' and ("parameters" - array['timeoutMs']) = '{}'::jsonb and case when "parameters" ? 'timeoutMs' then jsonb_typeof("parameters"->'timeoutMs') = 'number' and ("parameters"->>'timeoutMs')::numeric between 1 and 300000 and mod(("parameters"->>'timeoutMs')::numeric, 1) = 0 else true end),
	CONSTRAINT "ai_task_configs_effective_from_finite" CHECK ("ai_task_configs"."effective_from" not in ('infinity'::timestamptz, '-infinity'::timestamptz)),
	CONSTRAINT "ai_task_configs_created_at_finite" CHECK ("created_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz))
);
--> statement-breakpoint
CREATE INDEX "ai_task_configs_current_effective_idx" ON "ai_task_configs" USING btree ("task_id","effective_from","sequence");--> statement-breakpoint
CREATE FUNCTION "public"."prevent_ai_task_configs_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ai_task_configs are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_task_configs_append_only_trigger"
BEFORE UPDATE OR DELETE ON "ai_task_configs"
FOR EACH ROW EXECUTE FUNCTION "public"."prevent_ai_task_configs_mutation"();
