ALTER TYPE "public"."ba_decision" ADD VALUE 'SLOW_SELL';--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD COLUMN "planned_methods" jsonb;--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_planned_methods_valid" CHECK (case
        when "ba_decisions"."decision"::text = 'SLOW_SELL' then
          "ba_decisions"."planned_methods" is not null
          and jsonb_typeof("ba_decisions"."planned_methods") = 'array'
          and jsonb_array_length("ba_decisions"."planned_methods") > 0
          and "ba_decisions"."planned_methods" <@ '["DISABLE_FLASH_SALE", "INCREASE_PRICE", "OTHER"]'::jsonb
          and jsonb_array_length("ba_decisions"."planned_methods") =
            case when "ba_decisions"."planned_methods" ? 'DISABLE_FLASH_SALE' then 1 else 0 end
            + case when "ba_decisions"."planned_methods" ? 'INCREASE_PRICE' then 1 else 0 end
            + case when "ba_decisions"."planned_methods" ? 'OTHER' then 1 else 0 end
        else "ba_decisions"."planned_methods" is null
      end);--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_planned_method_other_requires_notes" CHECK ("ba_decisions"."planned_methods" is null
        or not ("ba_decisions"."planned_methods" ? 'OTHER')
        or coalesce("ba_decisions"."notes", "ba_decisions"."note") is not null);