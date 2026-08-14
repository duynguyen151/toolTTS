import {
  findShopByProfileNo,
  getFinanceSummary,
  listOnHoldSettlements,
  listOrders,
  listSyncRuns
} from "@shop-health/db";
import type { Command } from "commander";

import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import { calculateAndStoreReport } from "../metrics-service.js";
import { parseComparisonPeriod } from "../period.js";
import { formatDate, formatMoney, printJson, printKeyValues, printTable } from "../presentation/output.js";
import { printShopReport } from "../presentation/report.js";
import type { CliRuntime } from "../runtime.js";

interface JsonOption { readonly json?: boolean; }

async function requireShop(runtime: CliRuntime, profileNo: string) {
  return withDatabase(runtime, async ({ db }) => {
    const shop = await findShopByProfileNo(db, profileNo);
    if (shop === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
    return shop;
  });
}

export function registerDataCommands(program: Command, runtime: CliRuntime): void {
  const orders = program.command("orders").description("Inspect normalized orders from PostgreSQL");
  orders.command("list <profileNo>")
    .option("--period <period>", "Period such as 30d", "30d")
    .option("--limit <count>", "Maximum rows", "20")
    .option("--json")
    .action(async (profileNo: string, options: { period: string; limit: string; json?: boolean }) => {
      const period = parseComparisonPeriod(options.period);
      const result = await withDatabase(runtime, async ({ db }) => {
        const shop = await findShopByProfileNo(db, profileNo);
        if (shop === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
        const rows = await listOrders(db, { shopId: shop.id, start: period.currentStart, end: period.currentEnd, limit: Number(options.limit) });
        return { shop, rows };
      });
      if (options.json === true) {
        printJson({ schemaVersion: "order-list.v1", profileNo, period, orders: result.rows });
        return;
      }
      printTable(["ORDER", "STATUS", "PAID AT", "TOTAL", "TRACKING", "CARRIER"], result.rows.map((row) => [row.sourceOrderId, row.canonicalStatus, formatDate(row.paidAt, runtime.config.DISPLAY_TIME_ZONE), formatMoney(row.grandTotal, row.currency), row.trackingNumber ?? "-", row.carrier ?? "-"]));
    });

  const finance = program.command("finance").description("Inspect normalized finance data");
  finance.command("summary <profileNo>").option("--json").action(async (profileNo: string, options: JsonOption) => {
    const result = await withDatabase(runtime, async ({ db }) => {
      const shop = await findShopByProfileNo(db, profileNo);
      if (shop === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
      return { shop, summary: await getFinanceSummary(db, shop.id) };
    });
    if (options.json === true) printJson({ schemaVersion: "finance-summary.v1", profileNo, ...result.summary });
    else printKeyValues([["Statements", String(result.summary.statementCount)], ["On Hold", String(result.summary.onHoldCount)], ["Expected settlement", formatMoney(result.summary.expectedSettlementAmount, result.shop.currency)], ["On hold amount", formatMoney(result.summary.onHoldExpectedAmount, result.shop.currency)], ["Settled amount", formatMoney(result.summary.settledAmount, result.shop.currency)], ["Available balance", formatMoney(result.summary.latestSnapshot?.availableBalance ?? null, result.shop.currency)], ["Frozen balance", formatMoney(result.summary.latestSnapshot?.frozenBalance ?? null, result.shop.currency)]]);
  });

  finance.command("on-hold <profileNo>").option("--limit <count>", "Maximum rows", "100").option("--json").action(async (profileNo: string, options: { limit: string; json?: boolean }) => {
    const result = await withDatabase(runtime, async ({ db }) => {
      const shop = await findShopByProfileNo(db, profileNo);
      if (shop === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
      return { shop, rows: await listOnHoldSettlements(db, shop.id, Number(options.limit)) };
    });
    if (options.json === true) printJson({ schemaVersion: "finance-on-hold.v1", profileNo, settlements: result.rows });
    else printTable(["ORDER", "PLACED", "EXPECTED", "REASON"], result.rows.map((row) => [row.tradeOrderId ?? "-", formatDate(row.placedAt, runtime.config.DISPLAY_TIME_ZONE), formatMoney(row.expectedSettlementAmount, row.currency), row.onHoldReason ?? row.sourceSettlementStatus]));
  });

  const metrics = program.command("metrics").description("Calculate deterministic shop metrics");
  metrics.command("show <profileNo>").option("--period <period>", "Period such as 30d", "30d").option("--json").action(async (profileNo: string, options: { period: string; json?: boolean }) => {
    const period = parseComparisonPeriod(options.period);
    const shop = await requireShop(runtime, profileNo);
    const report = await withDatabase(runtime, ({ db }) => calculateAndStoreReport(db, shop, period));
    if (options.json === true) printJson({ schemaVersion: "metrics.v1", profileNo, period: report.period, metrics: report.metrics });
    else printJson(report.metrics);
  });

  program.command("report <profileNo>").option("--period <period>", "Period such as 30d", "30d").option("--json").action(async (profileNo: string, options: { period: string; json?: boolean }) => {
    const period = parseComparisonPeriod(options.period);
    const shop = await requireShop(runtime, profileNo);
    const report = await withDatabase(runtime, ({ db }) => calculateAndStoreReport(db, shop, period));
    if (options.json === true) printJson(report);
    else printShopReport(report);
  });

  const sync = program.command("sync").description("Run or inspect source synchronization");
  sync.command("history <profileNo>").option("--limit <count>", "Maximum runs", "20").option("--json").action(async (profileNo: string, options: { limit: string; json?: boolean }) => {
    const result = await withDatabase(runtime, async ({ db }) => {
      const shop = await findShopByProfileNo(db, profileNo);
      if (shop === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
      return listSyncRuns(db, shop.id, Number(options.limit));
    });
    if (options.json === true) printJson({ schemaVersion: "sync-history.v1", profileNo, runs: result });
    else printTable(["STARTED", "MODE", "STATUS", "READ", "WRITTEN", "FAILURE"], result.map((run) => [formatDate(run.startedAt, runtime.config.DISPLAY_TIME_ZONE), run.mode, run.status, String(run.rowsRead), String(run.rowsWritten), run.failureType ?? "-"]));
  });

  sync.command("resume <profileNo>").option("--json").action(async (profileNo: string, options: JsonOption) => {
    const item = await withDatabase(runtime, async ({ db }) => {
      const shop = await findShopByProfileNo(db, profileNo);
      if (shop === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
      const { setShopSyncState } = await import("@shop-health/db");
      return setShopSyncState(db, shop.id, "ACTIVE");
    });
    if (options.json === true) printJson({ schemaVersion: "shop-status.v1", shop: item });
    else printKeyValues([["Profile", item.profileNo], ["State", item.syncState]]);
  });
}
