CREATE FUNCTION "public"."refresh_retry_offsets_valid"("offsets" jsonb) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(offsets) IS DISTINCT FROM 'array' THEN false
    ELSE CASE
      WHEN jsonb_array_length(offsets) NOT BETWEEN 1 AND 10 THEN false
      ELSE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(offsets) AS entry(value)
        WHERE CASE
          WHEN jsonb_typeof(value) IS DISTINCT FROM 'number' THEN true
          WHEN value #>> '{}' !~ '^(0|[1-9][0-9]*)$' THEN true
          WHEN length(value #>> '{}') > 5 THEN true
          ELSE CASE
            WHEN (value #>> '{}')::numeric BETWEEN 0 AND 86400 THEN false
            ELSE true
          END
        END
      )
      AND NOT EXISTS (
        SELECT value
        FROM jsonb_array_elements(offsets) AS entry(value)
        GROUP BY value
        HAVING count(*) > 1
      )
    END
  END;
$$;--> statement-breakpoint
CREATE TABLE "refresh_checkpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "local_time" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "refresh_checkpoints_local_time_valid" CHECK ("refresh_checkpoints"."local_time" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "refresh_checkpoints_created_at_finite" CHECK ("refresh_checkpoints"."created_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)),
  CONSTRAINT "refresh_checkpoints_updated_at_finite" CHECK ("refresh_checkpoints"."updated_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz))
);--> statement-breakpoint
CREATE TABLE "refresh_settings" (
  "singleton_id" integer PRIMARY KEY NOT NULL,
  "auto_refresh_enabled" boolean DEFAULT true NOT NULL,
  "retry_offsets_seconds" jsonb DEFAULT '[0, 30, 120, 300, 600]'::jsonb NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "refresh_settings_singleton" CHECK ("refresh_settings"."singleton_id" = 1),
  CONSTRAINT "refresh_settings_revision_positive" CHECK ("refresh_settings"."revision" > 0),
  CONSTRAINT "refresh_settings_retry_offsets_valid" CHECK (public.refresh_retry_offsets_valid("refresh_settings"."retry_offsets_seconds")),
  CONSTRAINT "refresh_settings_created_at_finite" CHECK ("refresh_settings"."created_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz)),
  CONSTRAINT "refresh_settings_updated_at_finite" CHECK ("refresh_settings"."updated_at" not in ('infinity'::timestamptz, '-infinity'::timestamptz))
);--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_checkpoints_local_time_unique" ON "refresh_checkpoints" USING btree ("local_time");--> statement-breakpoint
INSERT INTO "refresh_settings" ("singleton_id") VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "refresh_checkpoints" ("local_time") VALUES ('08:00'), ('11:00'), ('17:00') ON CONFLICT DO NOTHING;
