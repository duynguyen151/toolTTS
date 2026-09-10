import {
  ensureCotikWorkflowSettings,
  listProviderCatalog,
  seedProviderCatalog,
  setCotikWorkflowSettings
} from "@shop-health/db";
import {
  runCotikDiscoverySync,
  runCotikMultiAccountOrdersSync,
  stageCotikTracking
} from "@shop-health/sync";
import type { Command } from "commander";

import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import {
  createAutoTrackingCapability,
  reconcileAutoTrackingSheet,
  stageAutoTrackingSheet,
  type AutoTrackingSheetInput
} from "../cotik-tracking-workflow.js";
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

function parseUsRegion(value: string): "US" {
  const region = parseRegion(value);
  if (region !== "US") {
    throw new CliError({ failureType: "INVALID_ARGUMENT", message: "This V1 Sheet workflow supports region US only" });
  }
  return region;
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
          ["Active Deploy Version", settings.deploymentId ?? "(none)"],
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
        if (options.json === true) printJson({ schemaVersion: "cotik-tracking-stage.v1", result });
        else printKeyValues(result.status === "STAGED"
          ? [["Status", result.status], ["Candidate ID", result.candidateId], ["Intent ID", result.intentId]]
          : [["Status", result.status], ["Reason", result.reason]]);
      });

  cotikTracking
    .command("stage-sheet-date")
    .requiredOption("--spreadsheet-id <spreadsheetId>")
    .requiredOption("--tab <tabTitle>")
    .requiredOption("--range <range>")
    .requiredOption("--region <region>")
    .option("--target-date <YYYY-MM-DD>", "Select exactly one date")
    .option("--from-date <YYYY-MM-DD>", "Select rows on or after this date")
    .option("--date-format <format>", "Interpret slash dates as MDY or DMY")
    .option("--json")
    .action(async (options: JsonOption & {
      spreadsheetId: string;
      tab: string;
      range: string;
      region: string;
      targetDate?: string | undefined;
      fromDate?: string | undefined;
      dateFormat?: string | undefined;
      }) => {
        const region = parseUsRegion(options.region);
        const payload = await stageAutoTrackingSheet(runtime, {
          spreadsheetId: options.spreadsheetId,
          tab: options.tab,
          range: options.range,
          region,
          ...(options.targetDate === undefined ? {} : { targetDate: options.targetDate }),
          ...(options.fromDate === undefined ? {} : { fromDate: options.fromDate }),
          ...(options.dateFormat === undefined ? {} : { dateFormat: options.dateFormat as "MDY" | "DMY" })
        });
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
    .requiredOption("--region <region>")
    .option("--target-date <YYYY-MM-DD>", "Select exactly one date")
    .option("--from-date <YYYY-MM-DD>", "Select rows on or after this date")
    .option("--date-format <format>", "Interpret slash dates as MDY or DMY")
    .option("--json")
    .action(async (options: JsonOption & {
      spreadsheetId: string;
      tab: string;
      range: string;
      region: string;
      targetDate?: string | undefined;
      fromDate?: string | undefined;
      dateFormat?: string | undefined;
      }) => {
        const region = parseUsRegion(options.region);
        const payload = await reconcileAutoTrackingSheet(runtime, {
          spreadsheetId: options.spreadsheetId,
          tab: options.tab,
          range: options.range,
          region,
          ...(options.targetDate === undefined ? {} : { targetDate: options.targetDate }),
          ...(options.fromDate === undefined ? {} : { fromDate: options.fromDate }),
          ...(options.dateFormat === undefined ? {} : { dateFormat: options.dateFormat as "MDY" | "DMY" })
        });
      if (options.json === true) printJson(payload);
      else printKeyValues([
        ["Rows Read", String(payload.rowsRead)],
        ["Rows Eligible", String(payload.rowsEligible)],
        ["Write Candidates", String(payload.writeCandidates)],
        ["Written", String(payload.writeback.filter((result) => result.status === "WRITTEN").length)]
      ]);
    });

  cotikTracking
    .command("capability")
    .description("Invoke the stable auto-tracking capability without changing its safety controls")
    .requiredOption("--action <action>", "status, execute, or stop")
    .option("--spreadsheet-id <spreadsheetId>")
    .option("--tab <tabTitle>")
    .option("--range <range>")
    .option("--region <region>")
    .option("--target-date <YYYY-MM-DD>")
    .option("--from-date <YYYY-MM-DD>")
    .option("--date-format <format>")
    .option("--json")
    .action(async (options: JsonOption & {
      action: string;
      spreadsheetId?: string | undefined;
      tab?: string | undefined;
      range?: string | undefined;
      region?: string | undefined;
      targetDate?: string | undefined;
      fromDate?: string | undefined;
      dateFormat?: string | undefined;
    }) => {
      const capability = createAutoTrackingCapability(runtime);
      let response;
      if (options.action === "status") {
        response = await capability.status();
      } else if (options.action === "stop") {
        response = await capability.stop();
      } else if (options.action === "execute") {
        const required = [
          ["--spreadsheet-id", options.spreadsheetId],
          ["--tab", options.tab],
          ["--range", options.range],
          ["--region", options.region]
        ] as const;
        const missing = required.find(([, value]) => value === undefined || value.trim().length === 0);
        if (missing) throw new CliError({ failureType: "INVALID_ARGUMENT", message: `${missing[0]} is required for execute` });
        const region = parseUsRegion(options.region!);
        const input: AutoTrackingSheetInput = {
          spreadsheetId: options.spreadsheetId!,
          tab: options.tab!,
          range: options.range!,
          region,
          ...(options.targetDate === undefined ? {} : { targetDate: options.targetDate }),
          ...(options.fromDate === undefined ? {} : { fromDate: options.fromDate }),
          ...(options.dateFormat === undefined ? {} : { dateFormat: options.dateFormat as "MDY" | "DMY" })
        };
        response = await capability.execute(input);
      } else {
        throw new CliError({ failureType: "INVALID_ARGUMENT", message: "action must be status, execute, or stop" });
      }
      if (options.json === true) {
        printJson(response);
      } else if (response.action === "execute") {
        printKeyValues([
          ["Action", response.action],
          ["Rows Staged", String(response.stage.rowsStaged)],
          ["Worker Status", response.worker.status],
          ["Batches Executed", String(response.worker.trackingBatchesExecuted ?? 0)],
          ["Orders Confirmed", String(response.worker.trackingOrdersConfirmed ?? 0)],
          ...(response.worker.message === undefined ? [] : [["Message", response.worker.message] as const]),
          ["Rows Written", String(response.reconcile.writeback.filter((result) => result.status === "WRITTEN").length)]
        ]);
      } else {
        printKeyValues([
          ["Action", response.action],
          ["Cotik Sync Enabled", response.settings.cotikSyncEnabled ? "ON" : "OFF"],
          ["Cotik POST Enabled", response.settings.cotikPostEnabled ? "ON" : "OFF"]
        ]);
      }
    });

  cotikTracking
    .command("sync")
    .description("Trigger manual multi-account sync")
    .option("--discovery", "Run discovery sync across all active accounts")
    .option("--orders", "Run order sync across discovered shops")
    .option("--reconcile", "Run reconcile order sync (covers 2 months)")
    .option("--account-id <id>", "Limit sync to one Cotik account")
    .option("--json")
    .action(
      async (options: JsonOption & {
        discovery?: boolean | undefined;
        orders?: boolean | undefined;
        reconcile?: boolean | undefined;
        accountId?: string | undefined;
      }) => {
        await withDatabase(runtime, async (context) => {
          if (options.discovery) {
            const discResult = await runCotikDiscoverySync({ context, accountId: options.accountId });
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
              mode,
              accountId: options.accountId
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
