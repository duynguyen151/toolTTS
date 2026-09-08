import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCotikAccount: vi.fn(),
  setCotikAccountToken: vi.fn(),
  listCotikAccounts: vi.fn(),
  findCotikAccountById: vi.fn(),
  updateCotikAccountStatus: vi.fn(),
  deleteCotikAccount: vi.fn(),
  printJson: vi.fn(),
  printKeyValues: vi.fn(),
  printTable: vi.fn()
}));

vi.mock("@shop-health/db", () => ({
  createCotikAccount: mocks.createCotikAccount,
  setCotikAccountToken: mocks.setCotikAccountToken,
  listCotikAccounts: mocks.listCotikAccounts,
  findCotikAccountById: mocks.findCotikAccountById,
  updateCotikAccountStatus: mocks.updateCotikAccountStatus,
  deleteCotikAccount: mocks.deleteCotikAccount
}));

vi.mock("../presentation/output.js", () => ({
  formatDate: () => "2026-09-07 12:00:00",
  printJson: mocks.printJson,
  printKeyValues: mocks.printKeyValues,
  printTable: mocks.printTable
}));

vi.mock("../db-runtime.js", () => ({
  withDatabase: async (
    _runtime: unknown,
    operation: (context: { db: object }) => Promise<unknown>
  ) => operation({ db: {} })
}));

import { registerCotikAccountCommands } from "./cotik-accounts.js";
import type { CliRuntime } from "../runtime.js";

const dummyRuntime = {
  config: { DISPLAY_TIME_ZONE: "UTC" }
} as unknown as CliRuntime;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cotik-accounts CLI commands", () => {
  it("adds an account with its token in the atomic persistence call", async () => {
    const program = new Command();
    registerCotikAccountCommands(program, dummyRuntime);

    mocks.createCotikAccount.mockResolvedValue({
      id: "acc-123",
      displayName: "Test Acc",
      status: "ACTIVE",
      priority: 5
    });
    mocks.setCotikAccountToken.mockResolvedValue({});

    await program.parseAsync([
      "node",
      "cli",
      "cotik-accounts",
      "add",
      "--name",
      "Test Acc",
      "--token",
      "super-secret-token",
      "--priority",
      "5"
    ]);

    expect(mocks.createCotikAccount).toHaveBeenCalledWith(expect.anything(), {
      displayName: "Test Acc",
      priority: 5,
      status: "ACTIVE",
      token: "super-secret-token"
    });
    expect(mocks.setCotikAccountToken).not.toHaveBeenCalled();

    // Verify output was called and did NOT contain the secret token
    expect(mocks.printKeyValues).toHaveBeenCalledWith([
      ["Account ID", "acc-123"],
      ["Display Name", "Test Acc"],
      ["Status", "ACTIVE"],
      ["Priority", "5"],
      ["Vault Storage", "ENCRYPTED (AES-256-GCM)"]
    ]);
  });

  it("forwards an explicit vault key version while keeping key selection server-side", async () => {
    const program = new Command();
    registerCotikAccountCommands(program, dummyRuntime);
    mocks.createCotikAccount.mockResolvedValue({
      id: "acc-123",
      displayName: "Test Acc",
      status: "ACTIVE",
      priority: 5
    });

    await program.parseAsync([
      "node",
      "cli",
      "cotik-accounts",
      "add",
      "--name",
      "Test Acc",
      "--token",
      "super-secret-token",
      "--key-version",
      "2"
    ]);

    expect(mocks.createCotikAccount).toHaveBeenCalledWith(expect.anything(), {
      displayName: "Test Acc",
      priority: 0,
      status: "ACTIVE",
      token: "super-secret-token",
      version: 2
    });
  });

  it("lists accounts without secret tokens", async () => {
    const program = new Command();
    registerCotikAccountCommands(program, dummyRuntime);

    mocks.listCotikAccounts.mockResolvedValue([
      {
        id: "acc-1",
        displayName: "Account 1",
        status: "ACTIVE",
        priority: 0,
        lastSeenAt: new Date()
      }
    ]);

    await program.parseAsync(["node", "cli", "cotik-accounts", "list"]);

    expect(mocks.printTable).toHaveBeenCalledWith(
      ["ID", "NAME", "STATUS", "PRIORITY", "LAST SEEN"],
      [["acc-1", "Account 1", "ACTIVE", "0", "2026-09-07 12:00:00"]]
    );
  });

  it("checks account health status", async () => {
    const program = new Command();
    registerCotikAccountCommands(program, dummyRuntime);

    mocks.findCotikAccountById.mockResolvedValue({
      id: "acc-1",
      displayName: "Account 1",
      status: "TOKEN_EXPIRED",
      priority: 0,
      lastSeenAt: new Date()
    });

    await program.parseAsync(["node", "cli", "cotik-accounts", "health", "acc-1"]);

    expect(mocks.printKeyValues).toHaveBeenCalledWith([
      ["ID", "acc-1"],
      ["Name", "Account 1"],
      ["Operational Status", "TOKEN_EXPIRED"],
      ["Priority", "0"],
      ["Last Seen", "2026-09-07 12:00:00"]
    ]);
  });
});
