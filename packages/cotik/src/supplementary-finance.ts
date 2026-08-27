import { createHash } from "node:crypto";

import { z } from "zod";

import {
  CotikSignedDecimalAmountSchema,
  CotikSupplementaryPaymentSchema,
  CotikSupplementaryStatementSchema,
  type CotikSupplementaryPayment,
  type CotikSupplementaryStatement,
} from "@shop-health/domain";

import type { CotikClient } from "./client.js";

const PAGE_SIZE_MAX = 100;
const SLIDING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const STATEMENT_LIST_PATH = "/statements/";
const PAYMENT_LIST_PATH = "/payment-tiktok/";

export const COTIK_SUPPLEMENTARY_FINANCE_SCHEMA_VERSION = "cotik-us-supplementary-finance.v1";

export type CotikSupplementaryFinanceIngestionErrorCode = "EMPTY_PAGE" | "PAGINATION_MISMATCH";

export class CotikSupplementaryFinanceIngestionError extends Error {
  readonly code: CotikSupplementaryFinanceIngestionErrorCode;

  constructor(code: CotikSupplementaryFinanceIngestionErrorCode, message: string) {
    super(message);
    this.name = "CotikSupplementaryFinanceIngestionError";
    this.code = code;
  }
}

export interface CotikSupplementaryFinanceIngestionInput {
  /** Guarded COTIK read client; no COTIK business write is available through this seam. */
  readonly client: CotikClient;
  /** Canonical shop ID for local persistence only. */
  readonly shopId: string;
  /** COTIK shop `_id` required to scope both documented finance endpoints. */
  readonly cotikShopId: string;
  readonly persistStatements: (records: readonly CotikSupplementaryStatement[]) => Promise<void>;
  readonly persistPayments: (records: readonly CotikSupplementaryPayment[]) => Promise<void>;
  readonly now?: () => Date;
  readonly pageSize?: number;
}

export interface CotikSupplementaryFinanceIngestionResult {
  readonly classification: "SUPPLEMENTARY_FINANCE";
  readonly officialOnHoldCapabilityStatus: "OFFICIAL_ON_HOLD_UNPROVEN";
  readonly statementPagesFetched: number;
  readonly paymentPagesFetched: number;
  readonly statementsPersisted: number;
  readonly paymentsPersisted: number;
  readonly window: { readonly start: Date; readonly end: Date };
}

const StatementPageSchema = z.object({
  statements: z.array(z.unknown()),
  totalsize: z.number().int().nonnegative(),
});

const PaymentPageSchema = z.object({
  paymenttiktoks: z.array(z.unknown()),
  totalsize: z.number().int().nonnegative(),
});

/** Builds the documented GET `/statements/` path with bounded page size and date window. */
export function buildCotikStatementListPath(params: CotikSupplementaryFinancePathInput): string {
  return buildListPath(STATEMENT_LIST_PATH, params);
}

/** Builds the documented GET `/payment-tiktok/` path with bounded page size and date window. */
export function buildCotikPaymentListPath(params: CotikSupplementaryFinancePathInput): string {
  return buildListPath(PAYMENT_LIST_PATH, params);
}

export interface CotikSupplementaryFinancePathInput {
  readonly page: number;
  readonly sizePerPage: number;
  readonly cotikShopId: string;
  readonly dateStartMs: number;
  readonly dateEndMs: number;
}

/**
 * Reads the guide-required sliding three-day window to its reported `totalsize`.
 * The returned classification deliberately cannot imply freshness, reconciliation,
 * Rule input, or Official On Hold proof.
 */
export async function ingestCotikSupplementaryFinance(
  input: CotikSupplementaryFinanceIngestionInput,
): Promise<CotikSupplementaryFinanceIngestionResult> {
  if (!input.shopId.trim()) throw new Error("Canonical shop id is required");
  if (!input.cotikShopId.trim()) throw new Error("COTIK shop id is required");
  const pageSize = input.pageSize ?? PAGE_SIZE_MAX;
  assertPageSize(pageSize);
  const end = (input.now ?? (() => new Date()))();
  const window = { start: new Date(end.getTime() - SLIDING_WINDOW_MS), end };
  const pathInput = {
    sizePerPage: pageSize,
    cotikShopId: input.cotikShopId,
    dateStartMs: window.start.getTime(),
    dateEndMs: window.end.getTime(),
  };
  const statementResult = await paginate(
    (page) => input.client.get(buildCotikStatementListPath({ ...pathInput, page }), StatementPageSchema),
    (data) => data.statements,
    (raw) => normalizeCotikStatement(raw, input.shopId, end, input.cotikShopId),
    input.persistStatements,
    pageSize,
  );
  const paymentResult = await paginate(
    (page) => input.client.get(buildCotikPaymentListPath({ ...pathInput, page }), PaymentPageSchema),
    (data) => data.paymenttiktoks,
    (raw) => normalizeCotikPayment(raw, input.shopId, end, input.cotikShopId),
    input.persistPayments,
    pageSize,
  );

  return {
    classification: "SUPPLEMENTARY_FINANCE",
    officialOnHoldCapabilityStatus: "OFFICIAL_ON_HOLD_UNPROVEN",
    statementPagesFetched: statementResult.pagesFetched,
    paymentPagesFetched: paymentResult.pagesFetched,
    statementsPersisted: statementResult.persisted,
    paymentsPersisted: paymentResult.persisted,
    window,
  };
}

/** Normalizes allowlisted COTIK statement facts; bank account data is intentionally excluded. */
export function normalizeCotikStatement(
  raw: unknown,
  shopId: string,
  observedAt = new Date(),
  expectedCotikShopId?: string,
): CotikSupplementaryStatement {
  const source = CotikStatementSchema.parse(raw);
  if (expectedCotikShopId !== undefined && source.shopId !== expectedCotikShopId) {
    throw new Error("COTIK statement belongs to a different bound shop");
  }
  const rawData = {
    cotikStatementId: source._id ?? null,
    providerStatementId: source.apiStatementId,
    providerPaymentId: nullableText(source.payment_id),
    providerShopId: source.shopId,
    paymentStatus: source.payment_status,
    orderIds: source.order_ids ?? [],
  };
  return CotikSupplementaryStatementSchema.parse({
    shopId,
    providerStatementId: source.apiStatementId,
    providerPaymentId: nullableText(source.payment_id),
    providerShopId: source.shopId,
    statementAt: millisecondsToTimestamp(source.statement_time),
    currency: source.currency.trim().toUpperCase(),
    revenueAmount: source.revenue_amount,
    feeAmount: source.fee_amount,
    adjustmentAmount: source.adjustment_amount,
    shippingCostAmount: source.shipping_cost_amount,
    netSalesAmount: source.net_sales_amount,
    settlementAmount: source.settlement_amount,
    paymentStatus: source.payment_status,
    orderIds: source.order_ids ?? [],
    observedAt,
    sourceHash: stableHash(rawData),
    sourceSchemaVersion: COTIK_SUPPLEMENTARY_FINANCE_SCHEMA_VERSION,
    rawData,
    classification: "SUPPLEMENTARY_FINANCE",
    officialOnHoldCapabilityStatus: "OFFICIAL_ON_HOLD_UNPROVEN",
  });
}

/** Normalizes allowlisted COTIK payout facts; bank account data is intentionally excluded. */
export function normalizeCotikPayment(
  raw: unknown,
  shopId: string,
  observedAt = new Date(),
  expectedCotikShopId?: string,
): CotikSupplementaryPayment {
  const source = CotikPaymentSchema.parse(raw);
  if (expectedCotikShopId !== undefined && source.shop_id !== expectedCotikShopId) {
    throw new Error("COTIK payment belongs to a different bound shop");
  }
  const rawData = {
    cotikPaymentId: source._id ?? null,
    providerPaymentId: source.id,
    providerShopId: source.shop_id,
    paymentStatus: source.status,
    exchangeRate: source.exchange_rate ?? null,
  };
  return CotikSupplementaryPaymentSchema.parse({
    shopId,
    providerPaymentId: source.id,
    providerShopId: source.shop_id,
    paymentStatus: source.status,
    currency: source.amount.currency.trim().toUpperCase(),
    amount: source.amount.value,
    settlementAmount: source.settlement_amount.value,
    reserveAmount: source.reserve_amount.value,
    paymentAmountBeforeExchange: source.payment_amount_before_exchange.value,
    createdAt: millisecondsToTimestamp(source.create_time),
    paidAt: millisecondsToTimestamp(source.paid_time),
    observedAt,
    sourceHash: stableHash(rawData),
    sourceSchemaVersion: COTIK_SUPPLEMENTARY_FINANCE_SCHEMA_VERSION,
    rawData,
    classification: "SUPPLEMENTARY_FINANCE",
    officialOnHoldCapabilityStatus: "OFFICIAL_ON_HOLD_UNPROVEN",
  });
}

const MillisecondsSchema = z.number().int().nonnegative();
const CotikStatementSchema = z.object({
  _id: z.string().min(1).optional(),
  apiStatementId: z.string().min(1),
  statement_time: MillisecondsSchema,
  currency: z.string().min(1),
  revenue_amount: CotikSignedDecimalAmountSchema,
  fee_amount: CotikSignedDecimalAmountSchema,
  adjustment_amount: CotikSignedDecimalAmountSchema,
  shipping_cost_amount: CotikSignedDecimalAmountSchema,
  net_sales_amount: CotikSignedDecimalAmountSchema,
  settlement_amount: CotikSignedDecimalAmountSchema,
  payment_id: z.string().optional(),
  payment_status: z.string().min(1),
  shopId: z.string().min(1),
  order_ids: z.array(z.string().min(1)).optional(),
});
const CotikMoneySchema = z.object({ currency: z.string().min(1), value: CotikSignedDecimalAmountSchema });
const CotikPaymentSchema = z.object({
  _id: z.string().min(1).optional(),
  id: z.string().min(1),
  status: z.string().min(1),
  amount: CotikMoneySchema,
  settlement_amount: CotikMoneySchema,
  reserve_amount: CotikMoneySchema,
  payment_amount_before_exchange: CotikMoneySchema,
  exchange_rate: CotikSignedDecimalAmountSchema.optional(),
  create_time: MillisecondsSchema,
  paid_time: MillisecondsSchema,
  shop_id: z.string().min(1),
});

function buildListPath(path: string, params: CotikSupplementaryFinancePathInput): string {
  assertPositiveInteger(params.page, "page");
  assertPageSize(params.sizePerPage);
  if (!params.cotikShopId.trim()) throw new RangeError("COTIK shop id is required");
  if (!Number.isSafeInteger(params.dateStartMs) || !Number.isSafeInteger(params.dateEndMs) || params.dateStartMs >= params.dateEndMs) {
    throw new RangeError("date window must use increasing millisecond timestamps");
  }
  return `${path}?page=${params.page}&sizeperpage=${params.sizePerPage}&dateStart=${params.dateStartMs}&dateEnd=${params.dateEndMs}&shops=${encodeURIComponent(params.cotikShopId.trim())}`;
}

async function paginate<TPage, TRecord>(
  fetchPage: (page: number) => Promise<TPage>,
  rows: (page: TPage) => readonly unknown[],
  normalize: (raw: unknown) => TRecord,
  persist: (records: readonly TRecord[]) => Promise<void>,
  pageSize: number,
): Promise<{ readonly pagesFetched: number; readonly persisted: number }> {
  let expectedTotal: number | null = null;
  let pagesFetched = 0;
  let persisted = 0;
  const seen = new Set<string>();
  while (true) {
    pagesFetched += 1;
    const data = await fetchPage(pagesFetched);
    const pageRows = rows(data);
    const parsed = z.object({ totalsize: z.number().int().nonnegative() }).parse(data);
    if (expectedTotal === null) expectedTotal = parsed.totalsize;
    else if (parsed.totalsize !== expectedTotal) {
      throw new CotikSupplementaryFinanceIngestionError("PAGINATION_MISMATCH", `totalsize changed from ${expectedTotal} to ${parsed.totalsize}`);
    }
    if (pageRows.length > pageSize) {
      throw new CotikSupplementaryFinanceIngestionError("PAGINATION_MISMATCH", `page ${pagesFetched} exceeded requested sizeperpage ${pageSize}`);
    }
    const normalized = pageRows.map(normalize);
    const unique = normalized.filter((record) => {
      const key = recordIdentity(record);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (unique.length > 0) await persist(unique);
    persisted += unique.length;
    if (pageRows.length === 0 && persisted < expectedTotal) {
      throw new CotikSupplementaryFinanceIngestionError("EMPTY_PAGE", `page ${pagesFetched} ended before totalsize ${expectedTotal}`);
    }
    if (unique.length === 0 && persisted < expectedTotal) {
      throw new CotikSupplementaryFinanceIngestionError("PAGINATION_MISMATCH", `page ${pagesFetched} contained no new provider IDs before totalsize ${expectedTotal}`);
    }
    if (pageRows.length < pageSize || persisted >= expectedTotal) break;
  }
  if (persisted !== expectedTotal) {
    throw new CotikSupplementaryFinanceIngestionError("PAGINATION_MISMATCH", `traversal delivered ${persisted} provider IDs but totalsize was ${expectedTotal}`);
  }
  return { pagesFetched, persisted };
}

function recordIdentity(record: unknown): string {
  const value = record as { providerStatementId?: string; providerPaymentId?: string };
  return value.providerStatementId ?? value.providerPaymentId ?? "";
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
}

function assertPageSize(value: number): void {
  assertPositiveInteger(value, "sizeperpage");
  if (value > PAGE_SIZE_MAX) throw new RangeError(`sizeperpage ${value} exceeds the documented maximum of ${PAGE_SIZE_MAX}`);
}

function millisecondsToTimestamp(value: number): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new RangeError("COTIK timestamp is invalid");
  return parsed;
}

function nullableText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function stableHash(value: object): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
