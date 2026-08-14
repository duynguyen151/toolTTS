#!/usr/bin/env node
import "dotenv/config";

import { Command } from "commander";

import { registerDataCommands } from "./commands/data.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerShopCommands } from "./commands/shop.js";
import { registerSyncExecutionCommands } from "./commands/sync.js";
import { registerRiskCommands } from "./commands/risk.js";
import { loadConfig } from "./config.js";
import { printError } from "./presentation/error.js";
import { createCliRuntime } from "./runtime.js";
import { toCliErrorPayload } from "./errors.js";

const program = new Command();
const runtime = createCliRuntime(loadConfig());

program
  .name("shop-health")
  .description("TikTok Shop Seller Center health collector and deterministic KPI CLI")
  .version("0.1.0")
  .showHelpAfterError();

registerDoctorCommand(program, runtime);
registerShopCommands(program, runtime);
registerDataCommands(program, runtime);
registerSyncExecutionCommands(program, runtime);
registerRiskCommands(program, runtime);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const json = process.argv.includes("--json");
  printError(toCliErrorPayload(error), json);
  process.exitCode = 1;
}
