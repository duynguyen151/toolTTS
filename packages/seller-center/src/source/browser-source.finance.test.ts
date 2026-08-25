import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncRequest } from "@shop-health/domain";

import { SellerCenterError } from "../errors.js";
import * as financeReconciliation from "./finance-reconciliation.js";

const { connectOverCDP } = vi.hoisted(() => ({
  connectOverCDP: vi.fn(),
}));

vi.mock("playwright-core", async (importOriginal) => {
  const original = await importOriginal<typeof import("playwright-core")>();
  return {
    ...original,
    chromium: { ...original.chromium, connectOverCDP },
  };
});

import {
  createPendingFinanceWaitForTest,
  SellerCenterBrowserDataSource,
} from "./browser-source.js";

const financeRoute = "https://seller-us.tiktok.com/finance/bills?tab=overview&subTab=on-hold";
const NEVER_RESOLVING_BODY = Symbol("never-resolving-body");
const REJECTING_BODY = Symbol("rejecting-body");
const irrelevantOverviewUrl = [
  "https://seller-us.tiktok.com/api/v1/pay/statement/order/list",
  "?locale=en-US&language=en&oec_seller_id=seller-private&seller_id=seller-private",
  "&pagination_type=1&from=0&size=5&terminal_type=1&page_type=10",
  "&need_total_amount=false&no_need_sku_record=false&statement_version=1",
].join("");
const pageOneUrl = [
  "https://seller-us.tiktok.com/api/v1/pay/statement/order/list",
  "?locale=en-US&language=en&oec_seller_id=seller-private&seller_id=seller-private",
  "&pagination_type=1&from=0&size=5&terminal_type=1&page_type=10",
  "&settlement_status=1&no_need_sku_record=false",
  "&statement_version=1&token=secret-token&sign=secret-sign",
].join("");
it("settles a pending Finance wait immediately when capture is disposed", async () => {
  const page = new FakeFinancePage({ listCapture: "absent" });
  const pendingCapture = createPendingFinanceWaitForTest(page as never, 60_000);

  pendingCapture.dispose();

  await expect(pendingCapture.pending).resolves.toBe(false);
  expect(page.responseListenerCount).toBe(0);
});

describe("SellerCenterBrowserDataSource.collectFinancials", () => {
  beforeEach(() => connectOverCDP.mockReset());

  it("collects the direct On hold route into one complete 8-row batch", async () => {
    const page = new FakeFinancePage();
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    connectOverCDP.mockResolvedValue({
      contexts: () => [{ newPage: async () => page }],
      isConnected: () => true,
      once: vi.fn(),
      close: closeBrowser,
    });
    const source = new SellerCenterBrowserDataSource({
      adsPowerClient: {
        openReady: vi.fn().mockResolvedValue({
          profileId: "profile-1",
          status: "Active",
          cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
        }),
      } as never,
    });

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(page.goto).toHaveBeenNthCalledWith(1, financeRoute, {
      waitUntil: "domcontentloaded",
      // Navigation consumes from the shared absolute deadline, so its timeout must
      // be the remaining budget rather than an independently reset full timeout.
      timeout: expect.any(Number),
    });
    const navigationTimeout = (page.goto.mock.calls[0] as unknown as [string, { timeout: number }])[1].timeout;
    expect(navigationTimeout).toBeLessThanOrEqual(90_000);
    expect(navigationTimeout).toBeGreaterThan(89_000);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.sweepCount).toBe(0);
    expect(page.fetchUrls).toHaveLength(1);
    const pageTwoUrl = new URL(page.fetchUrls[0] ?? "");
    expect(pageTwoUrl.searchParams.get("from")).toBe("5");
    expect(pageTwoUrl.searchParams.get("token")).toBeNull();
    expect(pageTwoUrl.searchParams.get("sign")).toBeNull();
    expect(batches).toHaveLength(1);
    expect(page.onHoldTabClicks).toBe(0);
    expect(batches[0]).toMatchObject({
      complete: true,
      checkpoint: null,
      snapshot: {
        onHoldBalance: "310.16",
        currency: "USD",
        reasonTotalsReconcileToOfficialOnHold: true,
      },
    });
    expect(batches[0]?.settlements).toHaveLength(8);
    expect(new Set(batches[0]?.settlements.map((row) => row.sourceStatementDetailId)).size).toBe(8);
    const byReason = new Map<string | null, NonNullable<typeof batches[0]>["settlements"]>();
    for (const row of batches[0]?.settlements ?? []) {
      const group = byReason.get(row.onHoldReason) ?? [];
      group.push(row);
      byReason.set(row.onHoldReason, group);
    }
    expect(byReason.get("WAITING_FOR_PACKAGE_DELIVERY")).toHaveLength(5);
    expect(sumExpected(byReason.get("WAITING_FOR_PACKAGE_DELIVERY") ?? [])).toBe("177.33");
    expect(byReason.get("DELIVERED_AWAITING_SETTLEMENT")).toHaveLength(3);
    expect(sumExpected(byReason.get("DELIVERED_AWAITING_SETTLEMENT") ?? [])).toBe("132.83");
    expect(JSON.stringify(batches[0])).not.toContain("seller-private");
    expect(JSON.stringify(batches[0])).not.toContain("secret-token");
    expect(JSON.stringify(batches[0])).not.toContain("Alice Private");
    expect(page.close).toHaveBeenCalledOnce();
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it("accepts exact decimal reconciliation without binary floating-point drift", async () => {
    const page = new FakeFinancePage({
      statBody: statResponse({
        totalAmount: "0.30",
        reasons: [{ reason: 1, amount: "0.30" }],
      }),
      firstPageBody: pageResponseRows([
        statementRow(0, "0.10"),
        statementRow(1, "0.20"),
      ], 2, false),
    });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]).toMatchObject({ complete: true });
    expect(batches[0]?.settlements).toHaveLength(2);
  });

  it("accepts a signed settlement amount from the live Finance response", async () => {
    const page = new FakeFinancePage({
      statBody: statResponse({
        totalAmount: "0.00",
        reasons: [{ reason: 1, amount: "0.00" }],
      }),
      firstPageBody: pageResponseRows([
        statementRow(0, "-0.41"),
        statementRow(1, "0.41"),
        statementRow(2, "0.00"),
        statementRow(3, "0.00"),
        statementRow(4, "0.00"),
        statementRow(5, "0.00"),
        statementRow(6, "0.00"),
        statementRow(7, "0.00"),
      ], 8, false),
    });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]).toMatchObject({
      complete: true,
      snapshot: {
        officialOnHoldAmount: "0.00",
        reasonTotalsReconcileToOfficialOnHold: true,
      },
    });
    expect(batches[0]?.settlements).toHaveLength(8);
    expect(batches[0]?.settlements[0]?.expectedSettlementAmount).toBe("-0.41");
  });

  it("normalizes reason code 2 from the live Finance statement response", async () => {
    const page = new FakeFinancePage({
      statBody: statResponse({
        totalAmount: "0.30",
        reasons: [{ reason: 2, amount: "0.30" }],
      }),
      firstPageBody: pageResponseRows([
        statementRow(0, "0.30", 2),
      ], 1, false),
    });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]).toMatchObject({ complete: true });
    expect(batches[0]?.settlements[0]?.onHoldReason).toBe(
      "WAITING_FOR_COMPLETED_REFUND_RETURN",
    );
  });

  it("fails closed when collected On hold rows do not reconcile to the official breakdown", async () => {
    const page = new FakeFinancePage({
      nextPageBody: pageResponseRows([
        statementRow(5),
        statementRow(6),
        statementRow(7, "44.82"),
      ], 8, false),
    });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    // Fail-closed for rows; retained official total is flagged UNVERIFIED, never
    // silently marked COMPLETE-with-authoritative-data downstream.
    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]?.settlements).toHaveLength(0);
    expect(batches[0]?.snapshot?.reasonTotalsReconcileToOfficialOnHold).toBe(false);
    expect(batches[0]?.complete).toBe(true);
  });

  it("retains an unverified official snapshot for the legacy reconciliation classification", async () => {
    vi.spyOn(financeReconciliation, "assertOnHoldReconciled").mockImplementationOnce(() => {
      throw new SellerCenterError("LAYOUT_CHANGED", "legacy reconciliation classification");
    });
    const page = new FakeFinancePage();
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]?.settlements).toHaveLength(0);
    expect(batches[0]?.snapshot?.reasonTotalsReconcileToOfficialOnHold).toBe(false);
    expect(batches[0]?.complete).toBe(true);
  });

  it("fails closed when official and collected On hold currencies differ", async () => {
    const page = new FakeFinancePage({
      statBody: statResponse({ currency: "EUR" }),
    });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]?.settlements).toHaveLength(0);
    expect(batches[0]?.snapshot?.reasonTotalsReconcileToOfficialOnHold).toBe(false);
    expect(batches[0]?.complete).toBe(true);
  });

  it("waits for an asynchronously natural On hold list without sweeping", async () => {
    const page = new FakeFinancePage({ listCapture: "async-natural" });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(page.sweepCount).toBe(0);
    expect(batches[0]?.settlements).toHaveLength(8);
  });

  it("uses one bounded viewport sweep when stat and list arrive asynchronously afterward", async () => {
    const page = new FakeFinancePage({ statCapture: "sweep", listCapture: "sweep" });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(page.sweepCount).toBeGreaterThan(0);
    expect(page.onHoldTabClicks).toBe(0);
    expect(batches[0]?.settlements).toHaveLength(8);
  });

  it("reaches an On hold component displaced between fixed percentage checkpoints", async () => {
    const page = new FakeFinancePage({ listCapture: "displaced", displacedOffset: 1_300 });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(page.scrollTops).toContain(640);
    expect(page.scrollTops.some((top) => top <= 1_300 && 1_300 < top + 800)).toBe(true);
    expect(page.sweepCount).toBeGreaterThan(0);
    expect(page.onHoldTabClicks).toBe(0);
    expect(batches[0]?.settlements).toHaveLength(8);
  });

  it("visits the final bottom checkpoint when the 100-step walk cannot reach it", async () => {
    const targetOffset = 70_000;
    const page = new FakeFinancePage({ listCapture: "displaced", displacedOffset: targetOffset });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(page.scrollTops).toContain(targetOffset);
    expect(page.onHoldTabClicks).toBe(0);
    expect(batches[0]?.settlements).toHaveLength(8);
  });

  it("bounds a Finance response body that never resolves", async () => {
    const page = new FakeFinancePage({ listBodyNeverResolves: true });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    await expect(async () => {
      for await (const _batch of source.collectFinancials(syncRequest())) {
        // No batch may be yielded after the collection deadline.
      }
    }).rejects.toMatchObject({ failureType: "SOURCE_TIMEOUT" });
    expect(page.onHoldTabClicks).toBe(0);
  });

  it("disposes the Finance response listener before pagination fetches", async () => {
    const page = new FakeFinancePage({ requireListenerDisposedBeforeFetch: true });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(page.responseListenerCount).toBe(0);
    expect(page.responsesEmittedWithoutListener).toBeGreaterThan(0);
    expect(batches[0]?.settlements).toHaveLength(8);
  });

  it("bounds a paginated in-page fetch that never resolves", async () => {
    const page = new FakeFinancePage({ pageFetchNeverResolves: true });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    await expect(async () => {
      for await (const _batch of source.collectFinancials(syncRequest())) {
        // No batch may be yielded after the collection deadline.
      }
    }).rejects.toMatchObject({ failureType: "SOURCE_TIMEOUT" });
    expect(page.onHoldTabClicks).toBe(0);
  });

  it.each([
    ["foreign origin", "https://attacker.invalid/api/v1/pay/statement/order/list?settlement_status=1&from=0"],
    ["duplicate discriminator", pageOneUrl + "&settlement_status=1"],
  ])("rejects a %s Finance list candidate", async (_label, listUrl) => {
    const page = new FakeFinancePage({ listUrl });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    await expect(async () => {
      for await (const _batch of source.collectFinancials(syncRequest())) {
        // An untrusted candidate must not yield data.
      }
    }).rejects.toMatchObject({ failureType: "ENDPOINT_NOT_OBSERVED" });
  });

  it("classifies a malformed nonzero stat envelope as API_REJECTED", async () => {
    const page = new FakeFinancePage({ statBody: { code: 9 } });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    await expect(async () => {
      for await (const _batch of source.collectFinancials(syncRequest())) {
        // A source rejection must not be mistaken for a schema change.
      }
    }).rejects.toMatchObject({ failureType: "API_REJECTED" });
  });

  it("removes its response listener after a capture timeout", async () => {
    const page = new FakeFinancePage({ listCapture: "absent" });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    await expect(async () => {
      for await (const _batch of source.collectFinancials(syncRequest())) {
        // The timed-out capture must settle and clean itself up.
      }
    }).rejects.toMatchObject({ failureType: "ENDPOINT_NOT_OBSERVED" });

    expect(page.responseListenerCount).toBe(0);
  });

  it("fails with a list-stage error when the On hold list remains absent", async () => {
    const page = new FakeFinancePage({ listCapture: "absent" });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    await expect(async () => {
      for await (const _batch of source.collectFinancials(syncRequest())) {
        // The collector must reject before yielding an incomplete batch.
      }
    }).rejects.toMatchObject({
      failureType: "ENDPOINT_NOT_OBSERVED",
      message: expect.stringMatching(/Finance list/i),
    });
    expect(page.sweepCount).toBeGreaterThan(0);
    expect(page.onHoldTabClicks).toBe(0);
  });

  it("fails fast with SOURCE_TIMEOUT when navigation consumes the collection budget", async () => {
    const page = new FakeFinancePage({ gotoBlocksMs: 250 });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);
    const startedAt = Date.now();

    await expect(async () => {
      for await (const _batch of source.collectFinancials(syncRequest())) {
        // No batch may be yielded after the collection deadline.
      }
    }).rejects.toMatchObject({ failureType: "SOURCE_TIMEOUT" });

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(page.scrollTops).toHaveLength(0);
    expect(page.fetchUrls).toHaveLength(0);
  });

  it("fails fast with SOURCE_TIMEOUT when access inspection consumes the collection budget", async () => {
    const page = new FakeFinancePage({ accessInspectionDelayMs: 300 });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);
    const startedAt = Date.now();

    await expect(async () => {
      for await (const _batch of source.collectFinancials(syncRequest())) {
        // No batch may be yielded after the collection deadline.
      }
    }).rejects.toMatchObject({ failureType: "SOURCE_TIMEOUT" });

    expect(Date.now() - startedAt).toBeLessThan(600);
    expect(page.scrollTops).toHaveLength(0);
  });

  it("exits the sweep early once stat and list are proven valid", async () => {
    const page = new FakeFinancePage({ listCapture: "displaced", displacedOffset: 700 });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]?.settlements).toHaveLength(8);
    expect(page.scrollTops.length).toBeLessThanOrEqual(5);
    expect(page.onHoldTabClicks).toBe(0);
  });

  it("hands every pagination fetch the absolute collection deadline", async () => {
    const page = new FakeFinancePage();
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);
    const startedAt = Date.now();

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]?.settlements).toHaveLength(8);
    expect(page.fetchDeadlineAts.length).toBeGreaterThan(0);
    for (const deadlineAt of page.fetchDeadlineAts) {
      expect(deadlineAt).not.toBeNull();
      expect(deadlineAt as number).toBeLessThanOrEqual(startedAt + 100);
      expect(deadlineAt as number).toBeGreaterThan(startedAt);
    }
  });

  it("emits Finance collection telemetry with trigger path, duration, and reconciliation state", async () => {
    const debug = vi.fn();
    const page = new FakeFinancePage({ listCapture: "displaced", displacedOffset: 1_300 });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = new SellerCenterBrowserDataSource({
      adsPowerClient: {
        openReady: vi.fn().mockResolvedValue({
          profileId: "profile-1",
          status: "Active",
          cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
        }),
      } as never,
      endpointResponseTimeoutMs: 100,
      logger: { debug } as never,
    });

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]?.settlements).toHaveLength(8);
    const telemetryCall = debug.mock.calls.find(([fields]) =>
      typeof fields === "object" && fields !== null && (fields as { operation?: string }).operation === "finance-collect",
    );
    expect(telemetryCall).toBeDefined();
    expect(telemetryCall?.[0]).toMatchObject({
      operation: "finance-collect",
      triggerPath: "SWEEP_EARLY_EXIT",
      // Default fixture page one has_more=true, so pagination fetches exactly one extra page.
      pagesFetched: 2,
      reconciled: true,
    });
    expect(typeof (telemetryCall?.[0] as { durationMs?: number }).durationMs).toBe("number");
  });

  it("raises SOURCE_TIMEOUT instead of hanging when a scroll step never settles", async () => {
    const page = new FakeFinancePage({ listCapture: "displaced", displacedOffset: 1_300, scrollHangs: true });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);
    const startedAt = Date.now();

    await expect(async () => {
      for await (const _batch of source.collectFinancials(syncRequest())) {
        // The deadline must fire even when the page throttles animation frames.
      }
    }).rejects.toMatchObject({ failureType: "SOURCE_TIMEOUT" });

    expect(Date.now() - startedAt).toBeLessThan(600);
  });

  it("does not mutate the viewport when the original size is unknown", async () => {
    const page = new FakeFinancePage();
    const setViewportSize = vi.fn(async (_size: { width: number; height: number }) => undefined);
    page.viewportSize = () => null;
    page.setViewportSize = setViewportSize;
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]?.settlements).toHaveLength(8);
    expect(setViewportSize).not.toHaveBeenCalled();
  });

  it("types an unreadable response body as INCOMPLETE_RESPONSE instead of ROUTE_CHANGED", async () => {
    const page = new FakeFinancePage({ statBody: REJECTING_BODY as unknown as Record<string, unknown> });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    await expect(async () => {
      for await (const _batch of source.collectFinancials(syncRequest())) {
        // A body that fails mid-read is incomplete data, not a layout change.
      }
    }).rejects.toMatchObject({ failureType: "INCOMPLETE_RESPONSE" });
  });

  it("restores the previous viewport after the tall-viewport fast path", async () => {
    const page = new FakeFinancePage();
    const setViewportSize = vi.fn(async (_size: { width: number; height: number }) => undefined);
    let currentHeight = 800;
    page.viewportSize = () => ({ width: 1280, height: currentHeight });
    page.setViewportSize = async (size: { width: number; height: number }) => {
      currentHeight = size.height;
      await setViewportSize(size);
    };
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]?.settlements).toHaveLength(8);
    expect(setViewportSize).toHaveBeenNthCalledWith(1, { width: 1280, height: 2400 });
    expect(setViewportSize).toHaveBeenLastCalledWith({ width: 1280, height: 800 });
  });

  it("keeps the controlled sweep as the fallback when the tall viewport cannot be applied", async () => {
    // FakeFinancePage exposes no viewportSize/setViewportSize at all: the fast path
    // must no-op and the stepwise walker must still reach the displaced target.
    const page = new FakeFinancePage({ listCapture: "displaced", displacedOffset: 1_300 });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]?.settlements).toHaveLength(8);
    expect(page.sweepCount).toBeGreaterThan(0);
  });
});

function browserFor(page: FakeFinancePage) {
  return {
    contexts: () => [{ newPage: async () => page }],
    isConnected: () => true,
    once: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function sourceFor(_page: FakeFinancePage): SellerCenterBrowserDataSource {
  return new SellerCenterBrowserDataSource({
    adsPowerClient: {
      openReady: vi.fn().mockResolvedValue({
        profileId: "profile-1",
        status: "Active",
        cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
      }),
    } as never,
    endpointResponseTimeoutMs: 100,
  });
}

interface FakeFinancePageOptions {
  readonly statBody?: unknown;
  readonly firstPageBody?: unknown;
  readonly nextPageBody?: unknown;
  readonly statCapture?: "natural" | "sweep";
  readonly listCapture?: "natural" | "async-natural" | "sweep" | "displaced" | "absent";
  readonly listUrl?: string;
  readonly displacedOffset?: number;
  readonly listBodyNeverResolves?: boolean;
  readonly pageFetchNeverResolves?: boolean;
  readonly requireListenerDisposedBeforeFetch?: boolean;
  readonly gotoBlocksMs?: number;
  readonly accessInspectionDelayMs?: number;
  readonly scrollHangs?: boolean;
}

class FakeFinancePage {
  /** Optional viewport hooks mirroring Playwright's Page; absent by default so the
   * tall-viewport fast path exercises its no-op guard in every other test. */
  viewportSize?: () => { width: number; height: number } | null;
  setViewportSize?: (size: { width: number; height: number }) => Promise<void>;
  readonly goto = vi.fn(async (url: string) => {
    if ((this.options.gotoBlocksMs ?? 0) > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.gotoBlocksMs));
    }
    this.currentUrl = url;
    if ((this.options.statCapture ?? "natural") === "natural") this.emitStatResponse();
    const listCapture = this.options.listCapture ?? "natural";
    if (listCapture === "natural") this.emitListResponse();
    if (listCapture === "async-natural") setTimeout(() => this.emitListResponse(), 5);
  });
  readonly close = vi.fn().mockResolvedValue(undefined);
  readonly fetchUrls: string[] = [];
  private readonly responseListeners = new Set<(response: FakeResponse) => void>();
  private holdTabClickCount = 0;
  private viewportSweepCount = 0;
  readonly scrollTops: number[] = [];
  private responsesWithoutListener = 0;
  private currentUrl = "about:blank";

  get onHoldTabClicks(): number {
    return this.holdTabClickCount;
  }

  get sweepCount(): number {
    return this.viewportSweepCount;
  }

  get responseListenerCount(): number {
    return this.responseListeners.size;
  }

  get responsesEmittedWithoutListener(): number {
    return this.responsesWithoutListener;
  }

  constructor(private readonly options: FakeFinancePageOptions = {}) {}

  url(): string {
    return this.currentUrl;
  }

  async waitForResponse(
    predicate: (response: FakeResponse) => boolean,
  ): Promise<FakeResponse> {
    const responses = [
      new FakeResponse(
        "https://seller-us.tiktok.com/api/v1/pay/statement/stat/info?amount_stat_type=1&statement_version=1",
        this.options.statBody ?? statResponse(),
      ),
      new FakeResponse(irrelevantOverviewUrl, pageResponse(0, 0, 0, false)),
      new FakeResponse(pageOneUrl, this.options.firstPageBody ?? pageResponse(0, 5, 8, true)),
    ];
    const response = responses.find((candidate) => {
      if (this.options.listCapture !== "natural" && candidate.url().includes("/statement/order/list")) return false;
      return predicate(candidate);
    });
    if (!response) throw new Error("No matching fake response");
    return response;
  }

  on(event: "response", listener: (response: FakeResponse) => void): this {
    if (event !== "response") throw new Error(`Unexpected event ${event}`);
    this.responseListeners.add(listener);
    return this;
  }

  off(event: "response", listener: (response: FakeResponse) => void): this {
    if (event !== "response") throw new Error(`Unexpected event ${event}`);
    this.responseListeners.delete(listener);
    return this;
  }

  locator(selector: string): {
    innerText?: () => Promise<string>;
  } {
    if (selector === "body") {
      return {
        innerText: async () => {
          if ((this.options.accessInspectionDelayMs ?? 0) > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.options.accessInspectionDelayMs));
          }
          return "Finance On hold";
        },
      };
    }
    throw new Error(`Unexpected locator ${selector}`);
  }

  getByRole(role: string, options?: { readonly name?: RegExp }): { click(): Promise<void> } {
    if (role !== "tab" || options?.name?.test("On hold") !== true) {
      throw new Error("Unexpected role locator");
    }
    return {
      click: async () => {
        this.holdTabClickCount += 1;
        this.currentUrl = "https://seller-us.tiktok.com/finance/bills?tab=statement&subTab=on-hold";
      },
    };
  }

  readonly fetchDeadlineAts: Array<number | null> = [];
  private sweepEmitScheduled = false;

  async evaluate(_callback: unknown, argument?: unknown): Promise<unknown> {
    if (argument !== null && typeof argument === "object" && "top" in argument) {
      // Stepwise scroll request issued by the bounded Finance viewport walker.
      const request = argument as { top: number };
      const viewportHeight = 800;
      const increment = viewportHeight - 160;
      const maximum = this.options.displacedOffset !== undefined && this.options.displacedOffset > 64_000
        ? this.options.displacedOffset
        : 2_200;
      if (this.options.scrollHangs === true) {
        // A hidden/backgrounded page pauses requestAnimationFrame: the step promise
        // never settles unless the walker enforces the deadline around evaluate().
        return new Promise<never>(() => undefined);
      }
      const boundedTop = Math.min(maximum, Math.max(0, Math.floor(request.top)));
      this.scrollTops.push(boundedTop);
      this.viewportSweepCount += 1;
      const displacedOffset = this.options.displacedOffset ?? -1;
      if (
        displacedOffset >= boundedTop &&
        displacedOffset < boundedTop + viewportHeight &&
        this.options.listCapture === "displaced"
      ) {
        // Data only mounts when the walker actually intersects the displaced target.
        this.emitListResponse();
      }
      if (!this.sweepEmitScheduled && ((this.options.statCapture ?? "natural") === "sweep" || (this.options.listCapture ?? "natural") === "sweep")) {
        this.sweepEmitScheduled = true;
        setTimeout(() => {
          if (this.options.statCapture === "sweep") this.emitStatResponse();
          if (this.options.listCapture === "sweep") this.emitListResponse();
        }, 5);
      }
      return { maxScroll: maximum, nextTop: boundedTop + increment };
    }
    if (typeof argument === "string") return this.performFetch(argument, null);
    if (argument !== null && typeof argument === "object" && "url" in argument) {
      const request = argument as { url: string; deadlineAt?: number };
      return this.performFetch(request.url, request.deadlineAt ?? null);
    }
    // Restore-to-top call from the walker's finally block.
    return undefined;
  }

  private performFetch(url: string, deadlineAt: number | null): unknown {
    this.fetchUrls.push(url);
    this.fetchDeadlineAts.push(deadlineAt);
    if (this.options.requireListenerDisposedBeforeFetch === true && this.responseListeners.size !== 0) {
      throw new Error("Finance capture listener was not disposed before pagination");
    }
    if (this.options.requireListenerDisposedBeforeFetch === true) this.responsesWithoutListener += 1;
    if (this.options.pageFetchNeverResolves === true) return new Promise<never>(() => undefined);
    return this.options.nextPageBody ?? pageResponse(5, 3, 8, false);
  }

  private emitStatResponse(): void {
    this.emitResponse(new FakeResponse(
      "https://seller-us.tiktok.com/api/v1/pay/statement/stat/info?amount_stat_type=1&statement_version=1",
      this.options.statBody ?? statResponse(),
    ));
  }

  private emitListResponse(): void {
    this.emitResponse(new FakeResponse(
      this.options.listUrl ?? pageOneUrl,
      this.options.listBodyNeverResolves === true
        ? NEVER_RESOLVING_BODY
        : this.options.firstPageBody ?? pageResponse(0, 5, 8, true),
    ));
  }

  private emitResponse(response: FakeResponse): void {
    if (this.responseListeners.size === 0) this.responsesWithoutListener += 1;
    for (const listener of this.responseListeners) listener(response);
  }
}

class FakeResponse {
  constructor(
    private readonly responseUrl: string,
    private readonly body: unknown,
  ) {}

  url(): string {
    return this.responseUrl;
  }

  status(): number {
    return 200;
  }

  request(): { method(): string; url(): string } {
    return {
      method: () => "GET",
      url: () => this.responseUrl,
    };
  }

  async json(): Promise<unknown> {
    if (this.body === NEVER_RESOLVING_BODY) return new Promise<never>(() => undefined);
    if (this.body === REJECTING_BODY) throw new Error("cdp body read failed mid-stream");
    return this.body;
  }
}

function syncRequest(): SyncRequest {
  return {
    shop: {
      shopId: "shop-1",
      profileId: "profile-1",
      profileNo: "957",
      region: "US",
      locale: "en-US",
    },
    mode: "INCREMENTAL",
    checkpoint: null,
    since: null,
    until: null,
  };
}

function statResponse(options: {
  readonly totalAmount?: string;
  readonly currency?: string;
  readonly reasons?: ReadonlyArray<{ readonly reason: 1 | 2 | 3; readonly amount: string }>;
} = {}): Record<string, unknown> {
  const currency = options.currency ?? "USD";
  return {
    code: 0,
    data: {
      to_settle_amount_stat: {
        amount: { amount: options.totalAmount ?? "310.16", currency },
        reasons_detail: (options.reasons ?? [
          { reason: 1, amount: "177.33" },
          { reason: 3, amount: "132.83" },
        ]).map((reason) => ({
          reason: reason.reason,
          amount: { amount: reason.amount, currency },
        })),
      },
    },
  };
}

function pageResponse(
  offset: number,
  count: number,
  totalRecord: number,
  hasMore: boolean,
): Record<string, unknown> {
  return pageResponseRows(
    Array.from({ length: count }, (_, index) => statementRow(offset + index)),
    totalRecord,
    hasMore,
  );
}

function pageResponseRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  totalRecord: number,
  hasMore: boolean,
): Record<string, unknown> {
  return {
    code: 0,
    data: {
      total_record: totalRecord,
      search_next_has_more: hasMore,
      order_records: rows,
    },
  };
}

function statementRow(index: number, amount?: string, reasonOverride?: 1 | 2 | 3): Record<string, unknown> {
  const reason = reasonOverride ?? (index < 5 ? 1 : 3);
  const settlementAmount = amount ?? (reason === 1
    ? (index === 4 ? "37.33" : "35.00")
    : (index === 7 ? "44.83" : "44.00"));
  return {
    statement_detail_id: `detail-${index}`,
    reference_id: `reference-${index}`,
    trade_order_id: `order-${index}`,
    placed_time: 1_723_680_000_000 + index,
    trade_type: 1,
    settlement_amount: { amount: settlementAmount, currency: "USD" },
    earning_amount: { amount: "50.00", currency: "USD" },
    fees: { amount: "-5.00", currency: "USD" },
    settlement_status: 1,
    to_settle_reason: reason,
    ...(reason === 3
      ? { estimate_settle_time: 1_724_198_400_000 + index }
      : {}),
    delivery_time: 1_723_939_200_000 + index,
    estimate_settle_time_not_delivery: {
      starling_key: "finance_on_hold_waiting",
      starling_text: "Package not delivered for 31 days",
      params: ["31"],
    },
    statement_id: "statement-1",
    statement_version: 1,
    source_page_types: [{
      starling_key: "finance_page_type_order",
      starling_text: "Order",
    }],
    buyer_name: "Alice Private",
  };
}

function sumExpected(rows: Array<{ expectedSettlementAmount: string | null }>): string {
  return rows
    .reduce((total, row) => total + Number(row.expectedSettlementAmount ?? 0), 0)
    .toFixed(2);
}
