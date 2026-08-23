import { SellerCenterError } from "../errors.js";
import {
  StatementOrderListResponseSchema,
  type RawStatementOrder,
} from "../extractors/schemas.js";
import { stableHash } from "../normalizers/shared.js";

const STATEMENT_LIST_PATH = "/api/v1/pay/statement/order/list";
const MAX_FINANCE_PAGES = 100;
const ALLOWED_QUERY_KEYS = new Set([
  "locale",
  "language",
  "oec_seller_id",
  "seller_id",
  "pagination_type",
  "from",
  "size",
  "terminal_type",
  "page_type",
  "settlement_status",
  "need_total_amount",
  "no_need_sku_record",
  "statement_version",
]);
const REQUIRED_QUERY_VALUES: Readonly<Record<string, string>> = {
  pagination_type: "1",
  from: "0",
  terminal_type: "1",
  page_type: "10",
  settlement_status: "1",
  no_need_sku_record: "false",
  statement_version: "1",
};

export interface CollectFinanceStatementPagesInput {
  capturedPageOneUrl: string;
  firstPage: unknown;
  fetchPage(url: string): Promise<unknown>;
  deadlineAt?: number;
}

export interface CollectedFinanceStatementPages {
  rows: RawStatementOrder[];
  totalRecord: number;
  pages: number;
}

export async function collectFinanceStatementPages(
  input: CollectFinanceStatementPagesInput,
): Promise<CollectedFinanceStatementPages> {
  const requestTemplate = sanitizedRequestTemplate(input.capturedPageOneUrl);
  const seenOffsets = new Set<number>();
  const seenPageSignatures = new Set<string>();
  const seenIds = new Set<string>();
  const rows: RawStatementOrder[] = [];
  let pageBody: unknown = input.firstPage;
  let offset = 0;
  let expectedTotal: number | undefined;
  let pages = 0;

  while (true) {
    if (pages >= MAX_FINANCE_PAGES) {
      throw sourceChanged(`reason=page_limit_reached; Finance pagination exceeded ${MAX_FINANCE_PAGES} Finance pages`);
    }
    if (seenOffsets.has(offset)) {
      throw sourceChanged(`Finance pagination repeated offset ${offset}`);
    }
    seenOffsets.add(offset);

    if (typeof pageBody === "object" && pageBody !== null && "code" in pageBody) {
      const sourceCode = (pageBody as { code?: unknown }).code;
      if (typeof sourceCode === "number" && sourceCode !== 0) {
        throw new SellerCenterError("API_REJECTED", `Finance order list returned source code ${sourceCode}`);
      }
    }
    const parsedResult = StatementOrderListResponseSchema.safeParse(pageBody);
    if (!parsedResult.success) throw sourceChanged("Finance order list response schema changed");
    const parsed = parsedResult.data;
    pages += 1;

    if (expectedTotal === undefined) expectedTotal = parsed.data.total_record;
    if (parsed.data.total_record !== expectedTotal) {
      throw sourceChanged(
        `Finance total_record changed from ${expectedTotal} to ${parsed.data.total_record}`,
      );
    }

    const pageIds = parsed.data.order_records.map((row) => row.statement_detail_id);
    const pageSignature = stableHash({ pageIds });
    if (seenPageSignatures.has(pageSignature)) {
      throw sourceChanged("Finance pagination returned a repeated Finance page");
    }
    seenPageSignatures.add(pageSignature);

    for (const row of parsed.data.order_records) {
      if (seenIds.has(row.statement_detail_id)) {
        throw sourceChanged(`Finance pagination returned duplicate statement_detail_id ${row.statement_detail_id}`);
      }
      seenIds.add(row.statement_detail_id);
      rows.push(row);
    }

    if (parsed.data.search_next_has_more === false) {
      if (seenIds.size !== expectedTotal) {
        throw sourceChanged(
          `Finance unique row count ${seenIds.size} does not match total_record ${expectedTotal}`,
        );
      }
      return { rows, totalRecord: expectedTotal, pages };
    }

    if (parsed.data.order_records.length === 0) {
      throw sourceChanged(`Unexpected empty Finance page at offset ${offset}`);
    }
    offset += parsed.data.order_records.length;
    const nextUrl = new URL(requestTemplate);
    nextUrl.searchParams.set("from", String(offset));
    const remainingMs = (input.deadlineAt ?? Number.POSITIVE_INFINITY) - Date.now();
    if (remainingMs <= 0) {
      throw new SellerCenterError("SOURCE_TIMEOUT", "Finance pagination exceeded the endpoint response deadline");
    }
    pageBody = await withDeadline(
      input.fetchPage(nextUrl.toString()),
      remainingMs,
      "Finance pagination exceeded the endpoint response deadline",
    );
  }
}

function sanitizedRequestTemplate(value: string): string {
  const url = new URL(value);
  if (url.origin !== "https://seller-us.tiktok.com" || url.pathname !== STATEMENT_LIST_PATH) {
    throw sourceChanged("Captured Finance request target changed");
  }

  for (const key of [...url.searchParams.keys()]) {
    if (!ALLOWED_QUERY_KEYS.has(key)) url.searchParams.delete(key);
  }
  for (const key of ALLOWED_QUERY_KEYS) {
    if (url.searchParams.getAll(key).length > 1) {
      throw sourceChanged(`Captured Finance request has duplicate ${key}`);
    }
  }
  for (const [key, expected] of Object.entries(REQUIRED_QUERY_VALUES)) {
    if (url.searchParams.get(key) !== expected) {
      throw sourceChanged(`Captured Finance request ${key} changed`);
    }
  }
  for (const key of ["locale", "language", "oec_seller_id", "seller_id"] as const) {
    if (!url.searchParams.get(key)) throw sourceChanged(`Captured Finance request is missing ${key}`);
  }
  return url.toString();
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs)) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new SellerCenterError("SOURCE_TIMEOUT", message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function sourceChanged(message: string): SellerCenterError {
  return new SellerCenterError("INCOMPLETE_RESPONSE", message);
}
