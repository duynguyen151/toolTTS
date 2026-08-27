import {
  NormalizedFinancialBatchSchema,
  NormalizedOrderBatchSchema,
  ShopSourceConfigSchema,
  CredentialCapabilitySchema,
  SyncRequestSchema,
  type CredentialCapability,
  type NormalizedFinancialBatch,
  type NormalizedOrderBatch,
  type SellerDataSource,
  type SellerProfileIdentity,
  type ShopSourceConfig,
  type SourceFingerprint,
  type SourceHealth,
  type SyncRequest,
} from "@shop-health/domain";
import type { Logger } from "pino";
import { chromium, type Browser, type Page, type Response } from "playwright-core";

import {
  AdsPowerClient,
  type AdsPowerBrowserConnection,
  type AdsPowerClientOptions,
} from "../adspower/client.js";
import { SellerCenterError } from "../errors.js";
import {
  OrderCountResponseSchema,
  OrderListResponseSchema,
  StatementOrderListResponseSchema,
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
import { collectOrderPages, type OrderPageRequest } from "./order-pagination.js";
import {
  sellerIdentityFromFinanceRequestUrl,
} from "./profile-verification.js";

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
  endpointResponseTimeoutMs?: number;
  credentialReference?: string;
}

export function createSellerCenterDataSource(
  options: SellerCenterDataSourceOptions = {},
): SellerDataSource {
  return new SellerCenterBrowserDataSource(options);
}

async function connectBrowser(cdpEndpoint: string, timeoutMs: number): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(cdpEndpoint, { timeout: timeoutMs });
  } catch {
    throw new SellerCenterError(
      "BROWSER_DISCONNECTED",
      "AdsPower browser connection is unavailable",
    );
  }
}

export async function verifyAdsPowerBrowserConnection(
  connection: AdsPowerBrowserConnection,
  timeoutMs = 10_000,
): Promise<void> {
  const browser = await connectBrowser(connection.cdpEndpoint, timeoutMs);
  // Closing the Playwright transport does not stop the AdsPower profile.
  await browser.close().catch(() => undefined);
}

export class SellerCenterBrowserDataSource implements SellerDataSource {
  private readonly adsPower: AdsPowerClient;
  private readonly logger: Logger | undefined;
  private readonly responseTimeoutMs: number;
  private readonly endpointResponseTimeoutMs: number;
  private readonly credentialReference: string | undefined;

  constructor(options: SellerCenterDataSourceOptions = {}) {
    this.adsPower = options.adsPowerClient ?? new AdsPowerClient(options);
    this.logger = options.logger;
    this.responseTimeoutMs = options.responseTimeoutMs ?? 30_000;
    this.endpointResponseTimeoutMs = options.endpointResponseTimeoutMs ?? 90_000;
    this.credentialReference = options.credentialReference?.trim() || undefined;
  }

  async credentialCapability(): Promise<CredentialCapability> {
    const capability = this.credentialReference === undefined
      ? { status: "MISSING", mechanism: null, reference: null }
      : {
          status: "AVAILABLE",
          mechanism: "ADSPOWER_AUTOFILL",
          reference: this.credentialReference,
        };
    return CredentialCapabilitySchema.safeParse(capability).data
      ?? { status: "MISSING", mechanism: null, reference: null };
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

  /** Reads the active Seller Center identity without writing to Seller Center. */
  async verifyProfile(config: Pick<ShopSourceConfig, "profileId">): Promise<SellerProfileIdentity> {
    return this.withPage(config, async (page) => {
      const startedAt = Date.now();
      const capture = createFinanceResponseCapture(page);
      try {
        const financeDeadline = Date.now() + this.endpointResponseTimeoutMs;
        return await withTallFinanceViewport(page, async (): Promise<SellerProfileIdentity> => {
          await navigateToFinance(page, financeDeadline);
          const currentUrl = new URL(page.url());
          if (currentUrl.origin !== SELLER_ORIGIN) {
            return currentUrl.hostname.startsWith("seller-")
              ? { status: "UNSUPPORTED_REGION", tiktokShopId: null }
              : { status: "NOT_TIKTOK_SELLER", tiktokShopId: null };
          }
          const resolved = await resolveFinanceResponses(capture, page, [{
            path: STATEMENT_LIST_PATH,
            matches: isOnHoldFinancePageOne,
            stage: "Finance identity",
            validate: (body) => assertFinanceEnvelope(body, "Finance identity", StatementOrderListResponseSchema),
          }], this.endpointResponseTimeoutMs, financeDeadline);
          // The response body and canonical request URL are now detached from Playwright.
          capture.dispose();
          const response = parseApiResponse(StatementOrderListResponseSchema, resolved.captured[0]!.body, "Finance identity");
          if (response.code !== 0) throw new SellerCenterError("API_REJECTED", "Finance identity endpoint rejected the request");
          this.logger?.debug?.({
            operation: "finance-identity",
            durationMs: Date.now() - startedAt,
            triggerPath: resolved.triggerPath,
            sweepSteps: resolved.sweepSteps,
          }, "Finance identity finished");
          return sellerIdentityFromFinanceRequestUrl(resolved.captured[0]!.requestUrl);
        });
      } finally {
        capture.dispose();
      }
    });
  }

  async probe(config: ShopSourceConfig): Promise<SourceFingerprint> {
    const shop = ShopSourceConfigSchema.parse(config);
    return this.withPage(shop, async (page) => {
      const responseResult = captureJsonResponse(page, ORDER_COUNT_PATH, "POST", this.endpointResponseTimeoutMs);
      await navigateToOrders(page, this.endpointResponseTimeoutMs);
      await assertHealthyPage(page);
      const captured = await responseResult;
      if (!captured.ok) throw captured.error;
      const response = parseApiResponse(OrderCountResponseSchema, captured.body, "Order count");
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
        this.endpointResponseTimeoutMs,
        isActualOrderListResponse,
      );
      await navigateToOrders(page, this.endpointResponseTimeoutMs);
      await assertHealthyPage(page);
      const captured = await responseResult;
      if (!captured.ok) throw captured.error;
      const collected = await collectOrderPages({
        capturedRequest: {
          url: captured.requestUrl,
          body: captured.requestBody,
        },
        firstPage: captured.body,
        fetchPostPage: (req: OrderPageRequest) => fetchJsonInPage(page, req.url, req.body),
      });

      if (collected.completeness === "INCOMPLETE") {
        throw new SellerCenterError(
          "INCOMPLETE_RESPONSE",
          `Order collection incomplete: reason=${collected.diagnostics.stopReason}, collected=${collected.diagnostics.collectedUniqueCount}/${collected.diagnostics.expectedTotalCount ?? "unknown"}`,
        );
      }

      if (collected.diagnostics.reconciliation.status === "MISMATCH") {
        throw new SellerCenterError(
          "INCOMPLETE_RESPONSE",
          `Order total_count reconciliation mismatch: expected=${collected.diagnostics.expectedTotalCount}, collected=${collected.diagnostics.collectedUniqueCount}`,
        );
      }

      // Fail-closed: without total_count there is no count proof, so the batch must
      // never be marked COMPLETE ("never silently infer safe data").
      if (collected.diagnostics.reconciliation.status === "UNKNOWN") {
        throw new SellerCenterError("INCOMPLETE_RESPONSE", "Order total_count is missing; completeness is unproven");
      }

      const observedAt = new Date();
      return NormalizedOrderBatchSchema.parse({
        orders: collected.orders.map((order) => normalizeOrder(order, request.shop.shopId, observedAt)),
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
      const startedAt = Date.now();
      const capture = createFinanceResponseCapture(page);
      const financeDeadline = Date.now() + this.endpointResponseTimeoutMs;
      let resolved: ResolvedFinanceResponses;
      try {
        resolved = await withTallFinanceViewport(page, async (): Promise<ResolvedFinanceResponses> => {
          await navigateToFinance(page, financeDeadline);
          return resolveFinanceResponses(capture, page, [
            {
              path: STATEMENT_STAT_PATH,
              matches: isOnHoldStatResponse,
              stage: "Finance stat",
              validate: (body) => assertFinanceEnvelope(body, "Finance stat", StatementStatResponseSchema),
            },
            {
              path: STATEMENT_LIST_PATH,
              matches: isOnHoldFinancePageOne,
              stage: "Finance list",
              validate: (body) => assertFinanceEnvelope(body, "Finance list", StatementOrderListResponseSchema),
            },
          ], this.endpointResponseTimeoutMs, financeDeadline);
        });
      } finally {
        // Materialized bodies and the first-page URL are sufficient from here on.
        // Stop retaining later pagination responses before issuing page fetches.
        capture.dispose();
      }

      const statCaptured = resolved.captured[0]!;
      const listCaptured = resolved.captured[1]!;
      const stat = parseApiResponse(StatementStatResponseSchema, statCaptured.body, "Finance stat");
      if (stat.code !== 0) throw new SellerCenterError("API_REJECTED", `Finance stat returned source code ${stat.code}`);
      const collected = await collectFinanceStatementPages({
        capturedPageOneUrl: listCaptured.requestUrl,
        firstPage: listCaptured.body,
        fetchPage: (url) => fetchJsonInPage(page, url, undefined, financeDeadline),
        deadlineAt: financeDeadline,
      });
      // Fail-closed reconciliation: tainted rows are never persisted. When the official
      // stat parsed cleanly we retain its value flagged UNVERIFIED — downstream already
      // refuses authoritative use (frozen-context FINANCE_NOT_RECONCILED blocker; sync
      // FinanceCompletionProof requires the flag to be true, so the run stays incomplete).
      let reconciled = true;
      try {
        assertOnHoldReconciled(stat, collected.rows);
      } catch (error) {
        if (!(error instanceof SellerCenterError) || !["INCOMPLETE_RESPONSE", "LAYOUT_CHANGED"].includes(error.failureType)) throw error;
        reconciled = false;
      }
      const capturedAt = new Date();
      const snapshot = normalizeFinancialSnapshot(stat, request.shop.shopId, capturedAt);
      this.logger?.debug?.({
        operation: "finance-collect",
        durationMs: Date.now() - startedAt,
        triggerPath: resolved.triggerPath,
        sweepSteps: resolved.sweepSteps,
        pagesFetched: collected.pages,
        reconciled,
      }, "Finance collection finished");
      return NormalizedFinancialBatchSchema.parse({
        settlements: reconciled ? collected.rows.map((row) => normalizeSettlementRecord(row, request.shop.shopId)) : [],
        snapshot: snapshot === null ? null : { ...snapshot, reasonTotalsReconcileToOfficialOnHold: reconciled },
        checkpoint: null,
        complete: true,
      });
    });
    yield batch;
  }

  private async withPage<T>(shop: Pick<ShopSourceConfig, "profileId">, operation: (page: Page) => Promise<T>): Promise<T> {
    let browser: Browser | undefined;
    let page: Page | undefined;
    try {
      const connection = await this.adsPower.openReady(shop.profileId);
      browser = await connectBrowser(connection.cdpEndpoint, this.responseTimeoutMs);
      const context = browser.contexts()[0];
      if (!context) throw new SellerCenterError("BROWSER_DISCONNECTED", "AdsPower browser has no context");
      try {
        page = await context.newPage();
      } catch {
        throw new SellerCenterError("BROWSER_DISCONNECTED", "AdsPower browser page is unavailable");
      }
      return await operation(page);
    } catch (error) {
      if (error instanceof SellerCenterError) throw error;
      if (isProxyTimeout(error)) {
        throw new SellerCenterError(
          "PROXY_TIMEOUT",
          "AdsPower profile proxy did not respond before the deadline",
          { cause: error },
        );
      }
      if (isBrowserDisconnection(error)) {
        throw new SellerCenterError(
          "BROWSER_DISCONNECTED",
          "AdsPower browser connection is unavailable",
          { cause: error },
        );
      }
      if (isSourceTimeout(error)) {
        throw new SellerCenterError(
          "SOURCE_TIMEOUT",
          "Seller Center request timed out",
          { cause: error },
        );
      }
      throw new SellerCenterError("ROUTE_CHANGED", "Seller Center operation failed", { cause: error });
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
  | { ok: true; body: unknown; requestUrl: string; requestBody: unknown }
  | { ok: false; error: unknown }
> {
  try {
    const response = await waitForResponse(page, path, method, timeoutMs, matchesResponse);
    let requestBody: unknown = undefined;
    try {
      requestBody = response.request().postDataJSON();
    } catch {
      requestBody = undefined;
    }
    return {
      ok: true,
      body: await response.json(),
      requestUrl: response.request().url(),
      requestBody,
    };
  } catch (error) {
    return { ok: false, error };
  }
}

interface CapturedFinanceResponse {
  body: unknown;
  requestUrl: string;
}

interface FinanceResponseSpec {
  path: string;
  matches(response: Response): boolean;
  stage: string;
  /** Envelope + schema proof required before the sweep may exit early. */
  validate(body: unknown): void;
}

interface FinanceResponseCapture {
  find(spec: FinanceResponseSpec): Promise<CapturedFinanceResponse | undefined>;
  observed(spec: FinanceResponseSpec): boolean;
  waitUntil(specs: readonly FinanceResponseSpec[], timeoutMs: number): Promise<boolean>;
  dispose(): void;
}

interface FinanceResponseWaiter {
  check(): void;
  cancel(): void;
}

function createFinanceResponseCapture(page: Page): FinanceResponseCapture {
  const responses: Response[] = [];
  const waiters = new Set<FinanceResponseWaiter>();
  let disposed = false;
  const listener = (response: Response): void => {
    if (disposed || !isFinanceResponse(response)) return;
    responses.push(response);
    for (const waiter of [...waiters]) waiter.check();
  };
  page.on("response", listener);

  const findResponse = (spec: FinanceResponseSpec): Response | undefined =>
    responses.find((candidate) =>
      new URL(candidate.url()).pathname === spec.path && spec.matches(candidate),
    );

  return {
    async find(spec) {
      const response = findResponse(spec);
      if (response === undefined) return undefined;
      return { body: await response.json(), requestUrl: response.request().url() };
    },
    observed(spec) {
      return findResponse(spec) !== undefined;
    },
    waitUntil(specs, timeoutMs) {
      if (disposed) return Promise.resolve(false);
      if (specs.every((spec) => findResponse(spec) !== undefined)) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const finish = (observed: boolean): void => {
          if (settled) return;
          settled = true;
          if (timeout !== undefined) clearTimeout(timeout);
          waiters.delete(waiter);
          resolve(observed);
        };
        const waiter: FinanceResponseWaiter = {
          check: () => {
            if (specs.every((spec) => findResponse(spec) !== undefined)) finish(true);
          },
          cancel: () => finish(false),
        };
        timeout = setTimeout(() => finish(false), Math.max(0, timeoutMs));
        waiters.add(waiter);
        waiter.check();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      page.off("response", listener);
      for (const waiter of [...waiters]) waiter.cancel();
      waiters.clear();
      responses.length = 0;
    },
  };
}

/** @internal Test seam for proving capture disposal settles active waits. */
export function createPendingFinanceWaitForTest(
  page: Page,
  timeoutMs: number,
): { pending: Promise<boolean>; dispose(): void } {
  const capture = createFinanceResponseCapture(page);
  return {
    pending: capture.waitUntil([{
      path: STATEMENT_LIST_PATH,
      matches: isOnHoldFinancePageOne,
      stage: "Finance list",
      validate: (body) => assertFinanceEnvelope(body, "Finance list", StatementOrderListResponseSchema),
    }], timeoutMs),
    dispose: () => capture.dispose(),
  };
}

interface ResolvedFinanceResponses {
  readonly captured: CapturedFinanceResponse[];
  readonly triggerPath: "NATURAL" | "SWEEP_EARLY_EXIT" | "SWEEP_FULL";
  readonly sweepSteps: number;
}

/**
 * Reads each spec's captured body and proves envelope plus schema validity.
 * Returns null when any endpoint has not been observed yet; throws the typed
 * validation error (API_REJECTED / API_SCHEMA_CHANGED / SOURCE_TIMEOUT) when an
 * observed response fails proof, so callers never sweep past bad data.
 */
async function tryMaterializeValidatedFinanceResponses(
  capture: FinanceResponseCapture,
  page: Page,
  specs: readonly FinanceResponseSpec[],
  deadline: number,
): Promise<CapturedFinanceResponse[] | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;
  let found: Array<CapturedFinanceResponse | undefined>;
  try {
    found = await withDeadline(
      Promise.all(specs.map((spec) => capture.find(spec))),
      remaining,
      "Finance response body exceeded the endpoint response deadline",
    );
  } catch (error) {
    // Deadline breaches keep their SOURCE_TIMEOUT typing; any other body-read
    // failure is incomplete data, never a layout change.
    if (error instanceof SellerCenterError) throw error;
    throw new SellerCenterError("INCOMPLETE_RESPONSE", "Finance response body could not be materialized", { cause: error });
  }
  const captured: CapturedFinanceResponse[] = [];
  for (const [index, response] of found.entries()) {
    if (response === undefined) return null;
    specs[index]!.validate(response.body);
    captured.push(response);
  }
  return captured;
}

async function resolveFinanceResponses(
  capture: FinanceResponseCapture,
  page: Page,
  specs: readonly FinanceResponseSpec[],
  timeoutMs: number,
  absoluteDeadline = Date.now() + timeoutMs,
): Promise<ResolvedFinanceResponses> {
  const deadline = Math.min(absoluteDeadline, Date.now() + timeoutMs);
  const remainingBeforeNatural = deadline - Date.now();
  if (remainingBeforeNatural <= 0) {
    throw new SellerCenterError(
      "SOURCE_TIMEOUT",
      "Finance collection exceeded the endpoint response deadline before any Finance endpoint could be observed",
    );
  }
  const naturalBudgetMs = Math.min(
    1_000,
    Math.max(1, Math.floor(timeoutMs / 4)),
    remainingBeforeNatural,
  );
  const naturallyObserved = await capture.waitUntil(specs, naturalBudgetMs);
  if (naturallyObserved) {
    const captured = await tryMaterializeValidatedFinanceResponses(capture, page, specs, deadline);
    if (captured !== null) return { captured, triggerPath: "NATURAL", sweepSteps: 0 };
  }
  let sweepSteps = 0;
  const remainingBeforeSweep = deadline - Date.now();
  if (remainingBeforeSweep > 0) {
    const sweep = await sweepFinanceViewportUntilValidated(page, capture, specs, deadline);
    sweepSteps = sweep.steps;
    if (sweep.validated !== null) {
      return { captured: sweep.validated, triggerPath: "SWEEP_EARLY_EXIT", sweepSteps };
    }
  }
  await capture.waitUntil(specs, Math.max(0, deadline - Date.now()));
  const captured = await tryMaterializeValidatedFinanceResponses(capture, page, specs, deadline);
  if (captured !== null) return { captured, triggerPath: "SWEEP_FULL", sweepSteps };
  return missingFinanceResponses(specs, capture);
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (timeoutMs <= 0) throw new SellerCenterError("SOURCE_TIMEOUT", message);
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

function missingFinanceResponses(
  specs: readonly FinanceResponseSpec[],
  capture?: FinanceResponseCapture,
): never {
  const missing = specs.find((spec) => capture?.observed(spec) !== true)?.stage ?? "Finance";
  throw new SellerCenterError("ENDPOINT_NOT_OBSERVED", missing + " endpoint response was not observed before the deadline");
}

const FINANCE_SWEEP_MAX_STEPS = 100;

/** Scrolls one overlapping viewport-height step inside the page and reports the grown scroll bounds. */
function financeScrollStep(argument: { top: number }): Promise<{ maxScroll: number; nextTop: number }> {
  return new Promise((resolve) => {
    const viewportHeight = Math.max(1, window.innerHeight);
    window.scrollTo({ top: Math.max(0, argument.top), behavior: "auto" });
    requestAnimationFrame(() => {
      const maxScroll = Math.max(
        0,
        Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) - viewportHeight,
      );
      const overlap = Math.max(1, Math.floor(viewportHeight * 0.2));
      const nextTop = argument.top + Math.max(1, viewportHeight - overlap);
      resolve({ maxScroll, nextTop });
    });
  });
}

function financeScrollRestore(): void {
  window.scrollTo({ top: 0, behavior: "auto" });
}

/**
 * Walks the Finance page in bounded overlapping steps and exits early only once
 * every spec is PROVEN valid (canonical endpoint + request filter + envelope code
 * + schema). Never scrolls without bound: hard step cap, one final-bottom visit,
 * absolute deadline, and an always-applied scroll restore.
 */
async function sweepFinanceViewportUntilValidated(
  page: Page,
  capture: FinanceResponseCapture,
  specs: readonly FinanceResponseSpec[],
  deadline: number,
): Promise<{ validated: CapturedFinanceResponse[] | null; steps: number }> {
  let top = 0;
  let maxScroll = Number.POSITIVE_INFINITY;
  let steps = 0;
  let bottomVisited = false;
  try {
    while (Date.now() < deadline) {
      // Exactly ONE final checkpoint past the step cap: the capped walk may not
      // cover an extremely tall or newly-grown document, so its CURRENT bottom is
      // always visited once before giving up.
      const capReached = steps >= FINANCE_SWEEP_MAX_STEPS;
      if (bottomVisited) break;
      const finalVisit = capReached || top >= maxScroll;
      // The capped walk may not cover an extremely tall or newly-grown document:
      // the final checkpoint always visits the CURRENT document bottom itself.
      // A hidden/backgrounded page pauses requestAnimationFrame, so evaluate() may
      // never settle on its own: the shared deadline must bound every scroll call.
      const result = await withDeadline(
        page.evaluate(financeScrollStep, { top: finalVisit ? maxScroll : top }),
        Math.max(0, deadline - Date.now()),
        "Finance viewport scroll step exceeded the endpoint response deadline",
      );
      steps += 1;
      if (finalVisit) {
        bottomVisited = true;
      } else {
        maxScroll = result.maxScroll;
        top = result.nextTop;
      }
      const validated = await tryMaterializeValidatedFinanceResponses(capture, page, specs, deadline);
      if (validated !== null) return { validated, steps };
      if (finalVisit) break;
    }
  } finally {
    await withDeadline(
      page.evaluate(financeScrollRestore),
      Math.max(0, deadline - Date.now()),
      "Finance viewport restore exceeded the endpoint response deadline",
    ).catch(() => undefined);
  }
  return { validated: null, steps };
}

type FinanceBodySchema = { safeParse(input: unknown): { success: boolean } };

/** Envelope-first validity proof reused by strict sweep exit and final parsing. */
function assertFinanceEnvelope(body: unknown, label: string, schema: FinanceBodySchema): void {
  rejectSourceError(body, label);
  if (!schema.safeParse(body).success) {
    throw new SellerCenterError("API_SCHEMA_CHANGED", `${label} response schema changed`);
  }
}

/**
 * Fast path only: a taller viewport lets below-the-fold lazy sections mount without
 * scrolling. Width is preserved so responsive breakpoints stay untouched, the size is
 * derived from the current viewport (no Seller Center layout constants), and correctness
 * never depends on it — the controlled sweep remains the fallback when data is missing.
 */
async function withTallFinanceViewport<T>(page: Page, operation: () => Promise<T>): Promise<T> {
  const previous = typeof page.viewportSize === "function" ? page.viewportSize() : null;
  // Mutate only when the original size is KNOWN and settable: an unrestorable
  // mutation would leak the tall viewport into later collections on this page.
  if (previous === null || typeof page.setViewportSize !== "function") return operation();
  try {
    await page.setViewportSize({ width: previous.width, height: Math.min(previous.height * 3, 4000) }).catch(() => undefined);
    return await operation();
  } finally {
    await page.setViewportSize(previous).catch(() => undefined);
  }
}

function isFinanceResponse(response: Response): boolean {
  const url = new URL(response.url());
  return url.origin === SELLER_ORIGIN
    && response.request().method() === "GET"
    && response.status() === 200
    && (url.pathname === STATEMENT_STAT_PATH || url.pathname === STATEMENT_LIST_PATH);
}

async function navigateToOrders(page: Page, timeoutMs: number): Promise<void> {
  const url = new URL(ORDER_ROUTE);
  url.searchParams.set("selected_sort", "6");
  url.searchParams.set("tab", "all");
  url.searchParams.set("shop_health_probe", String(Date.now()));
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
}

async function assertHealthyPage(page: Page, timeoutMs = 5_000): Promise<void> {
  const state = await detectAccessState(page, timeoutMs);
  if (state === "LOGIN_REQUIRED") throw new SellerCenterError("LOGIN_REQUIRED", "Seller Center login is required");
  if (state === "CHALLENGE_REQUIRED") throw new SellerCenterError("CHALLENGE_REQUIRED", "Seller Center security challenge requires manual action");
  if (state !== "HEALTHY") throw new SellerCenterError("ROUTE_CHANGED", `Unexpected Seller Center state at ${page.url()}`);
}

function remainingDeadlineMs(deadline: number, stage: string): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new SellerCenterError("SOURCE_TIMEOUT", stage + " exceeded the endpoint response deadline");
  }
  return remaining;
}

async function navigateToFinance(page: Page, deadline: number): Promise<void> {
  await page.goto(FINANCE_ON_HOLD_ROUTE, {
    waitUntil: "domcontentloaded",
    timeout: remainingDeadlineMs(deadline, "Finance navigation"),
  });
  await assertHealthyPage(page, remainingDeadlineMs(deadline, "Finance access verification"));
}

function rejectSourceError(body: unknown, label: string): void {
  if (typeof body !== "object" || body === null || !("code" in body)) return;
  const code = (body as { code?: unknown }).code;
  if (typeof code === "number" && code !== 0) {
    throw new SellerCenterError("API_REJECTED", label + " returned source code " + code);
  }
}

function parseApiResponse<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  body: unknown,
  label: string,
): T {
  rejectSourceError(body, label);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new SellerCenterError("API_SCHEMA_CHANGED", `${label} response schema changed`);
  return parsed.data;
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
    throw new SellerCenterError("ENDPOINT_NOT_OBSERVED", `Endpoint response was not observed for ${path}`, { cause: error });
  }
}

function hasSingleQueryValue(url: URL, key: string, expected: string): boolean {
  const values = url.searchParams.getAll(key);
  return values.length === 1 && values[0] === expected;
}

function isOnHoldFinancePageOne(response: Response): boolean {
  const requestUrl = new URL(response.request().url());
  return requestUrl.origin === SELLER_ORIGIN
    && hasSingleQueryValue(requestUrl, "settlement_status", "1")
    && hasSingleQueryValue(requestUrl, "from", "0");
}

function isOnHoldStatResponse(response: Response): boolean {
  const requestUrl = new URL(response.request().url());
  return requestUrl.origin === SELLER_ORIGIN
    && hasSingleQueryValue(requestUrl, "amount_stat_type", "1");
}

function isActualOrderListResponse(response: Response): boolean {
  const request = response.request();
  const url = new URL(request.url());
  if (url.searchParams.has("is_prefetch")) return false;
  try {
    const postData = request.postDataJSON();
    if (postData === null || postData === undefined) return true;
    if (typeof postData === "object" && Object.keys(postData).length === 0) return true;
    return false;
  } catch {
    return false;
  }
}

async function fetchJsonInPage(
  page: Page,
  requestUrl: string,
  postBody?: unknown,
  deadlineAt?: number,
): Promise<unknown> {
  return page.evaluate(async (arg: string | { url: string; body?: unknown; deadlineAt?: number }) => {
    const url = typeof arg === "string" ? arg : arg.url;
    const body = typeof arg === "string" ? undefined : arg.body;
    const deadlineAt = typeof arg === "string" ? undefined : arg.deadlineAt;
    const isPost = body !== undefined && body !== null;
    // Real browser-side cancellation: the losing side of a timeout race stops
    // fetching instead of running on after the caller has already failed.
    const controller = new AbortController();
    const abortTimer = deadlineAt === undefined
      ? undefined
      : setTimeout(() => controller.abort(), Math.max(0, deadlineAt - Date.now()));
    try {
      const init: RequestInit = {
        credentials: "include",
        method: isPost ? "POST" : "GET",
        signal: controller.signal,
        ...(isPost ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      };
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`In-page fetch failed with HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Finance in-page fetch was aborted at the collection deadline");
      }
      throw error;
    } finally {
      if (abortTimer !== undefined) clearTimeout(abortTimer);
    }
  }, postBody !== undefined || deadlineAt !== undefined
    ? { ...(postBody !== undefined ? { body: postBody } : {}), ...(deadlineAt !== undefined ? { deadlineAt } : {}), url: requestUrl }
    : requestUrl);
}

async function detectAccessState(page: Page, timeoutMs = 5_000): Promise<SourceHealth["status"]> {
  const url = page.url().toLowerCase();
  if (/captcha|challenge|verification|verify/.test(url)) return "CHALLENGE_REQUIRED";
  if (/login|signin|passport/.test(url)) return "LOGIN_REQUIRED";
  const body = (await page.locator("body").innerText({ timeout: Math.min(5_000, Math.max(1, timeoutMs)) }).catch(() => "")).slice(0, 20_000).toLowerCase();
  if (/captcha|security verification|verify (?:that )?you are human|unusual activity/.test(body)) return "CHALLENGE_REQUIRED";
  if (/log in|sign in/.test(body) && /password|email|phone/.test(body)) return "LOGIN_REQUIRED";
  return url.startsWith(SELLER_ORIGIN) ? "HEALTHY" : "LAYOUT_CHANGED";
}

function classifyFailure(error: unknown): { status: SourceHealth["status"]; detail: string } {
  if (error instanceof SellerCenterError) {
    const statuses: Partial<Record<SellerCenterError["failureType"], SourceHealth["status"]>> = {
      ADSPOWER_UNAVAILABLE: "UNAVAILABLE",
      PROFILE_START_FAILED: "UNAVAILABLE",
      BROWSER_DISCONNECTED: "UNAVAILABLE",
      PROXY_TIMEOUT: "PROXY_TIMEOUT",
      LOGIN_REQUIRED: "LOGIN_REQUIRED",
      CHALLENGE_REQUIRED: "CHALLENGE_REQUIRED",
      LAYOUT_CHANGED: "LAYOUT_CHANGED",
      ROUTE_CHANGED: "LAYOUT_CHANGED",
      ENDPOINT_NOT_OBSERVED: "LAYOUT_CHANGED",
      API_SCHEMA_CHANGED: "LAYOUT_CHANGED",
      API_REJECTED: "LAYOUT_CHANGED",
      INCOMPLETE_RESPONSE: "LAYOUT_CHANGED",
      SOURCE_TIMEOUT: "UNAVAILABLE",
    };
    return { status: statuses[error.failureType] ?? "UNAVAILABLE", detail: error.message };
  }
  return { status: "UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown source failure" };
}

function isProxyTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|PROXY_CONNECTION_TIMED_OUT|proxy\b.*\btimed out/i.test(error.message);
}

function isBrowserDisconnection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /browser has been closed|Target page, context or browser has been closed|Connection closed|CDP connection closed|ECONNRESET|ECONNREFUSED/i.test(error.message);
}

function isSourceTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /Timeout \d+ms exceeded|Navigation timeout of \d+ms exceeded|page\.goto: Timeout/i.test(error.message);
}
