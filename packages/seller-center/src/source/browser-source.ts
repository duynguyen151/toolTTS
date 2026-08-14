import {
  NormalizedFinancialBatchSchema,
  NormalizedOrderBatchSchema,
  ShopSourceConfigSchema,
  SyncRequestSchema,
  type NormalizedFinancialBatch,
  type NormalizedOrderBatch,
  type SellerDataSource,
  type ShopSourceConfig,
  type SourceFingerprint,
  type SourceHealth,
  type SyncRequest,
} from "@shop-health/domain";
import type { Logger } from "pino";
import { chromium, type Browser, type Page, type Response } from "playwright-core";

import { AdsPowerClient, type AdsPowerClientOptions } from "../adspower/client.js";
import { SellerCenterError } from "../errors.js";
import {
  OrderCountResponseSchema,
  OrderListResponseSchema,
  StatementStatResponseSchema,
} from "../extractors/schemas.js";
import {
  normalizeFinancialSnapshot,
  normalizeSettlementRecord,
} from "../normalizers/finance.js";
import { normalizeOrder } from "../normalizers/orders.js";
import { stableHash } from "../normalizers/shared.js";
import { collectFinanceStatementPages } from "./finance-pagination.js";
import { assertOnHoldReconciled } from "./finance-reconciliation.js";

const SELLER_ORIGIN = "https://seller-us.tiktok.com";
const ORDER_ROUTE = `${SELLER_ORIGIN}/order`;
const FINANCE_ON_HOLD_ROUTE = `${SELLER_ORIGIN}/finance/bills?tab=overview&subTab=on-hold`;
const ORDER_LIST_PATH = "/api/fulfillment/na/order/list";
const ORDER_COUNT_PATH = "/api/fulfillment/na/order/search_count";
const STATEMENT_STAT_PATH = "/api/v1/pay/statement/stat/info";
const STATEMENT_LIST_PATH = "/api/v1/pay/statement/order/list";

export interface SellerCenterDataSourceOptions extends AdsPowerClientOptions {
  adsPowerClient?: AdsPowerClient;
  logger?: Logger;
  responseTimeoutMs?: number;
}

export function createSellerCenterDataSource(
  options: SellerCenterDataSourceOptions = {},
): SellerDataSource {
  return new SellerCenterBrowserDataSource(options);
}

export class SellerCenterBrowserDataSource implements SellerDataSource {
  private readonly adsPower: AdsPowerClient;
  private readonly logger: Logger | undefined;
  private readonly responseTimeoutMs: number;

  constructor(options: SellerCenterDataSourceOptions = {}) {
    this.adsPower = options.adsPowerClient ?? new AdsPowerClient(options);
    this.logger = options.logger;
    this.responseTimeoutMs = options.responseTimeoutMs ?? 30_000;
  }

  async health(config: ShopSourceConfig): Promise<SourceHealth> {
    const shop = ShopSourceConfigSchema.parse(config);
    try {
      return await this.withPage(shop, async (page) => {
        await page.goto(ORDER_ROUTE, { waitUntil: "domcontentloaded", timeout: this.responseTimeoutMs });
        const access = await detectAccessState(page);
        return { status: access, checkedAt: new Date(), detail: access === "HEALTHY" ? null : page.url() };
      });
    } catch (error) {
      const failure = classifyFailure(error);
      return { status: failure.status, checkedAt: new Date(), detail: failure.detail };
    }
  }

  async probe(config: ShopSourceConfig): Promise<SourceFingerprint> {
    const shop = ShopSourceConfigSchema.parse(config);
    return this.withPage(shop, async (page) => {
      const responseResult = captureJsonResponse(page, ORDER_COUNT_PATH, "POST", this.responseTimeoutMs);
      await navigateToOrders(page, this.responseTimeoutMs);
      await assertHealthyPage(page);
      const captured = await responseResult;
      if (!captured.ok) throw captured.error;
      const response = OrderCountResponseSchema.parse(captured.body);
      return { value: stableHash(response.data.count_map), capturedAt: new Date() };
    });
  }

  async *collectOrders(input: SyncRequest): AsyncIterable<NormalizedOrderBatch> {
    const request = SyncRequestSchema.parse(input);
    const batch = await this.withPage(request.shop, async (page) => {
      const responseResult = captureJsonResponseWithRequest(
        page,
        ORDER_LIST_PATH,
        "POST",
        this.responseTimeoutMs,
        isActualOrderListResponse,
      );
      await navigateToOrders(page, this.responseTimeoutMs);
      await assertHealthyPage(page);
      const captured = await responseResult;
      if (!captured.ok) throw captured.error;
      const response = OrderListResponseSchema.parse(captured.body);
      if (response.code !== 0) {
        throw new SellerCenterError("LAYOUT_CHANGED", `Order list returned source code ${response.code}`);
      }
      assertCompleteAllOrdersResponse(response.data);
      const observedAt = new Date();
      return NormalizedOrderBatchSchema.parse({
        orders: response.data.main_orders.map((order) => normalizeOrder(order, request.shop.shopId, observedAt)),
        checkpoint: null,
        complete: true,
        sourceWindow: {
          source: "SELLER_CENTER",
          kind: "ROLLING_MONTHS",
          months: 12,
          lifetimeHistory: false,
        },
      });
    });
    yield batch;
  }

  async *collectFinancials(input: SyncRequest): AsyncIterable<NormalizedFinancialBatch> {
    const request = SyncRequestSchema.parse(input);
    const batch = await this.withPage(request.shop, async (page) => {
      const statResult = captureJsonResponseWithRequest(
        page,
        STATEMENT_STAT_PATH,
        "GET",
        this.responseTimeoutMs,
        isOnHoldStatResponse,
      );
      const listResult = captureJsonResponseWithRequest(
        page,
        STATEMENT_LIST_PATH,
        "GET",
        this.responseTimeoutMs,
        isOnHoldFinancePageOne,
      );
      await navigateToFinance(page, this.responseTimeoutMs);
      const statCaptured = await statResult;
      if (!statCaptured.ok) throw statCaptured.error;
      const listCaptured = await listResult;
      if (!listCaptured.ok) throw listCaptured.error;
      const stat = StatementStatResponseSchema.parse(statCaptured.body);
      if (stat.code !== 0) {
        throw new SellerCenterError("LAYOUT_CHANGED", `Finance stat returned source code ${stat.code}`);
      }
      const collected = await collectFinanceStatementPages({
        capturedPageOneUrl: listCaptured.requestUrl,
        firstPage: listCaptured.body,
        fetchPage: (url) => fetchJsonInPage(page, url),
      });
      assertOnHoldReconciled(stat, collected.rows);
      const capturedAt = new Date();
      return NormalizedFinancialBatchSchema.parse({
        settlements: collected.rows.map((row) => normalizeSettlementRecord(row, request.shop.shopId)),
        snapshot: normalizeFinancialSnapshot(stat, request.shop.shopId, capturedAt),
        checkpoint: null,
        complete: true,
      });
    });
    yield batch;
  }

  private async withPage<T>(shop: ShopSourceConfig, operation: (page: Page) => Promise<T>): Promise<T> {
    const connection = await this.adsPower.open(shop.profileId);
    let browser: Browser | undefined;
    let page: Page | undefined;
    try {
      browser = await chromium.connectOverCDP(connection.cdpEndpoint, { timeout: this.responseTimeoutMs });
      const context = browser.contexts()[0];
      if (!context) throw new SellerCenterError("BROWSER_DISCONNECTED", "AdsPower browser has no context");
      page = await context.newPage();
      return await operation(page);
    } catch (error) {
      if (error instanceof SellerCenterError) throw error;
      throw new SellerCenterError("LAYOUT_CHANGED", "Seller Center operation failed", { cause: error });
    } finally {
      await page?.close().catch(() => undefined);
      // Release the Playwright CDP transport without stopping the AdsPower profile.
      await browser?.close().catch(() => undefined);
    }
  }
}

async function waitForJsonResponse(
  page: Page,
  path: string,
  method: "GET" | "POST",
  timeoutMs: number,
): Promise<unknown> {
  return (await waitForResponse(page, path, method, timeoutMs)).json();
}

async function captureJsonResponse(
  page: Page,
  path: string,
  method: "GET" | "POST",
  timeoutMs: number,
): Promise<{ ok: true; body: unknown } | { ok: false; error: unknown }> {
  try {
    return { ok: true, body: await waitForJsonResponse(page, path, method, timeoutMs) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function captureJsonResponseWithRequest(
  page: Page,
  path: string,
  method: "GET" | "POST",
  timeoutMs: number,
  matchesResponse?: (response: Response) => boolean,
): Promise<
  | { ok: true; body: unknown; requestUrl: string }
  | { ok: false; error: unknown }
> {
  try {
    const response = await waitForResponse(page, path, method, timeoutMs, matchesResponse);
    return {
      ok: true,
      body: await response.json(),
      requestUrl: response.request().url(),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

async function navigateToOrders(page: Page, timeoutMs: number): Promise<void> {
  const url = new URL(ORDER_ROUTE);
  url.searchParams.set("selected_sort", "6");
  url.searchParams.set("tab", "all");
  url.searchParams.set("shop_health_probe", String(Date.now()));
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
}

async function assertHealthyPage(page: Page): Promise<void> {
  const state = await detectAccessState(page);
  if (state === "LOGIN_REQUIRED") throw new SellerCenterError("LOGIN_REQUIRED", "Seller Center login is required");
  if (state === "CHALLENGE_REQUIRED") throw new SellerCenterError("CHALLENGE_REQUIRED", "Seller Center security challenge requires manual action");
  if (state !== "HEALTHY") throw new SellerCenterError("LAYOUT_CHANGED", `Unexpected Seller Center state at ${page.url()}`);
}

async function navigateToFinance(page: Page, timeoutMs: number): Promise<void> {
  await page.goto(FINANCE_ON_HOLD_ROUTE, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await assertHealthyPage(page);
  const financeUrl = new URL(page.url());
  if (
    financeUrl.origin !== SELLER_ORIGIN
    || financeUrl.pathname !== "/finance/bills"
    || financeUrl.searchParams.get("tab") !== "overview"
    || financeUrl.searchParams.get("subTab") !== "on-hold"
  ) {
    throw new SellerCenterError("LAYOUT_CHANGED", "Finance On hold route changed");
  }
}

async function waitForResponse(
  page: Page,
  path: string,
  method: "GET" | "POST",
  timeoutMs: number,
  matchesResponse?: (response: Response) => boolean,
): Promise<Response> {
  try {
    return await page.waitForResponse(
      (candidate) => candidate.request().method() === method
        && new URL(candidate.url()).pathname === path
        && candidate.status() === 200
        && (matchesResponse?.(candidate) ?? true),
      { timeout: timeoutMs },
    );
  } catch (error) {
    throw new SellerCenterError("SOURCE_TIMEOUT", `Timed out waiting for ${path}`, { cause: error });
  }
}

function isOnHoldFinancePageOne(response: Response): boolean {
  const requestUrl = new URL(response.request().url());
  return requestUrl.searchParams.get("settlement_status") === "1"
    && requestUrl.searchParams.get("from") === "0"
    && requestUrl.searchParams.get("size") === "5"
    && requestUrl.searchParams.get("page_type") === "10"
    && requestUrl.searchParams.get("pagination_type") === "1";
}

function isOnHoldStatResponse(response: Response): boolean {
  return new URL(response.request().url()).searchParams.get("amount_stat_type") === "1";
}

function isActualOrderListResponse(response: Response): boolean {
  const request = response.request();
  if (new URL(request.url()).searchParams.has("is_prefetch")) return false;
  try {
    return request.postDataJSON() === null;
  } catch {
    return false;
  }
}

function assertCompleteAllOrdersResponse(data: {
  total_count?: number | undefined;
  main_orders: ReadonlyArray<{ main_order_id: string }>;
  has_more?: boolean | undefined;
  search_next_has_more?: boolean | undefined;
}): void {
  if (data.total_count === undefined) {
    throw new SellerCenterError("LAYOUT_CHANGED", "Order total_count is missing; completeness is unproven");
  }
  if (data.has_more !== false || data.search_next_has_more !== false) {
    throw new SellerCenterError(
      "LAYOUT_CHANGED",
      data.has_more === true || data.search_next_has_more === true
        ? "Order pagination is present but its request mapping is unresolved"
        : "Order pagination termination flags are missing",
    );
  }
  const uniqueOrderIds = new Set(data.main_orders.map((order) => order.main_order_id));
  if (uniqueOrderIds.size !== data.main_orders.length) {
    throw new SellerCenterError("LAYOUT_CHANGED", "Order duplicate main_order_id values prevent reconciliation");
  }
  if (data.main_orders.length !== data.total_count || uniqueOrderIds.size !== data.total_count) {
    throw new SellerCenterError(
      "LAYOUT_CHANGED",
      `Order reconciliation failed: rows=${data.main_orders.length}, unique=${uniqueOrderIds.size}, total=${data.total_count}`,
    );
  }
}

async function fetchJsonInPage(page: Page, requestUrl: string): Promise<unknown> {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`Finance page fetch failed with HTTP ${response.status}`);
    return response.json();
  }, requestUrl);
}

async function detectAccessState(page: Page): Promise<SourceHealth["status"]> {
  const url = page.url().toLowerCase();
  if (/login|signin|passport/.test(url)) return "LOGIN_REQUIRED";
  if (/captcha|challenge|verification|verify/.test(url)) return "CHALLENGE_REQUIRED";
  const body = (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).slice(0, 20_000).toLowerCase();
  if (/log in|sign in/.test(body) && /password|email|phone/.test(body)) return "LOGIN_REQUIRED";
  if (/captcha|security verification|verify (?:that )?you are human|unusual activity/.test(body)) return "CHALLENGE_REQUIRED";
  return url.startsWith(SELLER_ORIGIN) ? "HEALTHY" : "LAYOUT_CHANGED";
}

function classifyFailure(error: unknown): { status: SourceHealth["status"]; detail: string } {
  if (error instanceof SellerCenterError) {
    const statuses: Partial<Record<SellerCenterError["failureType"], SourceHealth["status"]>> = {
      ADSPOWER_UNAVAILABLE: "UNAVAILABLE",
      PROFILE_START_FAILED: "UNAVAILABLE",
      BROWSER_DISCONNECTED: "UNAVAILABLE",
      LOGIN_REQUIRED: "LOGIN_REQUIRED",
      CHALLENGE_REQUIRED: "CHALLENGE_REQUIRED",
      LAYOUT_CHANGED: "LAYOUT_CHANGED",
      SOURCE_TIMEOUT: "UNAVAILABLE",
    };
    return { status: statuses[error.failureType] ?? "UNAVAILABLE", detail: error.message };
  }
  return { status: "UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown source failure" };
}
