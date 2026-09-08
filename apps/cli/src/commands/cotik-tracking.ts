import {
  ensureCotikWorkflowSettings,
  findCotikAccountById,
  findPostIntentForTracking,
  getDecryptedCotikToken,
  listProviderCatalog,
  seedProviderCatalog,
  setCotikWorkflowSettings
} from "@shop-health/db";
import {
  confirmOrderTrackingReadback,
  createMultiAccountCotikClient,
} from "@shop-health/cotik";
import {
  runCotikDiscoverySync,
  runCotikMultiAccountOrdersSync,
  readCotikTrackingSheetBatch,
  stageCotikTracking,
  writeCotikTrackingSheetResults
} from "@shop-health/sync";
import type { Command } from "commander";

import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import { formatDate, printJson, printKeyValues, printTable } from "../presentation/output.js";
import type { CliRuntime } from "../runtime.js";

interface JsonOption {
  readonly json?: boolean | undefined;
}

type Region = "US" | "UK";

function parseStrictBoolean(value: string, option: string): boolean {
  if (value !== "true" && value !== "false") {
    throw new CliError({ failureType: "INVALID_ARGUMENT", message: `${option} must be exactly true or false` });
  }
  return value === "true";
}

function parseRegion(value: string): Region {
  if (value !== "US" && value !== "UK") {
    throw new CliError({ failureType: "INVALID_ARGUMENT", message: "region must be US or UK" });
  }
  return value;
}

function requireGoogleSheetsAccessToken(): string {
  const token = process.env.GOOGLE_SHEETS_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new CliError({
      failureType: "GOOGLE_SHEETS_NOT_CONFIGURED",
      message: "GOOGLE_SHEETS_ACCESS_TOKEN is required for this command"
    });
  }
  return token;
}

function printStageResult(result: Awaited<ReturnType<typeof stageCotikTracking>>, json: boolean): void {
  if (json) {
    printJson({ schemaVersion: "cotik-tracking-stage.v1", result });
    return;
  }
  printKeyValues(result.status === "STAGED"
    ? [["Status", result.status], ["Candidate ID", result.candidateId], ["Intent ID", result.intentId]]
    : [["Status", result.status], ["Reason", result.reason]]);
}

export function registerCotikTrackingCommands(program: Command, runtime: CliRuntime): void {
  const cotikTracking = program
    .command("cotik-tracking")
    .description("Manage the explicit Cotik provider catalog, dual kill switches, and sync execution");

  const providers = cotikTracking
    .command("providers")
    .description("List or seed the explicit provider catalog used by staging");

  providers
    .command("list")
    .option("--region <region>", "Filter providers by region (US or UK)")
    .option("--json")
    .action(async (options: JsonOption & { region?: string | undefined }) => {
      const regionFilter = options.region === undefined ? undefined : parseRegion(options.region);
      const entries = await withDatabase(runtime, ({ db }) => listProviderCatalog(db, regionFilter));

      if (options.json === true) {
        printJson({ schemaVersion: "cotik-provider-catalog.v1", providers: entries });
      } else {
        printTable(
          ["REGION", "CARRIER", "PROVIDER ID", "ACTIVE"],
          entries.map((entry) => [entry.region, entry.carrierName, entry.providerId, entry.isActive ? "YES" : "NO"])
        );
      }
    });

  providers
    .command("seed")
    .option("--json")
    .action(async (options: JsonOption) => {
      const entries = await withDatabase(runtime, ({ db }) => seedProviderCatalog(db));
      if (options.json === true) {
        printJson({ schemaVersion: "cotik-provider-catalog-seed.v1", providers: entries });
      } else {
        printKeyValues([["Providers Seeded", String(entries.length)]]);
      }
    });

  const killSwitch = cotikTracking
    .command("kill-switch")
    .description("Inspect or toggle Cotik dual kill switch settings");

  killSwitch
    .command("status")
    .option("--json")
    .action(async (options: JsonOption) => {
      const settings = await withDatabase(runtime, ({ db }) =>
        ensureCotikWorkflowSettings(db)
      );

      if (options.json === true) {
        printJson({ schemaVersion: "cotik-workflow-settings.v1", settings });
      } else {
        printKeyValues([
          ["Cotik Sync Enabled", settings.cotikSyncEnabled ? "ON" : "OFF"],
          ["Cotik POST Enabled", settings.cotikPostEnabled ? "ON" : "OFF"],
          ["Active Deployment ID", settings.deploymentId ?? "(none)"],
          ["Last Reset At", formatDate(settings.lastResetAt, runtime.config.DISPLAY_TIME_ZONE)],
          ["Updated At", formatDate(settings.updatedAt, runtime.config.DISPLAY_TIME_ZONE)]
        ]);
      }
    });

  killSwitch
    .command("set")
    .option("--sync <boolean>", "Set cotikSyncEnabled (true/false)")
    .option("--post <boolean>", "Set cotikPostEnabled (true/false)")
    .option("--confirm-post", "Explicitly confirm enabling cotikPostEnabled")
    .option("--json")
    .action(
      async (options: JsonOption & { sync?: string | undefined; post?: string | undefined; confirmPost?: boolean | undefined }) => {
        const syncVal =
          options.sync !== undefined ? parseStrictBoolean(options.sync, "--sync") : undefined;
        const postVal =
          options.post !== undefined ? parseStrictBoolean(options.post, "--post") : undefined;
        if (postVal === true && options.confirmPost !== true) {
          throw new CliError({
            failureType: "ENABLE_CONFIRMATION_REQUIRED",
            message: "--confirm-post is required before enabling cotikPostEnabled"
          });
        }

        const updated = await withDatabase(runtime, ({ db }) =>
          setCotikWorkflowSettings(db, {
            ...(syncVal !== undefined ? { cotikSyncEnabled: syncVal } : {}),
            ...(postVal !== undefined ? { cotikPostEnabled: postVal } : {})
          })
        );

        if (options.json === true) {
          printJson({ schemaVersion: "cotik-workflow-settings.v1", settings: updated });
        } else {
          printKeyValues([
            ["Cotik Sync Enabled", updated.cotikSyncEnabled ? "ON" : "OFF"],
            ["Cotik POST Enabled", updated.cotikPostEnabled ? "ON" : "OFF"],
            ["Updated At", formatDate(updated.updatedAt, runtime.config.DISPLAY_TIME_ZONE)]
          ]);
        }
      }
    );

  cotikTracking
    .command("stage")
    .requiredOption("--shop-id <logicalShopId>")
    .requiredOption("--order-id <orderId>")
    .requiredOption("--tracking <tracking>")
    .requiredOption("--provider <provider>")
    .requiredOption("--region <region>")
    .option("--json")
    .action(async (options: JsonOption & {
      shopId: string;
      orderId: string;
      tracking: string;
      provider: string;
      region: string;
    }) => {
      const region = parseRegion(options.region);
      const result = await withDatabase(runtime, ({ db }) => stageCotikTracking(db, {
        logicalShopId: options.shopId,
        orderId: options.orderId,
        tracking: options.tracking,
        provider: options.provider,
        region
      }));
      printStageResult(result, options.json === true);
    });

  cotikTracking
    .command("stage-sheet-date")
    .requiredOption("--spreadsheet-id <spreadsheetId>")
    .requiredOption("--tab <tabTitle>")
    .requiredOption("--range <range>")
    .requiredOption("--shop-id <logicalShopId>")
    .requiredOption("--region <region>")
    .requiredOption("--target-date <YYYY-MM-DD>")
    .option("--date-format <format>", "Interpret slash dates as MDY or DMY")
    .option("--json")
    .action(async (options: JsonOption & {
      spreadsheetId: string;
      tab: string;
      range: string;
      shopId: string;
      region: string;
      targetDate: string;
      dateFormat?: string | undefined;
    }) => {
      const region = parseRegion(options.region);
      if (options.dateFormat !== undefined && options.dateFormat !== "MDY" && options.dateFormat !== "DMY") {
        throw new CliError({ failureType: "INVALID_ARGUMENT", message: "date-format must be MDY or DMY" });
      }
      const batch = await readCotikTrackingSheetBatch(
        {
          spreadsheetId: options.spreadsheetId,
          tabTitle: options.tab,
          range: options.range,
          targetDate: options.targetDate,
          ...(options.dateFormat === undefined ? {} : { dateFormat: options.dateFormat })
        },
        { accessToken: requireGoogleSheetsAccessToken() }
      );
      if (batch.rows.length > 50) {
        throw new CliError({ failureType: "INPUT_TOO_LARGE", message: "At most 50 rows may be staged per invocation" });
      }
      const results = await withDatabase(runtime, async ({ db }) => {
        const staged = [];
        for (const row of batch.rows) {
          const result = await stageCotikTracking(db, {
            logicalShopId: options.shopId,
            orderId: row.orderId,
            tracking: row.tracking,
            provider: row.providerNote,
            region
          });
          staged.push({
            rowNumber: row.rowNumber,
            status: result.status,
            ...(result.status === "STAGED"
              ? { candidateId: result.candidateId, intentId: result.intentId }
              : { reason: result.reason })
          });
        }
        return staged;
      });
      const payload = {
        schemaVersion: "cotik-tracking-stage-sheet-date.v1",
        targetDate: options.targetDate,
        rowsRead: batch.rows.length + batch.skippedRows.length,
        rowsEligible: batch.rows.length,
        rowsSkipped: batch.skippedRows.length,
        rowsStaged: results.filter((result) => result.status === "STAGED").length,
        skipped: batch.skippedRows.map(({ rowNumber, reason }) => ({ rowNumber, reason })),
        results
      };
      if (options.json === true) printJson(payload);
      else printKeyValues([
        ["Rows Read", String(payload.rowsRead)],
        ["Rows Eligible", String(payload.rowsEligible)],
        ["Rows Skipped", String(payload.rowsSkipped)],
        ["Rows Staged", String(payload.rowsStaged)]
      ]);
    });

  cotikTracking
    .command("reconcile-sheet-date")
    .description("Read back terminal tracking intents and write terminal results to blank W cells")
    .requiredOption("--spreadsheet-id <spreadsheetId>")
    .requiredOption("--tab <tabTitle>")
    .requiredOption("--range <range>")
    .requiredOption("--shop-id <logicalShopId>")
    .requiredOption("--region <region>")
    .requiredOption("--target-date <YYYY-MM-DD>")
    .option("--date-column <column>", "Explicit date column when the header is ambiguous")
    .option("--cotik-order-id-column <column>", "Cotik OrderID column (defaults to B)")
    .option("--date-format <format>", "Interpret slash dates as MDY or DMY")
    .option("--json")
    .action(async (options: JsonOption & {
      spreadsheetId: string;
      tab: string;
      range: string;
      shopId: string;
      region: string;
      targetDate: string;
      dateFormat?: string | undefined;
    }) => {
      const region = parseRegion(options.region);
      if (options.dateFormat !== undefined && options.dateFormat !== "MDY" && options.dateFormat !== "DMY") {
        throw new CliError({ failureType: "INVALID_ARGUMENT", message: "date-format must be MDY or DMY" });
      }
      const batch = await readCotikTrackingSheetBatch(
        {
          spreadsheetId: options.spreadsheetId,
          tabTitle: options.tab,
          range: options.range,
          targetDate: options.targetDate,
          ...(options.dateFormat === undefined ? {} : { dateFormat: options.dateFormat })
        },
        { accessToken: requireGoogleSheetsAccessToken() }
      );
      if (batch.rows.length > 50) {
        throw new CliError({ failureType: "INPUT_TOO_LARGE", message: "At most 50 rows may be reconciled per invocation" });
      }

      const reconciliation = await withDatabase(runtime, async ({ db }) => {
        const results: Array<Record<string, unknown>> = [];
        const writeResults: Array<{ rowNumber: number; result: string }> = [];
        for (const row of batch.rows) {
          const intent = await findPostIntentForTracking(db, {
            logicalShopId: options.shopId,
            orderId: row.orderId,
            tracking: row.tracking,
            region
          });
          if (!intent) {
            results.push({ rowNumber: row.rowNumber, status: "PAUSED", reason: "INTENT_NOT_FOUND" });
            continue;
          }
          if (intent.status === "PENDING" || intent.status === "IN_PROGRESS") {
            results.push({ rowNumber: row.rowNumber, status: "DEFERRED", intentStatus: intent.status, attemptCount: intent.attemptCount });
            continue;
          }

          if (intent.status === "CONFIRMED" || intent.status === "FAILED" || intent.status === "ABORTED") {
            const account = await findCotikAccountById(db, intent.accountId);
            const token = account?.status === "ACTIVE" ? await getDecryptedCotikToken(db, intent.accountId) : null;
            if (!token) {
              results.push({ rowNumber: row.rowNumber, status: "PAUSED", reason: "ACCOUNT_TOKEN_UNAVAILABLE" });
              continue;
            }
            const client = createMultiAccountCotikClient({ accountId: intent.accountId, token });
            const confirmed = await confirmOrderTrackingReadback(client, intent.orderId, intent.tracking);
            if (intent.status === "CONFIRMED") {
              if (!confirmed) {
                results.push({ rowNumber: row.rowNumber, status: "PAUSED", reason: "READBACK_NOT_CONFIRMED", attemptCount: intent.attemptCount });
                continue;
              }
              const result = `CONFIRMED | READBACK=OK | ATTEMPTS=${intent.attemptCount}`;
              writeResults.push({ rowNumber: row.rowNumber, result });
              results.push({ rowNumber: row.rowNumber, status: "CONFIRMED", readback: "OK", attemptCount: intent.attemptCount });
              continue;
            }

            const readback = confirmed ? "CONFLICT" : "NOT_CONFIRMED";
            const result = `${intent.status} | READBACK=${readback} | ATTEMPTS=${intent.attemptCount}`;
            writeResults.push({ rowNumber: row.rowNumber, result });
            results.push({ rowNumber: row.rowNumber, status: intent.status, readback, attemptCount: intent.attemptCount });
            continue;
          }
        }
        return { results, writeResults };
      });

      const writeback = reconciliation.writeResults.length === 0
        ? []
        : await writeCotikTrackingSheetResults(
            { spreadsheetId: options.spreadsheetId, tabTitle: options.tab, results: reconciliation.writeResults },
            { accessToken: requireGoogleSheetsAccessToken() }
          );
      const payload = {
        schemaVersion: "cotik-tracking-reconcile-sheet-date.v1",
        targetDate: options.targetDate,
        rowsRead: batch.rows.length + batch.skippedRows.length,
        rowsEligible: batch.rows.length,
        rowsSkipped: batch.skippedRows.length,
        writeCandidates: reconciliation.writeResults.length,
        writeback,
        skipped: batch.skippedRows.map(({ rowNumber, reason }) => ({ rowNumber, reason })),
        results: reconciliation.results
      };
      if (options.json === true) printJson(payload);
      else printKeyValues([
        ["Rows Read", String(payload.rowsRead)],
        ["Rows Eligible", String(payload.rowsEligible)],
        ["Write Candidates", String(payload.writeCandidates)],
        ["Written", String(writeback.filter((result) => result.status === "WRITTEN").length)]
      ]);
    });

  cotikTracking
    .command("sync")
    .description("Trigger manual multi-account sync")
    .option("--discovery", "Run discovery sync across all active accounts")
    .option("--orders", "Run order sync across discovered shops")
    .option("--reconcile", "Run reconcile order sync (covers 2 months)")
    .option("--json")
    .action(
      async (options: JsonOption & {
        discovery?: boolean | undefined;
        orders?: boolean | undefined;
        reconcile?: boolean | undefined;
      }) => {
        await withDatabase(runtime, async (context) => {
          if (options.discovery) {
            const discResult = await runCotikDiscoverySync({ context });
            if (options.json === true) {
              printJson({ schemaVersion: "cotik-manual-discovery.v1", result: discResult });
            } else {
              printKeyValues([
                ["Accounts Processed", String(discResult.accountsProcessed)],
                ["Shops Discovered", String(discResult.shopsDiscovered)],
                ["Accounts Failed", String(discResult.accountsFailed)]
              ]);
            }
          }

          if (options.orders || options.reconcile) {
            const mode = options.reconcile ? "reconcile" : "incremental";
            const ordersResult = await runCotikMultiAccountOrdersSync({
              context,
              mode
            });
            if (options.json === true) {
              printJson({ schemaVersion: "cotik-manual-orders.v1", result: ordersResult });
            } else {
              printKeyValues([
                ["Mode", ordersResult.mode],
                ["Accounts Processed", String(ordersResult.accountsProcessed)],
                ["Observations Read", String(ordersResult.totalObservationsRead)],
                ["Orders Projected", String(ordersResult.totalOrdersProjected)]
              ]);
            }
          }
        });
      }
    );
}
