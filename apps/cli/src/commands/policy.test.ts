import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendGlobalRiskPolicyRevision: vi.fn(),
  appendShopRiskPolicyOverrideRevision: vi.fn(),
  disableShopRiskPolicyOverride: vi.fn(),
  findShopByProfileNo: vi.fn(),
  getEffectiveRiskPolicy: vi.fn(),
}));

vi.mock("@shop-health/db", () => mocks);
vi.mock("../db-runtime.js", () => ({
  withDatabase: async (_runtime: unknown, operation: (context: { db: object }) => Promise<unknown>) => operation({ db: {} }),
}));

import { registerPolicyCommands } from "./policy.js";

const runtime = {
  config: { DISPLAY_TIME_ZONE: "Asia/Bangkok", LOG_LEVEL: "silent" },
  logger: {},
} as never;

async function run(args: string[]): Promise<string> {
  const program = new Command().exitOverride().configureOutput({ writeErr: () => undefined });
  let output = "";
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    registerPolicyCommands(program, runtime);
    await program.parseAsync(["node", "shop-health", ...args]);
    return output;
  } finally {
    write.mockRestore();
  }
}

const globalPayload = {
  version: "risk-control-policy.v2",
  currency: "USD",
  thresholds: {
    stopOnHoldValueAt: "4000.0000",
    stopDeliveryRateBelow: 0.75,
    minimumOrdersForRateRule: 10,
    resumeOnHoldValueBelow: "3800.0000",
    resumeDeliveryRateAt: 0.8,
    stableCyclesBeforeResume: 2,
  },
  caution: {
    onHoldValue: { mode: "DISABLED" },
    deliveryRate: { mode: "DISABLED" },
  },
};

const effectiveFrom = "2026-09-01T00:00:00.000Z";

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("policy commands", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.findShopByProfileNo.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000001", profileNo: "P-101" });
    mocks.appendGlobalRiskPolicyRevision.mockResolvedValue({ revisionId: "g-1" });
    mocks.appendShopRiskPolicyOverrideRevision.mockResolvedValue({ revisionId: "s-1" });
    mocks.disableShopRiskPolicyOverride.mockResolvedValue({ revisionId: "s-2", enabled: false });
    mocks.getEffectiveRiskPolicy.mockResolvedValue({ globalRevisionId: "g-1", shopOverrideRevisionId: "s-1" });
  });

  it.each(["create", "edit"])("maps global %s to an immutable append", async (verb) => {
    await run(["policy", "global", verb, "--effective-from", effectiveFrom, "--payload", json(globalPayload), "--json"]);

    expect(mocks.appendGlobalRiskPolicyRevision).toHaveBeenCalledWith({}, {
      ...globalPayload,
      effectiveFrom: new Date(effectiveFrom),
    });
  });

  it.each(["create", "edit"])("maps shop override %s to an immutable append", async (verb) => {
    const payload = {
      thresholds: { stopOnHoldValueAt: "4200.0000" },
      caution: { deliveryRate: { mode: "DISABLED" } },
    };
    await run(["policy", "shop", verb, "P-101", "--effective-from", effectiveFrom, "--payload", json(payload), "--json"]);

    expect(mocks.appendShopRiskPolicyOverrideRevision).toHaveBeenCalledWith({}, {
      shopId: "00000000-0000-4000-8000-000000000001",
      ...payload,
      effectiveFrom: new Date(effectiveFrom),
    });
  });

  it("maps shop override delete to a disabling revision", async () => {
    await run(["policy", "shop", "delete", "P-101", "--effective-from", effectiveFrom, "--json"]);

    expect(mocks.disableShopRiskPolicyOverride).toHaveBeenCalledWith({}, {
      shopId: "00000000-0000-4000-8000-000000000001",
      effectiveFrom: new Date(effectiveFrom),
    });
  });

  it("maps effective read to the exact requested instant", async () => {
    await run(["policy", "shop", "read-effective", "P-101", "--effective-at", effectiveFrom, "--json"]);

    expect(mocks.getEffectiveRiskPolicy).toHaveBeenCalledWith({}, {
      shopId: "00000000-0000-4000-8000-000000000001",
      effectiveAt: new Date(effectiveFrom),
    });
  });
});
