import { z } from "zod";

const MoneySchema = z.object({
  amount: z.string().optional(),
  price_val: z.string().optional(),
  currency: z.string().optional(),
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
    update_time: z.union([z.string(), z.number()]).optional(),
  }).passthrough()).optional(),
  delivery_module: z.array(DeliverySchema).optional(),
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
    total_count: z.number().optional(),
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
  }).passthrough(),
}).passthrough();

export const StatementOrderListResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    search_next_has_more: z.boolean().optional(),
    total_record: z.number().optional(),
    order_records: z.array(z.record(z.string(), z.unknown())).optional(),
    order_list: z.array(z.record(z.string(), z.unknown())).optional(),
    orders: z.array(z.record(z.string(), z.unknown())).optional(),
  }).passthrough(),
}).passthrough();

export type RawOrder = z.infer<typeof RawOrderSchema>;
export type OrderListResponse = z.infer<typeof OrderListResponseSchema>;
export type StatementStatResponse = z.infer<typeof StatementStatResponseSchema>;
