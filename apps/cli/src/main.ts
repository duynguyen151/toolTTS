import { Command } from "commander";

import { registerAiTaskCommands } from "./commands/ai-task.js";
import { registerDataCommands } from "./commands/data.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerReviewCommands } from "./commands/review.js";
import { registerProfileCommands } from "./commands/profile.js";
import { registerPolicyCommands } from "./commands/policy.js";
import { registerRiskCommands } from "./commands/risk.js";
import { registerShopCommands } from "./commands/shop.js";
import { registerSyncExecutionCommands } from "./commands/sync.js";
import { loadConfig, loadWorkspaceEnvironment } from "./config.js";
import { toCliErrorPayload } from "./errors.js";
import { printError } from "./presentation/error.js";
import { createCliDecisionWorkflow } from "./review-workflow.js";
import { createCliRuntime } from "./runtime.js";

const program = new Command();
loadWorkspaceEnvironment();
const runtime = createCliRuntime(loadConfig());
const decisionWorkflow = createCliDecisionWorkflow(runtime);

program
  .name("shop-health")
  .description("TikTok Shop Seller Center health collector and deterministic KPI CLI")
  .version("0.1.0")
  .showHelpAfterError();

registerDoctorCommand(program, runtime);
registerShopCommands(program, runtime);
registerProfileCommands(program, runtime);
registerPolicyCommands(program, runtime);
registerAiTaskCommands(program, runtime);
registerDataCommands(program, runtime);
registerSyncExecutionCommands(program, runtime);
registerRiskCommands(program, runtime);
registerReviewCommands(program, decisionWorkflow, {
  timeZone: runtime.config.DISPLAY_TIME_ZONE,
});

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const json = process.argv.includes("--json");
  printError(toCliErrorPayload(error), json);
  process.exitCode = 1;
}
