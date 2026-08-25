ALTER TABLE "ba_decisions" DROP CONSTRAINT "ba_decisions_planned_method_other_requires_notes";--> statement-breakpoint
ALTER TABLE "ba_decisions" DROP CONSTRAINT "ba_decisions_note_not_blank";--> statement-breakpoint
ALTER TABLE "ba_decisions" DROP CONSTRAINT "ba_decisions_notes_not_blank";--> statement-breakpoint
ALTER TABLE "ba_decisions" DROP CONSTRAINT "ba_decisions_other_requires_notes";--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_planned_method_other_requires_notes" CHECK ("ba_decisions"."planned_methods" is null
        or not ("ba_decisions"."planned_methods" ? 'OTHER')
        or length(regexp_replace(coalesce("ba_decisions"."notes", "ba_decisions"."note", ''), E'[[:space:][:cntrl:]\u200B\uFEFF]', '', 'g')) > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_note_not_blank" CHECK ("ba_decisions"."note" is null
        or length(regexp_replace("ba_decisions"."note", E'[[:space:][:cntrl:]\u200B\uFEFF]', '', 'g')) > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_notes_not_blank" CHECK ("ba_decisions"."notes" is null
        or length(regexp_replace("ba_decisions"."notes", E'[[:space:][:cntrl:]\u200B\uFEFF]', '', 'g')) > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "ba_decisions" ADD CONSTRAINT "ba_decisions_other_requires_notes" CHECK ("ba_decisions"."reason_code" <> 'OTHER'
        or length(regexp_replace(coalesce("ba_decisions"."notes", "ba_decisions"."note", ''), E'[[:space:][:cntrl:]\u200B\uFEFF]', '', 'g')) > 0
        or "ba_decisions"."actor" = 'LEGACY_UNATTRIBUTED') NOT VALID;