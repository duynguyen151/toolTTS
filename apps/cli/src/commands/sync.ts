import {
  findShopByProfileNo,
  requestShopSync
} from "@shop-health/db";
import { createSellerCenterDataSource } from "@shop-health/seller-center";
import { runShopSync, type SyncKind } from "@shop-health/sync";
import type { Command } from "commander";

import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import { printJson, printKeyValues } from "../presentation/output.js";
import type { CliRuntime } from "../runtime.js";

function registerLiveSync(
  sync: Command,
  runtime: CliRuntime,
  name: "orders" | "finance" | "backfill",
  kind: SyncKind,
  mode: "INCREMENTAL" | "BACKFILL"
): void {
  sync.command(`${name} <profileNo>`)
    .option("--json")
    .action(async (profileNo: string, options: { json?: boolean }) => {
      const result = await withDatabase(runtime, async (context) => {
        const shop = await findShopByProfileNo(context.db, profileNo);
        if (shop === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
        const sourceOptions = {
          baseUrl: runtime.config.ADSPOWER_BASE_URL,
          logger: runtime.logger
        };
        const source = createSellerCenterDataSource(runtime.config.ADSPOWER_API_KEY === undefined
          ? sourceOptions
          : { ...sourceOptions, apiKey: runtime.config.ADSPOWER_API_KEY });
        return runShopSync({ context, source, shop, kind, mode, logger: runtime.logger });
      });
      if (options.json === true) printJson({ schemaVersion: "sync-result.v1", profileNo, kind, mode, ...result });
      else printKeyValues([["Profile", profileNo], ["Status", result.status], ["Run ID", result.syncRunId ?? "-"], ["Rows read", String(result.rowsRead)], ["Rows written", String(result.rowsWritten)], ["Complete", String(result.complete)], ["Checkpoint", result.checkpoint ?? "-"]]);
    });
}

export function registerSyncExecutionCommands(program: Command, runtime: CliRuntime): void {
  const sync = program.commands.find((command) => command.name() === "sync");
  if (sync === undefined) throw new Error("Sync command group must be registered first");
  registerLiveSync(sync, runtime, "orders", "orders", "INCREMENTAL");
  registerLiveSync(sync, runtime, "finance", "finance", "INCREMENTAL");
  sync.command("backfill <profileNo>")
    .description("Reserved until Seller Center pagination/export is confirmed")
    .option("--json")
    .action((profileNo: string) => {
      throw new CliError({
        failureType: "BACKFILL_UNRESOLVED",
        message: `Backfill is disabled for profile ${profileNo}: Seller Center pagination/export request mapping is not confirmed`
      });
    });

  sync.command("request <profileNo>").option("--json").action(async (profileNo: string, options: { json?: boolean }) => {
    await withDatabase(runtime, async ({ db }) => {
      const shop = await findShopByProfileNo(db, profileNo);
      if (shop === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
      await requestShopSync(db, shop.id);
    });
    if (options.json === true) printJson({ schemaVersion: "sync-request.v1", profileNo, requested: true });
    else printKeyValues([["Profile", profileNo], ["Sync requested", "yes"]]);
  });
}
