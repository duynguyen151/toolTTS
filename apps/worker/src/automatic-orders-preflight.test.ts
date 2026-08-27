import type { ProxyPreflightResult } from "@shop-health/domain";
import { describe, expect, it, vi } from "vitest";

import {
  AUTOMATIC_ORDERS_PREFLIGHT_BLOCKED_MESSAGE,
  runAutomaticOrdersWithPreflight,
} from "./automatic-orders-preflight.js";

const healthy: ProxyPreflightResult = {
  status: "HEALTHY",
  latencyMs: 42,
  exitIp: null,
  reasonClass: "OBSERVED_HEALTHY",
};

function preflightFor(result: ProxyPreflightResult) {
  return { preflight: vi.fn(async () => result) };
}

describe("runAutomaticOrdersWithPreflight", () => {
  it.each([
    healthy,
    { status: "DEGRADED", latencyMs: 1_001, exitIp: null, reasonClass: "OBSERVED_SLOW" },
  ] as const)("runs the server-only preflight before automatic %s.status browser work", async (preflight) => {
    const events: string[] = [];
    const execute = vi.fn(async () => { events.push("execute"); return true; });
    const proxyPreflight = {
      preflight: vi.fn(async (input: { profileId: string }) => {
        events.push(`preflight:${input.profileId}`);
        return preflight;
      }),
    };
    const logBlocked = vi.fn();

    const result = await runAutomaticOrdersWithPreflight({
      shop: { id: "shop-1", profileId: "profile-1" },
      proxyPreflight,
      execute,
      logBlocked,
    });

    expect(events).toEqual(["preflight:profile-1", "execute"]);
    expect(execute).toHaveBeenCalledWith({ id: "shop-1", profileId: "profile-1" });
    expect(logBlocked).not.toHaveBeenCalled();
    expect(result).toEqual({ preflightStatus: preflight.status, browserExecuted: true, succeeded: true });
  });

  it.each([
    { status: "UNKNOWN", latencyMs: 42, exitIp: null, reasonClass: "OBSERVATION_UNAVAILABLE" },
    { status: "UNAVAILABLE", latencyMs: 42, exitIp: null, reasonClass: "NETWORK_UNAVAILABLE" },
  ] as const)("blocks automatic browser work for %s.status with a fixed sanitized event", async (preflight) => {
    const secret = "http://private.proxy/?token=secret";
    const execute = vi.fn(async () => true);
    const logBlocked = vi.fn();

    const result = await runAutomaticOrdersWithPreflight({
      shop: { id: "shop-1", profileId: "profile-1" },
      proxyPreflight: preflightFor(preflight),
      execute,
      logBlocked,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(logBlocked).toHaveBeenCalledWith({
      operation: "worker.orders.proxy_preflight",
      entity: "orders",
      shopId: "shop-1",
      profileId: "profile-1",
      status: preflight.status,
    }, AUTOMATIC_ORDERS_PREFLIGHT_BLOCKED_MESSAGE);
    expect(JSON.stringify(logBlocked.mock.calls)).not.toContain(secret);
    expect(result).toEqual({ preflightStatus: preflight.status, browserExecuted: false, succeeded: false });
  });

  it("fails closed with a fixed UNKNOWN event when preflight throws sensitive text", async () => {
    const secret = "http://private.proxy/?token=secret";
    const execute = vi.fn(async () => true);
    const logBlocked = vi.fn();

    const result = await runAutomaticOrdersWithPreflight({
      shop: { id: "shop-1", profileId: "profile-1" },
      proxyPreflight: { preflight: async () => { throw new Error(secret); } },
      execute,
      logBlocked,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(logBlocked).toHaveBeenCalledWith(expect.objectContaining({ status: "UNKNOWN" }), AUTOMATIC_ORDERS_PREFLIGHT_BLOCKED_MESSAGE);
    expect(JSON.stringify(logBlocked.mock.calls)).not.toContain(secret);
    expect(result).toEqual({ preflightStatus: "UNKNOWN", browserExecuted: false, succeeded: false });
  });
});
