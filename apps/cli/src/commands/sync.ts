import {
  findShopByProfileNo,
  requestShopSync
} from "@shop-health/db";
import {
  captureSellerCenterNetworkInventory,
  createSellerCenterDataSource,
  type NetworkInventoryReport,
} from "@shop-health/seller-center";
import { runShopSync, type SyncKind } from "@shop-health/sync";
import Table from "cli-table3";
import { InvalidArgumentError, type Command } from "commander";

import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import { printJson, printKeyValues } from "../presentation/output.js";
import type { CliRuntime } from "../runtime.js";

interface SyncCommandDependencies {
  readonly captureNetworkInventory?: typeof captureSellerCenterNetworkInventory;
  readonly write?: (value: string) => void;
}

function durationSeconds(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 300) {
    throw new InvalidArgumentError("duration must be an integer from 5 through 300 seconds");
  }
  return parsed;
}

function safePageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function compactList(values: readonly string[]): string {
  return values.length === 0 ? "-" : values.join(", ");
}

function formatCaptureReady(profileNo: string, duration: number, pageUrls: readonly string[]): string {
  const safeUrls = pageUrls.map(safePageUrl).filter((value): value is string => value !== null);
  const pages = safeUrls.length === 0
    ? "- No existing Seller Center pages detected\n"
    : safeUrls.map((url) => `- ${url}\n`).join("");
  return [
    "CAPTURE READY\n",
    `Profile: ${profileNo}\n`,
    `Duration: ${duration}s\n`,
    "Pages:\n",
    pages,
    "Keep the existing Seller Center pages open and navigate only the areas you want inventoried.\n\n",
  ].join("");
}

function formatNetworkInventory(profileNo: string, report: NetworkInventoryReport): string {
  const table = new Table({
    head: ["METHOD", "HOST", "PATH", "STATUS", "TYPE", "KEYS", "ARRAYS", "PAGINATION", "OBS"],
  });
  for (const entry of report.entries) {
    table.push([
      entry.method,
      entry.host,
      entry.path,
      String(entry.status),
      entry.contentType || "-",
      compactList(entry.topLevelKeys),
      compactList(entry.arrays.map((item) => `${item.path}=${item.count}`)),
      compactList(entry.pagination.map((item) => `${item.path}=${String(item.value)}`)),
      String(entry.observations),
    ]);
  }
  const pageUrls = report.pageUrls
    .map(safePageUrl)
    .filter((value): value is string => value !== null);
  return [
    "NETWORK INVENTORY\n",
    `Profile: ${profileNo}\n`,
    `AdsPower Profile: ${report.profileId}\n`,
    `Started: ${report.startedAt.toISOString()}\n`,
    `Finished: ${report.finishedAt.toISOString()}\n`,
    `Duration: ${report.durationMs}ms\n`,
    `Pages: ${compactList(pageUrls)}\n`,
    `${table.toString()}\n`,
  ].join("");
}

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
      else if (kind === "orders" && result.sourceCoverage !== undefined) {
        printKeyValues([
          ["Profile", profileNo],
          ["Status", result.status],
          ["Run ID", result.syncRunId ?? "-"],
          ["Rows read", String(result.rowsRead)],
          ["Rows written", String(result.rowsWritten)],
          ["Source window", "Seller Center rolling 12 months"],
          ["Complete within source window", String(result.sourceCoverage.completeWithinWindow)],
          ["Lifetime history complete", String(result.sourceCoverage.lifetimeHistoryComplete)],
          ["Checkpoint", result.checkpoint ?? "-"],
        ]);
      } else {
        printKeyValues([["Profile", profileNo], ["Status", result.status], ["Run ID", result.syncRunId ?? "-"], ["Rows read", String(result.rowsRead)], ["Rows written", String(result.rowsWritten)], ["Complete", String(result.complete)], ["Checkpoint", result.checkpoint ?? "-"]]);
      }
    });
}

export function registerSyncExecutionCommands(
  program: Command,
  runtime: CliRuntime,
  dependencies: SyncCommandDependencies = {},
): void {
  const captureNetworkInventory = dependencies.captureNetworkInventory
    ?? captureSellerCenterNetworkInventory;
  const write = dependencies.write ?? ((value: string) => process.stdout.write(value));
  const sync = program.commands.find((command) => command.name() === "sync");
  if (sync === undefined) throw new Error("Sync command group must be registered first");
  registerLiveSync(sync, runtime, "orders", "orders", "INCREMENTAL");
  registerLiveSync(sync, runtime, "finance", "finance", "INCREMENTAL");
  sync.command("discover <profileNo>")
    .description("Capture a privacy-safe Seller Center network inventory")
    .option("--duration <seconds>", "Capture duration from 5 through 300 seconds", durationSeconds, 60)
    .option("--json", "Print only the final stable JSON report")
    .action(async (profileNo: string, options: { duration: number; json?: boolean }) => {
      const shop = await withDatabase(runtime, ({ db }) => findShopByProfileNo(db, profileNo));
      if (shop === null) {
        throw new CliError({
          failureType: "SHOP_NOT_FOUND",
          message: `Shop profile ${profileNo} is not configured`,
        });
      }
      if (shop.dataOrigin !== "LIVE") {
        throw new CliError({
          failureType: "LIVE_SHOP_REQUIRED",
          message: `Network discovery requires a LIVE shop profile: ${profileNo}`,
        });
      }
      if (shop.region !== "US" || shop.locale !== "en-US") {
        throw new CliError({
          failureType: "UNSUPPORTED_MARKET",
          message: `V1 supports only US / en-US: ${profileNo}`,
        });
      }
      const captureOptions = {
        durationMs: options.duration * 1_000,
        baseUrl: runtime.config.ADSPOWER_BASE_URL,
        onReady: ({ pageUrls }: { pageUrls: string[] }) => {
          if (options.json !== true) {
            write(formatCaptureReady(profileNo, options.duration, pageUrls));
          }
        },
      };
      const report = await captureNetworkInventory({
        shopId: shop.id,
        profileId: shop.profileId,
        profileNo: shop.profileNo,
        region: "US",
        locale: "en-US",
      }, runtime.config.ADSPOWER_API_KEY === undefined
        ? captureOptions
        : { ...captureOptions, apiKey: runtime.config.ADSPOWER_API_KEY });
      write(options.json === true
        ? `${JSON.stringify({
            schemaVersion: "seller-network-inventory.v1",
            profileNo,
            ...report,
          }, null, 2)}\n`
        : formatNetworkInventory(profileNo, report));
    });
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
