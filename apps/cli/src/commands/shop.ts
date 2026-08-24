import {
  createShop,
  findShopByProfileNo,
  listShops,
  setShopSyncState
} from "@shop-health/db";
import type { Command } from "commander";

import { registerShopCotikCommands } from "./cotik.js";
import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import { formatDate, printJson, printKeyValues, printTable } from "../presentation/output.js";
import type { CliRuntime } from "../runtime.js";

interface JsonOption { readonly json?: boolean; }

export function registerShopCommands(program: Command, runtime: CliRuntime): void {
  const shop = program.command("shop").description("Manage configured shops");
  registerShopCotikCommands(shop, runtime);

  shop.command("add")
    .requiredOption("--profile-no <number>")
    .requiredOption("--profile-id <id>")
    .option("--name <name>")
    .option("--region <region>", "Seller Center region", "US")
    .option("--locale <locale>", "Seller Center locale", "en-US")
    .option("--currency <currency>", "ISO currency", "USD")
    .option("--json")
    .action(async (options: {
      profileNo: string; profileId: string; name?: string; region: string;
      locale: string; currency: string; json?: boolean;
    }) => {
      if (options.region !== "US" || options.locale !== "en-US") {
        throw new CliError({ failureType: "UNSUPPORTED_MARKET", message: "V1 supports only US / en-US" });
      }
      const created = await withDatabase(runtime, ({ db }) => createShop(db, {
        profileNo: options.profileNo,
        profileId: options.profileId,
        displayName: options.name ?? null,
        region: options.region,
        locale: options.locale,
        currency: options.currency.toUpperCase()
      }));
      if (options.json === true) printJson({ schemaVersion: "shop.v1", shop: created });
      else printKeyValues([["Shop ID", created.id], ["Profile No", created.profileNo], ["Profile ID", created.profileId], ["State", created.syncState]]);
    });

  shop.command("list").option("--json").action(async (options: JsonOption) => {
    const shops = await withDatabase(runtime, ({ db }) => listShops(db));
    if (options.json === true) printJson({ schemaVersion: "shop-list.v1", shops });
    else printTable(["PROFILE", "NAME", "REGION", "STATE", "ORDERS SYNC"], shops.map((item) => [item.profileNo, item.displayName ?? "-", `${item.region}/${item.locale}`, item.syncState, formatDate(item.lastOrdersSyncedAt, runtime.config.DISPLAY_TIME_ZONE)]));
  });

  shop.command("status <profileNo>").option("--json").action(async (profileNo: string, options: JsonOption) => {
    const item = await withDatabase(runtime, ({ db }) => findShopByProfileNo(db, profileNo));
    if (item === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
    if (options.json === true) printJson({ schemaVersion: "shop-status.v1", shop: item });
    else printKeyValues([["Profile", item.profileNo], ["Profile ID", item.profileId], ["Name", item.displayName ?? "-"], ["State", item.syncState], ["Pause reason", item.pauseReason ?? "-"], ["Orders synced", formatDate(item.lastOrdersSyncedAt, runtime.config.DISPLAY_TIME_ZONE)], ["Finance synced", formatDate(item.lastFinanceSyncedAt, runtime.config.DISPLAY_TIME_ZONE)]]);
  });

  shop.command("resume <profileNo>").option("--json").action(async (profileNo: string, options: JsonOption) => {
    const item = await withDatabase(runtime, async ({ db }) => {
      const existing = await findShopByProfileNo(db, profileNo);
      if (existing === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
      return setShopSyncState(db, existing.id, "ACTIVE");
    });
    if (options.json === true) printJson({ schemaVersion: "shop-status.v1", shop: item });
    else printKeyValues([["Profile", item.profileNo], ["State", item.syncState]]);
  });
}
