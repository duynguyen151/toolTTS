import { SellerCenterError } from "../errors.js";
import {
  OrderListResponseSchema,
  type RawOrder,
} from "../extractors/schemas.js";

export const MAX_ORDER_PAGES = 50;

export interface OrderPageRequest {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
}

export type LockedPaginationProtocol =
  | {
      readonly mode: "CURSOR_TOKEN";
      readonly requestField: "cursor_token";
      readonly responseField: "next_cursor_token";
    }
  | {
      readonly mode: "SEARCH_NEXT_CURSOR";
      readonly requestField: "search_next_cursor";
      readonly responseField: "search_next_cursor";
    };

export type HasMoreSignal =
  | { readonly status: "HAS_MORE"; readonly hasMore: true }
  | { readonly status: "NO_MORE"; readonly hasMore: false }
  | { readonly status: "UNKNOWN"; readonly reason: string };

export interface ParsedOrderPage {
  readonly orders: readonly RawOrder[];
  readonly totalCount: number | null;
  readonly hasMoreSignal: HasMoreSignal;
  readonly nextCursorToken: string | null;
  readonly searchNextCursor: string | null;
}

export type OrderPaginationStopReason =
  | "END_OF_PAGES"
  | "PAGINATION_PROTOCOL_ERROR"
  | "PAGINATION_LOOP"
  | "NO_PROGRESS"
  | "PAGE_LIMIT_REACHED"
  | "FETCH_ERROR"
  | "RESPONSE_PARSE_ERROR";

export type TotalCountReconciliation =
  | { readonly status: "MATCH"; readonly expected: number; readonly collected: number }
  | { readonly status: "MISMATCH"; readonly expected: number; readonly collected: number; readonly delta: number }
  | { readonly status: "UNKNOWN"; readonly collected: number; readonly reason: string };

export interface OrderPaginationDiagnostics {
  readonly duplicateOrderCount: number;
  readonly repeatedCursor: boolean;
  readonly stoppedByPageLimit: boolean;
  readonly noProgress: boolean;
  readonly expectedTotalCount: number | null;
  readonly collectedUniqueCount: number;
  readonly stopReason: OrderPaginationStopReason;
  readonly reconciliation: TotalCountReconciliation;
}

export interface OrderPaginationResult {
  readonly orders: readonly RawOrder[];
  readonly totalCount: number | null;
  readonly pages: number;
  readonly completeness: "COMPLETE" | "INCOMPLETE";
  readonly diagnostics: OrderPaginationDiagnostics;
}

export interface CollectOrderPagesInput {
  readonly capturedRequest: OrderPageRequest;
  readonly firstPage: unknown;
  fetchPostPage(request: OrderPageRequest): Promise<unknown>;
  readonly maxPages?: number;
}

export function parseOrderPage(body: unknown): ParsedOrderPage {
  const parseResult = OrderListResponseSchema.safeParse(body);
  if (!parseResult.success) {
    throw new SellerCenterError("API_SCHEMA_CHANGED", "Order list response schema changed", {
      cause: parseResult.error,
    });
  }

  const parsed = parseResult.data;
  if (parsed.code !== 0) {
    throw new SellerCenterError("API_REJECTED", `Order list returned source code ${parsed.code}`);
  }

  let hasMoreSignal: HasMoreSignal;
  if (typeof parsed.data.has_more === "boolean") {
    hasMoreSignal = parsed.data.has_more
      ? { status: "HAS_MORE", hasMore: true }
      : { status: "NO_MORE", hasMore: false };
  } else if (typeof parsed.data.search_next_has_more === "boolean") {
    hasMoreSignal = parsed.data.search_next_has_more
      ? { status: "HAS_MORE", hasMore: true }
      : { status: "NO_MORE", hasMore: false };
  } else if (parsed.data.next_cursor_token === undefined && parsed.data.search_next_cursor === undefined) {
    // Single page response without explicit has_more fields and without next cursors
    hasMoreSignal = { status: "NO_MORE", hasMore: false };
  } else {
    hasMoreSignal = {
      status: "UNKNOWN",
      reason: "Missing both has_more and search_next_has_more fields with cursor present",
    };
  }

  const nextCursorToken = typeof parsed.data.next_cursor_token === "string" && parsed.data.next_cursor_token.length > 0
    ? parsed.data.next_cursor_token
    : null;

  const searchNextCursor = typeof parsed.data.search_next_cursor === "string" && parsed.data.search_next_cursor.length > 0
    ? parsed.data.search_next_cursor
    : null;

  return {
    orders: parsed.data.main_orders,
    totalCount: typeof parsed.data.total_count === "number" ? parsed.data.total_count : null,
    hasMoreSignal,
    nextCursorToken,
    searchNextCursor,
  };
}

export function detectLockedProtocol(
  requestBody: unknown,
  firstPageParsed: ParsedOrderPage,
): LockedPaginationProtocol | null {
  if (requestBody !== null && typeof requestBody === "object") {
    const record = requestBody as Record<string, unknown>;
    if ("cursor_token" in record && typeof record.cursor_token === "string") {
      return {
        mode: "CURSOR_TOKEN",
        requestField: "cursor_token",
        responseField: "next_cursor_token",
      };
    }
    if ("search_next_cursor" in record && typeof record.search_next_cursor === "string") {
      return {
        mode: "SEARCH_NEXT_CURSOR",
        requestField: "search_next_cursor",
        responseField: "search_next_cursor",
      };
    }
  }

  if (firstPageParsed.nextCursorToken !== null) {
    return {
      mode: "CURSOR_TOKEN",
      requestField: "cursor_token",
      responseField: "next_cursor_token",
    };
  }

  if (firstPageParsed.searchNextCursor !== null) {
    return {
      mode: "SEARCH_NEXT_CURSOR",
      requestField: "search_next_cursor",
      responseField: "search_next_cursor",
    };
  }

  return null;
}

export function buildNextOrderRequest(params: {
  readonly originalRequest: OrderPageRequest;
  readonly lockedProtocol: LockedPaginationProtocol;
  readonly nextCursorValue: string;
}): OrderPageRequest {
  const clonedBody = params.originalRequest.body !== null && typeof params.originalRequest.body === "object"
    ? structuredClone(params.originalRequest.body)
    : {};

  const record = clonedBody as Record<string, unknown>;
  record[params.lockedProtocol.requestField] = params.nextCursorValue;

  return {
    url: params.originalRequest.url,
    body: record,
    ...(params.originalRequest.headers ? { headers: { ...params.originalRequest.headers } } : {}),
  };
}

function resolveReconciliation(
  expectedTotal: number | null,
  collectedCount: number,
): TotalCountReconciliation {
  if (expectedTotal === null) {
    return {
      status: "UNKNOWN",
      collected: collectedCount,
      reason: "Order total_count is not provided in response",
    };
  }
  if (collectedCount === expectedTotal) {
    return {
      status: "MATCH",
      expected: expectedTotal,
      collected: collectedCount,
    };
  }
  return {
    status: "MISMATCH",
    expected: expectedTotal,
    collected: collectedCount,
    delta: Math.abs(expectedTotal - collectedCount),
  };
}

export async function collectOrderPages(
  input: CollectOrderPagesInput,
): Promise<OrderPaginationResult> {
  const maxPages = input.maxPages ?? MAX_ORDER_PAGES;
  const seenOrderIds = new Set<string>();
  const seenCursors = new Set<string>();
  const collectedOrders: RawOrder[] = [];

  let duplicateOrderCount = 0;
  let pages = 0;
  let currentPageBody: unknown = input.firstPage;
  let lockedProtocol: LockedPaginationProtocol | null = null;
  let expectedTotalCount: number | null = null;
  let stopReason: OrderPaginationStopReason = "END_OF_PAGES";

  while (pages < maxPages) {
    const parsedPage = parseOrderPage(currentPageBody);
    pages += 1;

    if (expectedTotalCount === null && parsedPage.totalCount !== null) {
      expectedTotalCount = parsedPage.totalCount;
    }

    if (lockedProtocol === null) {
      lockedProtocol = detectLockedProtocol(input.capturedRequest.body, parsedPage);
    }

    let pageNewUniqueOrders = 0;
    for (const order of parsedPage.orders) {
      if (seenOrderIds.has(order.main_order_id)) {
        duplicateOrderCount += 1;
      } else {
        seenOrderIds.add(order.main_order_id);
        collectedOrders.push(order);
        pageNewUniqueOrders += 1;
      }
    }

    if (parsedPage.hasMoreSignal.status === "UNKNOWN") {
      stopReason = "RESPONSE_PARSE_ERROR";
      break;
    }

    if (parsedPage.hasMoreSignal.status === "NO_MORE") {
      stopReason = "END_OF_PAGES";
      break;
    }

    if (lockedProtocol === null) {
      stopReason = "PAGINATION_PROTOCOL_ERROR";
      break;
    }

    const nextCursorValue = lockedProtocol.mode === "CURSOR_TOKEN"
      ? parsedPage.nextCursorToken
      : parsedPage.searchNextCursor;

    if (nextCursorValue === null) {
      stopReason = "PAGINATION_PROTOCOL_ERROR";
      break;
    }

    if (seenCursors.has(nextCursorValue)) {
      stopReason = "PAGINATION_LOOP";
      break;
    }
    seenCursors.add(nextCursorValue);

    if (pageNewUniqueOrders === 0 && parsedPage.orders.length === 0) {
      stopReason = "NO_PROGRESS";
      break;
    }

    if (pages >= maxPages) {
      stopReason = "PAGE_LIMIT_REACHED";
      break;
    }

    const nextRequest = buildNextOrderRequest({
      originalRequest: input.capturedRequest,
      lockedProtocol,
      nextCursorValue,
    });

    try {
      currentPageBody = await input.fetchPostPage(nextRequest);
    } catch (error) {
      if (error instanceof SellerCenterError) {
        throw error;
      }
      throw new SellerCenterError("SOURCE_TIMEOUT", "Failed to fetch next order page in browser context", {
        cause: error,
      });
    }
  }

  const isComplete = stopReason === "END_OF_PAGES";
  const reconciliation = resolveReconciliation(expectedTotalCount, collectedOrders.length);

  return {
    orders: collectedOrders,
    totalCount: expectedTotalCount,
    pages,
    completeness: isComplete ? "COMPLETE" : "INCOMPLETE",
    diagnostics: {
      duplicateOrderCount,
      repeatedCursor: stopReason === "PAGINATION_LOOP",
      stoppedByPageLimit: stopReason === "PAGE_LIMIT_REACHED",
      noProgress: stopReason === "NO_PROGRESS",
      expectedTotalCount,
      collectedUniqueCount: collectedOrders.length,
      stopReason,
      reconciliation,
    },
  };
}
