ALTER TABLE "decision_cases" DROP CONSTRAINT "decision_cases_shop_origin_fk";
--> statement-breakpoint
ALTER TABLE "decision_cases" ADD CONSTRAINT "decision_cases_shop_origin_fk" FOREIGN KEY ("shop_id","case_origin") REFERENCES "public"."shops"("id","data_origin") ON DELETE restrict ON UPDATE restrict;