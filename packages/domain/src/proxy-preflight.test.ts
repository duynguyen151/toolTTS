import { describe, expect, it } from "vitest";

import {
  ProxyPreflightInputSchema,
  ProxyPreflightResultSchema,
} from "./proxy-preflight.js";

describe("proxy preflight contract", () => {
  it("accepts only bounded, sanitized preflight metadata", () => {
    expect(ProxyPreflightInputSchema.parse({ profileId: " profile-1 " }))
      .toEqual({ profileId: "profile-1" });
    expect(ProxyPreflightResultSchema.parse({
      status: "HEALTHY",
      latencyMs: 42,
      exitIp: "8.8.8.8",
      reasonClass: "OBSERVED_HEALTHY",
    })).toEqual({
      status: "HEALTHY",
      latencyMs: 42,
      exitIp: "8.8.8.8",
      reasonClass: "OBSERVED_HEALTHY",
    });
  });

  it("rejects status and reason combinations that would imply unsupported health evidence", () => {
    expect(() => ProxyPreflightResultSchema.parse({
      status: "UNKNOWN",
      latencyMs: 42,
      exitIp: null,
      reasonClass: "NETWORK_UNAVAILABLE",
    })).toThrow();
    expect(() => ProxyPreflightResultSchema.parse({
      status: "UNAVAILABLE",
      latencyMs: 42,
      exitIp: "8.8.8.8",
      reasonClass: "NETWORK_UNAVAILABLE",
    })).toThrow();
  });

  it("rejects the 6to4 relay anycast /24 without rejecting an adjacent public address", () => {
    expect(() => ProxyPreflightResultSchema.parse({
      status: "HEALTHY",
      latencyMs: 42,
      exitIp: "192.88.99.1",
      reasonClass: "OBSERVED_HEALTHY",
    })).toThrow();
    expect(ProxyPreflightResultSchema.parse({
      status: "HEALTHY",
      latencyMs: 42,
      exitIp: "192.88.98.1",
      reasonClass: "OBSERVED_HEALTHY",
    })).toMatchObject({ exitIp: "192.88.98.1" });
  });

  it("rejects invented expiry, secrets, and unbounded latency", () => {
    expect(() => ProxyPreflightResultSchema.parse({
      status: "PROXY_EXPIRED",
      latencyMs: 42,
      exitIp: null,
      reasonClass: "OBSERVED_HEALTHY",
    })).toThrow();
    expect(() => ProxyPreflightResultSchema.parse({
      status: "HEALTHY",
      latencyMs: 42,
      exitIp: null,
      reasonClass: "OBSERVED_HEALTHY",
      proxyPassword: "never-persist-this",
    })).toThrow();
    expect(() => ProxyPreflightResultSchema.parse({
      status: "HEALTHY",
      latencyMs: 10_001,
      exitIp: null,
      reasonClass: "OBSERVED_HEALTHY",
    })).toThrow();
  });
});
