ALTER TYPE "public"."canonical_order_status" ADD VALUE 'UNPAID' BEFORE 'AWAITING_SHIPMENT';--> statement-breakpoint
ALTER TYPE "public"."canonical_order_status" ADD VALUE 'ON_HOLD' BEFORE 'AWAITING_SHIPMENT';--> statement-breakpoint
ALTER TYPE "public"."canonical_order_status" ADD VALUE 'AWAITING_COLLECTION' BEFORE 'IN_TRANSIT';