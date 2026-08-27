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

  it.each([
    ["0.0.0.0", false],
    ["10.0.0.1", false],
    ["100.64.0.1", false],
    ["127.0.0.1", false],
    ["169.254.1.1", false],
    ["172.16.0.1", false],
    ["192.0.0.1", false],
    ["192.0.2.1", false],
    ["192.31.196.1", false],
    ["192.31.197.1", true],
    ["192.52.193.1", false],
    ["192.52.194.1", true],
    ["192.88.99.1", false],
    ["192.88.98.1", true],
    ["192.175.48.1", false],
    ["192.175.49.1", true],
    ["192.168.1.1", false],
    ["198.18.0.1", false],
    ["198.19.255.254", false],
    ["198.17.255.254", true],
    ["198.51.100.1", false],
    ["203.0.113.1", false],
    ["224.0.0.1", false],
    ["240.0.0.1", false],
    ["255.255.255.255", false],
    ["8.8.8.8", true],
  ])("%s public IPv4 eligibility is %s", (exitIp, accepted) => {
    const input = {
      status: "HEALTHY" as const,
      latencyMs: 42,
      exitIp,
      reasonClass: "OBSERVED_HEALTHY" as const,
    };
    if (accepted) expect(ProxyPreflightResultSchema.parse(input)).toMatchObject({ exitIp });
    else expect(() => ProxyPreflightResultSchema.parse(input)).toThrow();
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
