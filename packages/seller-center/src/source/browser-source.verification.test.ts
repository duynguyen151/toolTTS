import { beforeEach, describe, expect, it, vi } from "vitest";

import { SellerCenterBrowserDataSource } from "./browser-source.js";
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

    await expect(source.verifyProfile({ profileId: "profile-957" })).resolves.toEqual({
      status: "IDENTIFIED",
      tiktokShopId: "shop-957",
    });
    expect(page.gotoUrls).toEqual([financeRoute]);
    expect(page.onHoldTabClicks).toBe(1);
  });

  it("does not derive a changed identity from the starting Seller Center URL", async () => {
    const page = new FakeVerificationPage("https://seller-us.tiktok.com/product/manage");
    const source = sourceFor(page);

    const identity = await source.verifyProfile({ profileId: "profile-957" });

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

    await expect(source.verifyProfile({ profileId: "profile-957" })).rejects.toMatchObject({
      failureType: "LOGIN_REQUIRED",
    } satisfies Partial<SellerCenterError>);
    expect(page.gotoUrls).toEqual([financeRoute]);
  });

  it("classifies a canonical navigation proxy timeout without exposing proxy details", async () => {
    const page = new FakeVerificationPage("https://seller-us.tiktok.com/home", new Error(
      "net::ERR_PROXY_CONNECTION_TIMED_OUT at http://private-proxy.example:8080",
    ));
    const source = sourceFor(page);

    await expect(source.verifyProfile({ profileId: "profile-957" })).rejects.toMatchObject({
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
      profileId: "profile-957",
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
      { code: 1, message: "source error" },
    );
    const source = sourceFor(page);

    await expect(source.verifyProfile({ profileId: "profile-957" })).rejects.toMatchObject({
      failureType: "LAYOUT_CHANGED",
    } satisfies Partial<SellerCenterError>);
  });

  it("waits for AdsPower readiness before attaching to the canonical navigation page", async () => {
    const page = new FakeVerificationPage("https://seller-us.tiktok.com/home");
    const openReady = vi.fn().mockResolvedValue({
      profileId: "profile-957",
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

    await expect(source.verifyProfile({ profileId: "profile-957" })).resolves.toEqual({
      status: "IDENTIFIED",
      tiktokShopId: "shop-957",
    });
    expect(openReady).toHaveBeenCalledWith("profile-957");
  });
});

class FakeVerificationPage {
  readonly gotoUrls: string[] = [];
  private currentUrl: string;
  private clickCount = 0;

  constructor(
    initialUrl: string,
    private readonly navigationResult: string | Error = financeRoute,
    private readonly bodyText = "Finance On hold",
    private readonly responseBody: unknown = {
      code: 0,
      data: { search_next_has_more: false, total_record: 0, order_records: [] },
    },
  ) {
    this.currentUrl = initialUrl;
  }

  get onHoldTabClicks(): number {
    return this.clickCount;
  }

  async goto(url: string): Promise<void> {
    this.gotoUrls.push(url);
    if (this.navigationResult instanceof Error) throw this.navigationResult;
    this.currentUrl = this.navigationResult;
  }

  url(): string {
    return this.currentUrl;
  }

  async waitForResponse(
    predicate: (response: FakeResponse) => boolean,
  ): Promise<FakeResponse> {
    const response = new FakeResponse(identityRequest, this.responseBody);
    if (!predicate(response)) throw new Error("Expected Finance identity response was not matched");
    return response;
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

function sourceFor(page: FakeVerificationPage): SellerCenterBrowserDataSource {
  connectOverCDP.mockResolvedValue({
    contexts: () => [{ newPage: async () => page }],
    close: vi.fn().mockResolvedValue(undefined),
  });
  return new SellerCenterBrowserDataSource({
    adsPowerClient: {
      open: vi.fn().mockResolvedValue({
        profileId: "profile-957",
        status: "Active",
        cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
      }),
      openReady: vi.fn().mockResolvedValue({
        profileId: "profile-957",
        status: "Active",
        cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
      }),
    } as never,
  });
}
