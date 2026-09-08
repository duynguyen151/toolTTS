import fs from "node:fs";

import {
  createCotikAccount,
  deleteCotikAccount,
  findCotikAccountById,
  listCotikAccounts,
  updateCotikAccountStatus
} from "@shop-health/db";
import type { Command } from "commander";

import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import { formatDate, printJson, printKeyValues, printTable } from "../presentation/output.js";
import type { CliRuntime } from "../runtime.js";

/**
 * Resolve token from --token or --token-file, with deprecation warning for --token.
 */
function resolveToken(options: { token?: string; tokenFile?: string }): string {
  if (options.tokenFile) {
    const tokenPath = options.tokenFile.trim();
    if (!fs.existsSync(tokenPath)) {
      throw new CliError({
        failureType: "INVALID_INPUT",
        message: `Token file not found: ${tokenPath}`
      });
    }
    const content = fs.readFileSync(tokenPath, "utf-8").trim();
    if (!content) {
      throw new CliError({
        failureType: "INVALID_INPUT",
        message: "Token file is empty"
      });
    }
    return content;
  }

  if (options.token) {
    console.error("WARNING: --token passes the secret via command line argument, which may be visible in shell history. Use --token-file instead.");
    return options.token;
  }

  throw new CliError({
    failureType: "INVALID_INPUT",
    message: "Either --token or --token-file is required"
  });
}

function resolveVaultKeyVersion(rawVersion?: string): number | undefined {
  if (rawVersion === undefined) return undefined;
  const cleanVersion = rawVersion.trim();
  if (!/^[1-9]\d*$/.test(cleanVersion)) {
    throw new CliError({
      failureType: "INVALID_INPUT",
      message: "Vault key version must be a positive integer"
    });
  }

  const version = Number(cleanVersion);
  if (!Number.isSafeInteger(version)) {
    throw new CliError({
      failureType: "INVALID_INPUT",
      message: "Vault key version must be a positive integer"
    });
  }
  return version;
}

interface JsonOption {
  readonly json?: boolean | undefined;
}

export function registerCotikAccountCommands(program: Command, runtime: CliRuntime): void {
  const cotikAccount = program
    .command("cotik-accounts")
    .description("Manage Cotik multi-account credentials and operational health");

  cotikAccount
    .command("add")
    .requiredOption("--name <name>", "Display name for the account")
    .option("--token <token>", "Cotik API token (WARNING: visible in shell history, prefer --token-file)")
    .option("--token-file <path>", "Path to file containing Cotik API token (recommended)")
    .option("--priority <priority>", "Account priority integer", "0")
    .option("--key-version <version>", "Vault key version override; key id comes from server environment")
    .option("--json")
    .action(
      async (options: {
        name: string;
        token?: string;
        tokenFile?: string;
        priority: string;
        keyVersion?: string;
        json?: boolean | undefined;
      }) => {
        const token = resolveToken(options);
        const keyVersion = resolveVaultKeyVersion(options.keyVersion);
        const priorityNum = Number.parseInt(options.priority, 10);
        const priority = Number.isFinite(priorityNum) ? priorityNum : 0;

        const created = await withDatabase(runtime, async ({ db }) => {
          const account = await createCotikAccount(db, {
            displayName: options.name,
            priority,
            status: "ACTIVE",
            token,
            ...(keyVersion === undefined ? {} : { version: keyVersion })
          });
          return account;
        });

        // Zero token leakage: only output safe metadata
        if (options.json === true) {
          printJson({
            schemaVersion: "cotik-account.v1",
            account: {
              id: created.id,
              displayName: created.displayName,
              status: created.status,
              priority: created.priority
            }
          });
        } else {
          printKeyValues([
            ["Account ID", created.id],
            ["Display Name", created.displayName],
            ["Status", created.status],
            ["Priority", String(created.priority)],
            ["Vault Storage", "ENCRYPTED (AES-256-GCM)"]
          ]);
        }
      }
    );

  cotikAccount
    .command("list")
    .option("--json")
    .action(async (options: JsonOption) => {
      const accounts = await withDatabase(runtime, ({ db }) => listCotikAccounts(db));

      // Never expose secret/token values in JSON or table
      if (options.json === true) {
        printJson({
          schemaVersion: "cotik-account-list.v1",
          accounts: accounts.map((a) => ({
            id: a.id,
            displayName: a.displayName,
            status: a.status,
            priority: a.priority,
            lastSeenAt: a.lastSeenAt
          }))
        });
      } else {
        printTable(
          ["ID", "NAME", "STATUS", "PRIORITY", "LAST SEEN"],
          accounts.map((a) => [
            a.id,
            a.displayName,
            a.status,
            String(a.priority),
            formatDate(a.lastSeenAt, runtime.config.DISPLAY_TIME_ZONE)
          ])
        );
      }
    });

  cotikAccount
    .command("health <id>")
    .option("--json")
    .action(async (id: string, options: JsonOption) => {
      const account = await withDatabase(runtime, ({ db }) => findCotikAccountById(db, id));
      if (!account) {
        throw new CliError({
          failureType: "ACCOUNT_NOT_FOUND",
          message: `Cotik account ${id} was not found`
        });
      }

      if (options.json === true) {
        printJson({
          schemaVersion: "cotik-account-health.v1",
          account: {
            id: account.id,
            displayName: account.displayName,
            status: account.status,
            priority: account.priority,
            lastSeenAt: account.lastSeenAt
          }
        });
      } else {
        printKeyValues([
          ["ID", account.id],
          ["Name", account.displayName],
          ["Operational Status", account.status],
          ["Priority", String(account.priority)],
          ["Last Seen", formatDate(account.lastSeenAt, runtime.config.DISPLAY_TIME_ZONE)]
        ]);
      }
    });

  cotikAccount
    .command("disable <id>")
    .option("--json")
    .action(async (id: string, options: JsonOption) => {
      const updated = await withDatabase(runtime, async ({ db }) => {
        const account = await findCotikAccountById(db, id);
        if (!account) {
          throw new CliError({
            failureType: "ACCOUNT_NOT_FOUND",
            message: `Cotik account ${id} was not found`
          });
        }
        return await updateCotikAccountStatus(db, id, "DISABLED");
      });

      if (options.json === true) {
        printJson({ schemaVersion: "cotik-account-status.v1", account: updated });
      } else {
        printKeyValues([
          ["ID", updated?.id ?? id],
          ["Status", updated?.status ?? "DISABLED"]
        ]);
      }
    });

  cotikAccount
    .command("remove <id>")
    .option("--json")
    .action(async (id: string, options: JsonOption) => {
      const result = await withDatabase(runtime, async ({ db }) => {
        try {
          await deleteCotikAccount(db, id);
          return { action: "HARD_DELETED" as const };
        } catch (error) {
          // RESTRICT FK prevents deletion when audit records exist
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes("violates foreign key constraint") || msg.includes("RESTRICT")) {
            await updateCotikAccountStatus(db, id, "DISABLED");
            return { action: "SOFT_DISABLED" as const };
          }
          throw error;
        }
      });

      if (options.json === true) {
        printJson({ schemaVersion: "cotik-account-delete.v1", deletedId: id, action: result.action });
      } else {
        if (result.action === "SOFT_DISABLED") {
          printKeyValues([
            ["Account ID", id],
            ["Status", "DISABLED (audit records preserved)"]
          ]);
        } else {
          printKeyValues([
            ["Deleted ID", id],
            ["Status", "REMOVED"]
          ]);
        }
      }
    });
}
