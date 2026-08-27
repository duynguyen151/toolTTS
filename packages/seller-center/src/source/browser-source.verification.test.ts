import { beforeEach, describe, expect, it, vi } from "vitest";

import { SellerCenterBrowserDataSource } from "./browser-source.js";
import { sellerIdentityFromFinanceRequestUrl } from "./profile-verification.js";
import { SellerCenterError } from "../errors.js";

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

const financeRoute = "https://seller-us.tiktok.com/finance/bills?tab=overview&subTab=on-hold";
const identityRequest = [
  "https://seller-us.tiktok.com/api/v1/pay/statement/order/list",
  "?seller_id=shop-957&oec_seller_id=shop-957&settlement_status=1",
  "&from=0&size=5&page_type=10&pagination_type=1",
].join("");

describe("SellerCenterBrowserDataSource.verifyProfile", () => {
  beforeEach(() => connectOverCDP.mockReset());

  it.each([
    "https://seller-us.tiktok.com/home",
    "https://seller-us.tiktok.com/marketing",
  ])("navigates from %s to Finance On hold before identifying the shop", async (initialUrl) => {
    const page = new FakeVerificationPage(initialUrl);
    const source = sourceFor(page);

    await expect(source.verifyProfile({ profileId: "profile-under-test" })).resolves.toEqual({
      status: "IDENTIFIED",
      tiktokShopId: "shop-957",
    });
    expect(page.gotoUrls).toEqual([financeRoute]);
    expect(page.onHoldTabClicks).toBe(0);
  });

  it("does not derive a changed identity from the starting Seller Center URL", async () => {
    const page = new FakeVerificationPage("https://seller-us.tiktok.com/product/manage");
    const source = sourceFor(page);

    const identity = await source.verifyProfile({ profileId: "profile-under-test" });

    expect(identity).toEqual({ status: "IDENTIFIED", tiktokShopId: "shop-957" });
    expect(page.gotoUrls).toEqual([financeRoute]);
  });

  it("reports login required only after canonical Finance navigation redirects", async () => {
    const page = new FakeVerificationPage(
      "https://seller-us.tiktok.com/home",
      "https://seller-us.tiktok.com/login",
      "Log in with email and password",
    );
    const source = sourceFor(page);

    await expect(source.verifyProfile({ profileId: "profile-under-test" })).rejects.toMatchObject({
      failureType: "LOGIN_REQUIRED",
    } satisfies Partial<SellerCenterError>);
    expect(page.gotoUrls).toEqual([financeRoute]);
  });

  it("gives a Seller Center security challenge precedence over overlapping login signals", async () => {
    const page = new FakeVerificationPage(
      "https://seller-us.tiktok.com/home",
      "https://seller-us.tiktok.com/login/challenge",
      "Log in with email and password. Complete security verification.",
    );
    const source = sourceFor(page);

    await expect(source.verifyProfile({ profileId: "profile-under-test" })).rejects.toMatchObject({
      failureType: "CHALLENGE_REQUIRED",
    } satisfies Partial<SellerCenterError>);
  });

  it("classifies a canonical navigation proxy timeout without exposing proxy details", async () => {
    const page = new FakeVerificationPage("https://seller-us.tiktok.com/home", new Error(
      "net::ERR_PROXY_CONNECTION_TIMED_OUT at http://private-proxy.example:8080",
    ));
    const source = sourceFor(page);

    await expect(source.verifyProfile({ profileId: "profile-under-test" })).rejects.toMatchObject({
      failureType: "PROXY_TIMEOUT",
      message: "AdsPower profile proxy did not respond before the deadline",
    } satisfies Partial<SellerCenterError>);
  });

  it("sanitizes a profile-start proxy timeout in the health result", async () => {
    const source = new SellerCenterBrowserDataSource({
      adsPowerClient: {
        openReady: vi.fn().mockRejectedValue(new Error(
          "net::ERR_TUNNEL_CONNECTION_FAILED via private-proxy.example:8080",
        )),
      } as never,
    });

    const health = await source.health({
      shopId: "shop-957",
      profileId: "profile-under-test",
      profileNo: "957",
      region: "US",
      locale: "en-US",
    });

    expect(health).toMatchObject({
      status: "PROXY_TIMEOUT",
      detail: "AdsPower profile proxy did not respond before the deadline",
    });
    expect(JSON.stringify(health)).not.toContain("private-proxy.example");
  });

  it("rejects a canonical Finance response that does not prove source success", async () => {
    const page = new FakeVerificationPage(
      "https://seller-us.tiktok.com/home",
      financeRoute,
      "Finance On hold",
      {
        code: 1,
        message: "source error",
        data: { search_next_has_more: false, total_record: 0, order_records: [] },
      },
    );
    const source = sourceFor(page);

    await expect(source.verifyProfile({ profileId: "profile-under-test" })).rejects.toMatchObject({
      failureType: "API_REJECTED",
    } satisfies Partial<SellerCenterError>);
  });

  it("classifies a malformed nonzero identity envelope as API_REJECTED", async () => {
    const page = new FakeVerificationPage(
      "https://seller-us.tiktok.com/home",
      financeRoute,
      "Finance On hold",
      { code: 7 },
    );
    const source = sourceFor(page);

    await expect(source.verifyProfile({ profileId: "profile-under-test" })).rejects.toMatchObject({
      failureType: "API_REJECTED",
    } satisfies Partial<SellerCenterError>);
  });

  it.each([
    ["foreign origin", "https://attacker.invalid/api/v1/pay/statement/order/list?settlement_status=1&from=0&seller_id=evil&oec_seller_id=evil"],
    ["duplicate discriminator", identityRequest + "&settlement_status=1"],
  ])("does not derive identity from a %s response", async (_label, responseUrl) => {
    const page = new FakeVerificationPage(
      "https://seller-us.tiktok.com/home",
      financeRoute,
      "Finance On hold",
      undefined,
      "natural",
      responseUrl,
    );
    const source = sourceFor(page);

    await expect(source.verifyProfile({ profileId: "profile-under-test" })).rejects.toMatchObject({
      failureType: "ENDPOINT_NOT_OBSERVED",
    } satisfies Partial<SellerCenterError>);
  });

  it("classifies an invalid Finance response as an API schema change", async () => {
    const page = new FakeVerificationPage(
      "https://seller-us.tiktok.com/home",
      financeRoute,
      "Finance On hold",
      { code: 0, data: { order_records: [] } },
    );
    const source = sourceFor(page);

    await expect(source.verifyProfile({ profileId: "profile-under-test" })).rejects.toMatchObject({
      failureType: "API_SCHEMA_CHANGED",
    } satisfies Partial<SellerCenterError>);
  });

  it("shares the no-click viewport fallback for lazily observed Finance identity", async () => {
    const page = new FakeVerificationPage(
      "https://seller-us.tiktok.com/home",
      financeRoute,
      "Finance On hold",
      undefined,
      "async-sweep",
    );
    const source = sourceFor(page);

    await expect(source.verifyProfile({ profileId: "profile-under-test" })).resolves.toEqual({
      status: "IDENTIFIED",
      tiktokShopId: "shop-957",
    });
    // Stepwise walker: the async emission lands a few scroll steps in, so any
    // positive bounded step count proves the no-click fallback engaged.
    expect(page.sweepCount).toBeGreaterThan(0);
    expect(page.onHoldTabClicks).toBe(0);
  });

  it("waits for AdsPower readiness before attaching to the canonical navigation page", async () => {
    const page = new FakeVerificationPage("https://seller-us.tiktok.com/home");
    const openReady = vi.fn().mockResolvedValue({
      profileId: "profile-under-test",
      status: "Active",
      cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
    });
    const source = new SellerCenterBrowserDataSource({
      adsPowerClient: {
        open: vi.fn().mockRejectedValue(new Error("unready endpoint must not be used")),
        openReady,
      } as never,
    });
    connectOverCDP.mockResolvedValue({
      contexts: () => [{ newPage: async () => page }],
      close: vi.fn().mockResolvedValue(undefined),
    });

    await expect(source.verifyProfile({ profileId: "profile-under-test" })).resolves.toEqual({
      status: "IDENTIFIED",
      tiktokShopId: "shop-957",
    });
    expect(openReady).toHaveBeenCalledWith("profile-under-test");
  });

  it("does not treat an opaque configured reference as executable autofill capability", async () => {
    const source = new SellerCenterBrowserDataSource({
      credentialReference: "ADSPOWER_PROFILE_AUTOFILL",
    });

    await expect(source.credentialCapability()).resolves.toEqual({
      status: "MISSING",
      mechanism: null,
      reference: null,
    });
  });

  it("reports missing capability when no AdsPower autofill reference is configured", async () => {
    const source = new SellerCenterBrowserDataSource();

    await expect(source.credentialCapability()).resolves.toEqual({
      status: "MISSING",
      mechanism: null,
      reference: null,
    });
  });

  it("fails closed for a malformed credential reference without returning the value", async () => {
    const source = new SellerCenterBrowserDataSource({ credentialReference: "password-secret" });

    await expect(source.credentialCapability()).resolves.toEqual({
      status: "MISSING",
      mechanism: null,
      reference: null,
    });
  });
});

class FakeVerificationPage {
  readonly gotoUrls: string[] = [];
  private readonly responseListeners = new Set<(response: FakeResponse) => void>();
  private currentUrl: string;
  private clickCount = 0;
  private viewportSweepCount = 0;

  constructor(
    initialUrl: string,
    private readonly navigationResult: string | Error = financeRoute,
    private readonly bodyText = "Finance On hold",
    private readonly responseBody: unknown = {
      code: 0,
      data: { search_next_has_more: false, total_record: 0, order_records: [] },
    },
    private readonly responseTiming: "natural" | "async-sweep" | "absent" = "natural",
    private readonly responseUrl = identityRequest,
  ) {
    this.currentUrl = initialUrl;
  }

  get onHoldTabClicks(): number {
    return this.clickCount;
  }

  get sweepCount(): number {
    return this.viewportSweepCount;
  }

  async goto(url: string): Promise<void> {
    this.gotoUrls.push(url);
    if (this.navigationResult instanceof Error) throw this.navigationResult;
    this.currentUrl = this.navigationResult;
    if (this.responseTiming === "natural") this.emitResponse(new FakeResponse(this.responseUrl, this.responseBody));
  }

  url(): string {
    return this.currentUrl;
  }

  async waitForResponse(
    predicate: (response: FakeResponse) => boolean,
  ): Promise<FakeResponse> {
    const response = new FakeResponse(this.responseUrl, this.responseBody);
    if (this.responseTiming !== "natural" || !predicate(response)) {
      throw new Error("Expected Finance identity response was not matched");
    }
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

  private sweepEmitScheduled = false;

  async evaluate(_callback: unknown, argument?: unknown): Promise<unknown> {
    if (argument !== null && typeof argument === "object" && "top" in argument) {
      // Stepwise scroll request from the bounded Finance viewport walker.
      this.viewportSweepCount += 1;
      const maximum = 2_200;
      const top = Math.max(0, Math.floor((argument as { top: number }).top));
      if (this.responseTiming === "async-sweep" && !this.sweepEmitScheduled) {
        this.sweepEmitScheduled = true;
        setTimeout(() => this.emitResponse(new FakeResponse(this.responseUrl, this.responseBody)), 5);
      }
      return { maxScroll: maximum, nextTop: top + 640 };
    }
    // Restore-to-top call: no serializable argument.
    return undefined;
  }

  locator(selector: string): { innerText(): Promise<string> } {
    if (selector !== "body") throw new Error(`Unexpected locator ${selector}`);
    return { innerText: async () => this.bodyText };
  }

  getByRole(role: string, options?: { readonly name?: RegExp }): { click(): Promise<void> } {
    if (role !== "tab" || options?.name?.test("On hold") !== true) {
      throw new Error("Unexpected role locator");
    }
    return { click: async () => { this.clickCount += 1; } };
  }

  async close(): Promise<void> {}

  private emitResponse(response: FakeResponse): void {
    for (const listener of this.responseListeners) listener(response);
  }
}

class FakeResponse {
  constructor(private readonly responseUrl: string, private readonly body: unknown) {}

  url(): string {
    return this.responseUrl;
  }

  status(): number {
    return 200;
  }

  request(): { method(): string; url(): string } {
    return { method: () => "GET", url: () => this.responseUrl };
  }

  async json(): Promise<unknown> {
    return this.body;
  }
}

describe("sellerIdentityFromFinanceRequestUrl", () => {
  const base = "https://seller-us.tiktok.com/api/v1/pay/statement/order/list";

  it.each([
    ["single pair", `${base}?seller_id=shop-a&oec_seller_id=shop-a&from=0`, "IDENTIFIED", "shop-a"],
    ["conflicting seller_id", `${base}?seller_id=shop-a&seller_id=shop-b&oec_seller_id=shop-a`, "AMBIGUOUS", null],
    ["conflicting oec_seller_id", `${base}?oec_seller_id=shop-a&oec_seller_id=shop-b&seller_id=shop-a`, "AMBIGUOUS", null],
    ["missing both", base, "UNAVAILABLE", null],
    // Origin gating happens upstream in verifyProfile; the classifier only reads params.
    ["non-seller origin params", "https://attacker.invalid/list?seller_id=shop-a", "IDENTIFIED", "shop-a"],
    ["agreeing duplicate seller_id", `${base}?seller_id=shop-a&seller_id=shop-a&oec_seller_id=shop-a`, "AMBIGUOUS", null],
    ["cross-param conflict", `${base}?seller_id=shop-a&oec_seller_id=shop-b`, "AMBIGUOUS", null],
  ])("classifies %s", (_label, url, status, shopId) => {
    expect(sellerIdentityFromFinanceRequestUrl(url)).toEqual({ status, tiktokShopId: shopId });
  });
});

function sourceFor(page: FakeVerificationPage): SellerCenterBrowserDataSource {
  connectOverCDP.mockResolvedValue({
    contexts: () => [{ newPage: async () => page }],
    close: vi.fn().mockResolvedValue(undefined),
  });
  return new SellerCenterBrowserDataSource({
    adsPowerClient: {
      open: vi.fn().mockResolvedValue({
        profileId: "profile-under-test",
        status: "Active",
        cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
      }),
      openReady: vi.fn().mockResolvedValue({
        profileId: "profile-under-test",
        status: "Active",
        cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
      }),
    } as never,
    endpointResponseTimeoutMs: 100,
  });
}
