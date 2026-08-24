import { z } from "zod";

const MoneySchema = z.object({
  amount: z.string().optional(),
  price_val: z.string().optional(),
  currency: z.string().optional(),
}).passthrough();

const RequiredMoneySchema = z.object({
  amount: z.string().min(1),
  currency: z.string().min(1),
}).passthrough();

const SignedFeeMoneySchema = RequiredMoneySchema.extend({
  amount: z.string().regex(/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/),
});

const StarlingLabelSchema = z.object({
  starling_key: z.string().min(1),
  starling_text: z.string().min(1),
  params: z.array(z.string()).optional(),
}).passthrough();

const OrderStatusSchema = z.object({
  main_order_status: z.union([z.number(), z.string()]),
  main_sub_order_status: z.union([z.number(), z.string()]).optional(),
  sku_display_status: z.union([z.number(), z.string()]).optional(),
}).passthrough();

const DeliverySchema = z.object({
  tracking_no: z.string().optional(),
  logistics_service_info: z.object({
    logistics_service_name: z.string().optional(),
    logistics_service_level: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

const EpochStringSchema = z.string().regex(/^\d+$/);
const SourceCodeSchema = z.number().int().nonnegative();

const ReverseModuleSchema = z.object({
  reverse_status: SourceCodeSchema,
  reverse_tab_status: SourceCodeSchema,
  reverse_type: SourceCodeSchema,
  reverse_from: SourceCodeSchema,
  cancelled_time: EpochStringSchema,
  // Canonical live Orders evidence: a reverse record may omit refund_time while
  // the remaining reverse timestamps stay valid epoch strings.
  refund_time: EpochStringSchema.optional(),
  seller_auto_approve_time: EpochStringSchema,
}).strip();

export const RawOrderSchema = z.object({
  main_order_id: z.string().min(1),
  trade_order_module: z.object({
    main_order_id: z.string().optional(),
    create_time: z.union([z.string(), z.number()]).optional(),
    payment_time: z.union([z.string(), z.number()]).optional(),
    latest_delivery_time: z.union([z.string(), z.number()]).optional(),
  }).passthrough(),
  order_status_module: z.array(OrderStatusSchema).min(1),
  fulfillment_module: z.array(z.object({
    rts_time: z.union([z.string(), z.number()]).optional(),
    update_time: z.union([z.string(), z.number()]).optional(),
  }).passthrough()).optional(),
  delivery_module: z.array(DeliverySchema).optional(),
  reverse_module: z.array(ReverseModuleSchema).max(1).optional(),
  price_module: z.object({
    grand_total: MoneySchema,
  }).passthrough(),
}).passthrough();

export const OrderListResponseSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z.object({
    offset: z.number().optional(),
    count: z.number().optional(),
    total_count: z.number().int().nonnegative().optional(),
    main_orders: z.array(RawOrderSchema),
    next_cursor_token: z.string().optional(),
    has_more: z.boolean().optional(),
    search_next_cursor: z.string().optional(),
    search_next_has_more: z.boolean().optional(),
  }).passthrough(),
}).passthrough();

export const OrderCountResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    count_map: z.record(z.string(), z.number()),
  }).passthrough(),
}).passthrough();

export const StatementStatResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    to_settle_amount_stat: z.object({
      amount: MoneySchema,
      reasons_detail: z.array(z.object({
        reason: z.union([z.number(), z.string()]).optional(),
        amount: MoneySchema.optional(),
      }).passthrough()).optional(),
    }).passthrough().optional(),
    seller_reserve_stat: z.object({
      seller_reserve_level: z.union([z.number(), z.string()]).optional(),
      reserve_level: z.string().optional(),
      reserve_days: z.string().optional(),
      reserve_ratio: z.string().optional(),
    }).passthrough().optional(),
    seller_quality_stat: z.object({
      quality_title: StarlingLabelSchema.optional(),
      bill_finish_period_in_days: z.number().int().nonnegative().optional(),
      settle_period_type: z.union([z.string(), z.number()]).optional(),
    }).passthrough().optional(),
  }).passthrough(),
}).passthrough();

const SourceScalarSchema = z.union([z.string().min(1), z.number()]);

export const RawStatementOrderSchema = z.object({
  statement_detail_id: z.string().min(1),
  reference_id: z.string().min(1),
  trade_order_id: z.string().min(1),
  placed_time: z.union([z.string().min(1), z.number()]),
  trade_type: SourceScalarSchema,
  settlement_amount: RequiredMoneySchema,
  earning_amount: RequiredMoneySchema,
  fees: SignedFeeMoneySchema,
  settlement_status: z.union([z.literal(1), z.literal("1")]),
  to_settle_reason: z.union([
    z.literal(1),
    z.literal("1"),
    z.literal(2),
    z.literal("2"),
    z.literal(3),
    z.literal("3"),
  ]),
  estimate_settle_time: z.union([z.string().min(1), z.number()]).optional(),
  delivery_time: z.union([z.string().min(1), z.number()]),
  estimate_settle_time_not_delivery: StarlingLabelSchema,
  statement_id: SourceScalarSchema,
  statement_version: SourceScalarSchema,
  source_page_types: z.array(StarlingLabelSchema),
}).passthrough();

export const StatementOrderListResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    search_next_has_more: z.boolean(),
    total_record: z.number().int().nonnegative(),
    order_records: z.array(RawStatementOrderSchema),
  }).passthrough(),
}).passthrough();

export type RawOrder = z.infer<typeof RawOrderSchema>;
export type OrderListResponse = z.infer<typeof OrderListResponseSchema>;
export type StatementStatResponse = z.infer<typeof StatementStatResponseSchema>;
export type RawStatementOrder = z.infer<typeof RawStatementOrderSchema>;
export type StatementOrderListResponse = z.infer<typeof StatementOrderListResponseSchema>;
