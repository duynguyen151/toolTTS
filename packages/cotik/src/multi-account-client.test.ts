import { describe, expect, it } from "vitest";
import {
  classifyCotikAccountHealth,
  createMultiAccountCotikClient
} from "./multi-account-client.js";
import { CotikClientError } from "./client.js";
import { epochSecondsToDate } from "./multi-account-orders.js";

describe("Multi-Account Cotik Client (2A)", () => {
  it("diagnoses all 8 required account health states correctly", () => {
    // 1. ACTIVE
    expect(classifyCotikAccountHealth(null).state).toBe("ACTIVE");

    // 2. TOKEN_EXPIRED
    expect(
      classifyCotikAccountHealth(new Error("Token is not valid!")).state
    ).toBe("TOKEN_EXPIRED");
    expect(
      classifyCotikAccountHealth(new CotikClientError("PERMANENT", "Unauthorized", { httpStatus: 401 })).state
    ).toBe("TOKEN_EXPIRED");

    // 3. BLOCKED
    expect(
      classifyCotikAccountHealth(new Error("Account has been block!")).state
    ).toBe("BLOCKED");

    // 4. SUBSCRIPTION_EXPIRED
    expect(
      classifyCotikAccountHealth(new Error("Your service has expired! Please renew.")).state
    ).toBe("SUBSCRIPTION_EXPIRED");

    // 5. SHOP_DISCONNECTED
    expect(
      classifyCotikAccountHealth(new Error("Shop/App not found")).state
    ).toBe("SHOP_DISCONNECTED");

    // 6. RATE_LIMITED
    expect(
      classifyCotikAccountHealth(new CotikClientError("TRANSIENT", "Too Many Requests", { httpStatus: 429 })).state
    ).toBe("RATE_LIMITED");

    // 7. NETWORK_ERROR
    expect(
      classifyCotikAccountHealth(new CotikClientError("NETWORK", "Connection failed")).state
    ).toBe("NETWORK_ERROR");
    expect(
      classifyCotikAccountHealth(new CotikClientError("TIMEOUT", "Request timed out")).state
    ).toBe("NETWORK_ERROR");

    // 8. UNKNOWN
    expect(
      classifyCotikAccountHealth(new Error("Unexpected internal glitch 999")).state
    ).toBe("UNKNOWN");
    expect(classifyCotikAccountHealth(new Error("provider leaked buyer email"))).toEqual({
      state: "UNKNOWN",
      message: "Cotik encountered an unexpected error"
    });
  });

  it("converts epoch seconds to UTC Date correctly and round-trips", () => {
    // 1725700000 = Sat Sep 07 2024 09:06:40 GMT
    const seconds = 1725700000;
    const date = epochSecondsToDate(seconds);
    expect(date.getTime()).toBe(1725700000 * 1000);
    expect(Math.floor(date.getTime() / 1000)).toBe(seconds);

    // String seconds
    const dateStr = epochSecondsToDate("1725700000");
    expect(dateStr.getTime()).toBe(1725700000 * 1000);

    // If ms passed (> 1e11)
    const ms = 1725700000000;
    const dateMs = epochSecondsToDate(ms);
    expect(dateMs.getTime()).toBe(ms);
  });

  it("fails if accountId or token are blank", () => {
    expect(() =>
      createMultiAccountCotikClient({
        accountId: "",
        token: "token123"
      })
    ).toThrow("accountId is required");

    expect(() =>
      createMultiAccountCotikClient({
        accountId: "acc-1",
        token: "   "
      })
    ).toThrow("token is required");
  });

  it("forwards the injectable clock to the token lane", async () => {
    let now = 0;
    const fetchImpl = async () => new Response(JSON.stringify({ status: 200, data: { ok: true } }));
    const client = createMultiAccountCotikClient({
      accountId: "acc-1",
      token: "token123",
      fetch: fetchImpl,
      sleep: async (durationMs) => { now += durationMs; },
      now: () => now
    });

    await expect(client.get("/health")).resolves.toEqual({ ok: true });
  });

  it("forwards beforePost to the underlying client", async () => {
    const beforePost = async () => { throw new Error("kill switch disabled"); };
    const fetchImpl = async () => new Response(JSON.stringify({ status: 200, data: { ok: true } }));
    const client = createMultiAccountCotikClient({
      accountId: "acc-before-post",
      token: "token-before-post",
      fetch: fetchImpl,
      beforePost
    });

    await expect(client.post("/order/import-tracking-v2", { items: [] })).rejects.toThrow("kill switch disabled");
  });
});
