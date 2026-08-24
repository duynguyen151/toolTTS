import { createCotikClient } from "@shop-health/cotik";
import {
  disableShopProviderBinding,
  findEnabledShopProviderBinding,
  findShopByProfileNo,
  upsertShopProviderBinding
} from "@shop-health/db";
import type { SourceProvenance } from "@shop-health/domain";
import type { Command } from "commander";
import { z } from "zod";

import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import { printJson, printKeyValues, printTable } from "../presentation/output.js";
import { requireCotikToken, type CliRuntime } from "../runtime.js";

interface JsonOption { readonly json?: boolean; }

const CotikShopCandidateSchema = z.object({
  _id: z.string().min(1),
  name: z.string().optional(),
  code: z.string().optional()
});

const CotikListShopsDataSchema = z.object({ list_shop: z.array(CotikShopCandidateSchema) });
// COTIK Statements returns the discoverable shop ids in data.list_shop; its page defaults are explicit here.
const COTIK_SHOP_DISCOVERY_PATH = "/statements/?page=1&sizeperpage=50";

// COTIK reads cover Orders and Supplementary Finance only; Official On-Hold stays Seller Center's.
const COTIK_PROVENANCE: SourceProvenance = {
  source: "COTIK",
  capabilities: ["ORDERS", "SUPPLEMENTARY_FINANCE"]
};

function printBinding(profileNo: string, binding: { providerShopId: string | null; enabled: boolean }): void {
  printKeyValues([
    ["Profile", profileNo],
    ["Provider shop ID", binding.providerShopId ?? "-"],
    ["State", binding.enabled ? "ENABLED" : "DISABLED"]
  ]);
}

export function registerShopCotikCommands(shop: Command, runtime: CliRuntime): void {
  const cotik = shop.command("cotik").description("Discover COTIK shops and manage COTIK bindings");

  cotik.command("list").option("--json").action(async (options: JsonOption) => {
    const client = createCotikClient({ token: requireCotikToken(runtime) });
    const { list_shop } = await client.get(COTIK_SHOP_DISCOVERY_PATH, CotikListShopsDataSchema);
    if (options.json === true) printJson({ schemaVersion: "cotik-shop-list.v1", shops: list_shop });
    else printTable(["COTIK ID", "NAME", "CODE"], list_shop.map((item) => [item._id, item.name ?? "-", item.code ?? "-"]));
  });

  cotik.command("bind <profileNo>")
    .requiredOption("--shop-id <id>")
    .option("--json")
    .action(async (profileNo: string, options: JsonOption & { shopId: string }) => {
      const token = requireCotikToken(runtime);
      const binding = await withDatabase(runtime, async ({ db }) => {
        const target = await findShopByProfileNo(db, profileNo);
        if (target === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
        const client = createCotikClient({ token });
        const { list_shop } = await client.get(COTIK_SHOP_DISCOVERY_PATH, CotikListShopsDataSchema);
        const matches = list_shop.filter((candidate) => candidate._id === options.shopId);
        if (matches.length !== 1) {
          throw matches.length === 0
            ? new CliError({ failureType: "COTIK_SHOP_NOT_FOUND", message: `COTIK shop ${options.shopId} is not in the fetched candidates; only exact documented ids can be bound` })
            : new CliError({ failureType: "COTIK_CANDIDATE_AMBIGUOUS", message: `COTIK shop ${options.shopId} appears ${matches.length} times in the fetched candidates` });
        }
        await upsertShopProviderBinding(db, {
          shopId: target.id,
          provider: "COTIK",
          providerShopId: options.shopId,
          provenance: COTIK_PROVENANCE
        });
        return findEnabledShopProviderBinding(db, target.id, "COTIK");
      });
      if (options.json === true) printJson({ schemaVersion: "cotik-binding.v1", binding });
      else if (binding === null) printKeyValues([["Profile", profileNo], ["State", "NOT ENABLED"]]);
      else printBinding(profileNo, binding);
    });

  cotik.command("unbind <profileNo>").option("--json").action(async (profileNo: string, options: JsonOption) => {
    const binding = await withDatabase(runtime, async ({ db }) => {
      const target = await findShopByProfileNo(db, profileNo);
      if (target === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
      return disableShopProviderBinding(db, target.id, "COTIK");
    });
    if (options.json === true) printJson({ schemaVersion: "cotik-binding.v1", binding });
    else if (binding === null) printKeyValues([["Profile", profileNo], ["COTIK binding", "none active"]]);
    else printBinding(profileNo, binding);
  });
}
