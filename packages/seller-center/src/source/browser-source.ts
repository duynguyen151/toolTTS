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
  StatementOrderListResponseSchema,
  StatementStatResponseSchema,
} from "../extractors/schemas.js";
import { normalizeFinancialSnapshot } from "../normalizers/finance.js";
import { normalizeOrder } from "../normalizers/orders.js";
import { stableHash } from "../normalizers/shared.js";

const SELLER_ORIGIN = "https://seller-us.tiktok.com";
const ORDER_ROUTE = `${SELLER_ORIGIN}/order`;
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
  private readonly browsers = new Map<string, Browser>();

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
      const responseResult = captureJsonResponse(page, ORDER_COUNT_PATH, this.responseTimeoutMs);
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
      const responseResult = captureJsonResponse(page, ORDER_LIST_PATH, this.responseTimeoutMs);
      await navigateToOrders(page, this.responseTimeoutMs);
      await assertHealthyPage(page);
      const captured = await responseResult;
      if (!captured.ok) throw captured.error;
      const response = OrderListResponseSchema.parse(captured.body);
      if (response.code !== 0) {
        throw new SellerCenterError("LAYOUT_CHANGED", `Order list returned source code ${response.code}`);
      }
      if (response.data.has_more === true || response.data.search_next_has_more === true) {
        throw new SellerCenterError(
          "LAYOUT_CHANGED",
          "Order pagination is present but its request mapping is unresolved; refusing a partial sync",
        );
      }
      const observedAt = new Date();
      return NormalizedOrderBatchSchema.parse({
        orders: response.data.main_orders.map((order) => normalizeOrder(order, request.shop.shopId, observedAt)),
        checkpoint: response.data.next_cursor_token ?? response.data.search_next_cursor ?? null,
        complete: !(response.data.has_more ?? response.data.search_next_has_more ?? false),
      });
    });
    yield batch;
  }

  async *collectFinancials(input: SyncRequest): AsyncIterable<NormalizedFinancialBatch> {
    const request = SyncRequestSchema.parse(input);
    const batch = await this.withPage(request.shop, async (page) => {
      const statResult = captureJsonResponse(page, STATEMENT_STAT_PATH, this.responseTimeoutMs);
      const listResult = captureJsonResponse(page, STATEMENT_LIST_PATH, this.responseTimeoutMs);
      await navigateToFinance(page, this.responseTimeoutMs);
      const statCaptured = await statResult;
      if (!statCaptured.ok) throw statCaptured.error;
      const listCaptured = await listResult;
      const statRaw = statCaptured.body;
      const listRaw = listCaptured.ok
        ? listCaptured.body
        : { code: 0, data: { search_next_has_more: true } };
      const stat = StatementStatResponseSchema.parse(statRaw);
      const list = StatementOrderListResponseSchema.parse(listRaw);
      if (stat.code !== 0 || list.code !== 0) {
        throw new SellerCenterError("LAYOUT_CHANGED", "Finance endpoints returned a non-zero source code");
      }
      if (!listCaptured.ok) {
        this.logger?.warn({
          shopId: request.shop.shopId,
          profileId: request.shop.profileId,
          operation: "collectFinancials",
          entity: "settlement",
          failureType: "SOURCE_TIMEOUT",
        }, "Finance snapshot collected without settlement rows");
      }
      const rawRows = list.data.order_records ?? list.data.order_list ?? list.data.orders ?? [];
      if (rawRows.length > 0) {
        this.logger?.warn({
          shopId: request.shop.shopId,
          profileId: request.shop.profileId,
          operation: "collectFinancials",
          entity: "settlement",
          failureType: "UNRESOLVED_MAPPING",
          rowCount: rawRows.length,
        }, "Settlement rows were found but their mapping is intentionally unresolved");
      }
      return NormalizedFinancialBatchSchema.parse({
        settlements: [],
        snapshot: normalizeFinancialSnapshot(stat, request.shop.shopId),
        checkpoint: null,
        complete: !(list.data.search_next_has_more ?? false),
      });
    });
    yield batch;
  }

  private async withPage<T>(shop: ShopSourceConfig, operation: (page: Page) => Promise<T>): Promise<T> {
    const connection = await this.adsPower.open(shop.profileId);
    let page: Page | undefined;
    try {
      const browser = await this.connectedBrowser(shop.profileId, connection.cdpEndpoint);
      const context = browser.contexts()[0];
      if (!context) throw new SellerCenterError("BROWSER_DISCONNECTED", "AdsPower browser has no context");
      page = await context.newPage();
      return await operation(page);
    } catch (error) {
      if (error instanceof SellerCenterError) throw error;
      throw new SellerCenterError("LAYOUT_CHANGED", "Seller Center operation failed", { cause: error });
    } finally {
      await page?.close().catch(() => undefined);
    }
  }

  private async connectedBrowser(profileId: string, cdpEndpoint: string): Promise<Browser> {
    const existing = this.browsers.get(profileId);
    if (existing?.isConnected()) return existing;
    this.browsers.delete(profileId);
    const browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: this.responseTimeoutMs });
    browser.once("disconnected", () => this.browsers.delete(profileId));
    this.browsers.set(profileId, browser);
    return browser;
  }
}

async function waitForJsonResponse(page: Page, path: string, timeoutMs: number): Promise<unknown> {
  let response: Response;
  try {
    response = await page.waitForResponse(
      (candidate) => new URL(candidate.url()).pathname === path && candidate.status() === 200,
      { timeout: timeoutMs },
    );
  } catch (error) {
    throw new SellerCenterError("SOURCE_TIMEOUT", `Timed out waiting for ${path}`, { cause: error });
  }
  return response.json();
}

async function captureJsonResponse(
  page: Page,
  path: string,
  timeoutMs: number,
): Promise<{ ok: true; body: unknown } | { ok: false; error: unknown }> {
  try {
    return { ok: true, body: await waitForJsonResponse(page, path, timeoutMs) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function navigateToOrders(page: Page, timeoutMs: number): Promise<void> {
  const url = new URL(ORDER_ROUTE);
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
  await navigateToOrders(page, timeoutMs);
  await assertHealthyPage(page);
  const financeMenu = page.getByText("Finances", { exact: true }).first();
  if (await financeMenu.count() > 0 && await financeMenu.isVisible()) {
    await financeMenu.click({ timeout: timeoutMs });
  }
  const visibleFinanceLink = page.locator('a[href^="/finance/bills"]:visible').first();
  if (await visibleFinanceLink.count() > 0) {
    await visibleFinanceLink.click({ timeout: timeoutMs });
  } else {
    const financeLink = page.locator('a[href^="/finance/bills"]').first();
    if (await financeLink.count() === 0) {
      throw new SellerCenterError("LAYOUT_CHANGED", "Finance Overview navigation link was not found");
    }
    const href = await financeLink.getAttribute("href");
    if (!href?.startsWith("/finance/bills")) {
      throw new SellerCenterError("LAYOUT_CHANGED", "Finance Overview navigation target changed");
    }
    await page.evaluate((target) => {
      const anchor = document.querySelector<HTMLAnchorElement>(`a[href^="${target}"]`);
      anchor?.click();
    }, href);
  }
  await page.waitForURL((url) => url.origin === SELLER_ORIGIN && url.pathname === "/finance/bills", {
    timeout: timeoutMs,
  });
  const financeUrl = new URL(page.url());
  financeUrl.searchParams.set("shop_health_probe", String(Date.now()));
  await page.goto(financeUrl.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await assertHealthyPage(page);
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
