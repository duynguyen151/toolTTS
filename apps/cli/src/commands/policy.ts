import {
  appendGlobalRiskPolicyRevision,
  appendShopRiskPolicyOverrideRevision,
  disableShopRiskPolicyOverride,
  findShopByProfileNo,
  getEffectiveRiskPolicy,
} from "@shop-health/db";
import type { Command } from "commander";

import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import { printJson, printKeyValues } from "../presentation/output.js";
import type { CliRuntime } from "../runtime.js";

interface WriteOptions {
  readonly effectiveFrom: string;
  readonly payload: string;
  readonly json?: boolean;
}

interface EffectiveOptions {
  readonly effectiveAt: string;
  readonly json?: boolean;
}

function parseDate(value: string, option: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${option} must be an ISO timestamp`);
  return date;
}

function parsePayload(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("--payload must be valid JSON");
  }
}

async function requireShop(db: Parameters<typeof findShopByProfileNo>[0], profileNo: string) {
  const shop = await findShopByProfileNo(db, profileNo);
  if (shop === null) {
    throw new CliError({
      failureType: "SHOP_NOT_FOUND",
      message: `Shop profile ${profileNo} is not configured`,
    });
  }
  return shop;
}

function printRevision(scope: "GLOBAL" | "SHOP", revision: {
  revisionId: string;
  sequence: number;
  enabled: boolean;
  effectiveFrom: Date;
}, json: boolean | undefined): void {
  if (json === true) {
    printJson({ schemaVersion: "risk-policy-revision.v1", scope, revision });
    return;
  }
  printKeyValues([
    ["Scope", scope],
    ["Revision ID", revision.revisionId],
    ["Sequence", String(revision.sequence)],
    ["Enabled", String(revision.enabled)],
    ["Effective From", revision.effectiveFrom.toISOString()],
  ]);
}

export function registerPolicyCommands(program: Command, runtime: CliRuntime): void {
  const policy = program.command("policy").description("Manage immutable risk policy revisions");
  const global = policy.command("global").description("Manage GLOBAL policy revisions");

  for (const verb of ["create", "edit"] as const) {
    global.command(verb)
      .requiredOption("--effective-from <timestamp>")
      .requiredOption("--payload <json>")
      .option("--json")
      .action(async (options: WriteOptions) => {
        const payload = parsePayload(options.payload);
        if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
          throw new Error("--payload must be a JSON object");
        }
        const revision = await withDatabase(runtime, ({ db }) =>
          appendGlobalRiskPolicyRevision(db, {
            ...(payload as Record<string, unknown>),
            effectiveFrom: parseDate(options.effectiveFrom, "--effective-from"),
          } as Parameters<typeof appendGlobalRiskPolicyRevision>[1]));
        printRevision("GLOBAL", revision, options.json);
      });
  }

  const shopPolicy = policy.command("shop").description("Manage SHOP override revisions");
  for (const verb of ["create", "edit"] as const) {
    shopPolicy.command(`${verb} <profileNo>`)
      .requiredOption("--effective-from <timestamp>")
      .requiredOption("--payload <json>")
      .option("--json")
      .action(async (profileNo: string, options: WriteOptions) => {
        const payload = parsePayload(options.payload);
        if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
          throw new Error("--payload must be a JSON object");
        }
        const revision = await withDatabase(runtime, async ({ db }) => {
          const shop = await requireShop(db, profileNo);
          return appendShopRiskPolicyOverrideRevision(db, {
            shopId: shop.id,
            ...(payload as Record<string, unknown>),
            effectiveFrom: parseDate(options.effectiveFrom, "--effective-from"),
          } as Parameters<typeof appendShopRiskPolicyOverrideRevision>[1]);
        });
        printRevision("SHOP", revision, options.json);
      });
  }

  shopPolicy.command("delete <profileNo>")
    .description("Append a disabling revision; historical overrides remain unchanged")
    .requiredOption("--effective-from <timestamp>")
    .option("--json")
    .action(async (profileNo: string, options: Omit<WriteOptions, "payload">) => {
      const revision = await withDatabase(runtime, async ({ db }) => {
        const shop = await requireShop(db, profileNo);
        return disableShopRiskPolicyOverride(db, {
          shopId: shop.id,
          effectiveFrom: parseDate(options.effectiveFrom, "--effective-from"),
        });
      });
      printRevision("SHOP", revision, options.json);
    });

  shopPolicy.command("read-effective <profileNo>")
    .requiredOption("--effective-at <timestamp>")
    .option("--json")
    .action(async (profileNo: string, options: EffectiveOptions) => {
      const resolved = await withDatabase(runtime, async ({ db }) => {
        const shop = await requireShop(db, profileNo);
        return getEffectiveRiskPolicy(db, {
          shopId: shop.id,
          effectiveAt: parseDate(options.effectiveAt, "--effective-at"),
        });
      });
      if (options.json === true) {
        printJson({ schemaVersion: "risk-policy-effective.v1", profileNo, policy: resolved });
        return;
      }
      printKeyValues([
        ["Profile", profileNo],
        ["Effective At", resolved.effectiveAt],
        ["GLOBAL Revision", resolved.globalRevisionId],
        ["SHOP Override Revision", resolved.shopOverrideRevisionId ?? "-"],
        ["Policy Version", resolved.policyVersion],
      ]);
    });
}
