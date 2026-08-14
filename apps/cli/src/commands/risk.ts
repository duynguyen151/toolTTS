import { findShopByProfileNo } from "@shop-health/db";
import type { Command } from "commander";

import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import { formatDate, formatMoney, formatPercent, printJson, printKeyValues } from "../presentation/output.js";
import { evaluateShopRisk } from "../risk-service.js";
import type { CliRuntime } from "../runtime.js";

export function registerRiskCommands(program: Command, runtime: CliRuntime): void {
  const risk = program.command("risk").description("Evaluate deterministic Holiday Mode risk rules");
  risk.command("evaluate <profileNo>")
    .option("--json")
    .action(async (profileNo: string, options: { json?: boolean }) => {
      const evaluation = await withDatabase(runtime, async (context) => {
        const shop = await findShopByProfileNo(context.db, profileNo);
        if (shop === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${profileNo} is not configured` });
        return evaluateShopRisk(context, shop);
      });
      const { decision } = evaluation;
      if (options.json === true) {
        printJson({
          schemaVersion: "risk-control.v2",
          profileNo,
          mode: "DRY_RUN",
          historyMode: decision.historyMode,
          dataCoverage: decision.dataCoverage,
          lastSuccessfulOrderSyncAt: evaluation.lastSuccessfulOrderSyncAt,
          lastSuccessfulObservationAt: decision.lastSuccessfulObservationAt,
          evaluatedAt: evaluation.evaluatedAt,
          decision
        });
        return;
      }
      printKeyValues([
        ["Profile", profileNo],
        ["Mode", "DRY_RUN"],
        ["History Mode", decision.historyMode],
        ["Data Coverage", decision.dataCoverage],
        ["Coverage Note", "All currently persisted records; full shop history is not guaranteed"],
        ["Last Successful Order Sync", formatDate(evaluation.lastSuccessfulOrderSyncAt, runtime.config.DISPLAY_TIME_ZONE)],
        ["Last Successful Observation", formatDate(decision.lastSuccessfulObservationAt, runtime.config.DISPLAY_TIME_ZONE)],
        ["Evaluated At", formatDate(evaluation.evaluatedAt, runtime.config.DISPLAY_TIME_ZONE)],
        ["Total Persisted Orders", String(decision.totalPersistedOrderCount)],
        ["Total Persisted Value", formatMoney(decision.totalPersistedValue, decision.totalPersistedValue === null ? null : decision.currency)],
        ["Operational Onhold Value", formatMoney(decision.onHoldValue, decision.currency)],
        [`Known ${decision.currency} Operational Subtotal`, decision.onHoldValue === null ? formatMoney(decision.onHoldValueKnownPolicyCurrencySubtotal, decision.currency) : "-"],
        ["Operational Onhold Count", decision.onHoldOrderCount === null ? "Unavailable (unknown order statuses present)" : String(decision.onHoldOrderCount)],
        ["Operational Onhold Rate", "Unavailable (Onhold Count and Total Count use the same status set)"],
        ["Delivered Count", decision.deliveredCount === null ? "Unavailable (unknown order statuses present)" : String(decision.deliveredCount)],
        ["Total Count", decision.totalCount === null ? "Unavailable (unknown order statuses present)" : String(decision.totalCount)],
        ["Delivered Rate", formatPercent(decision.deliveryRate)],
        ["Status Coverage", formatPercent(decision.statusCoverage)],
        ["Rule", decision.ruleExpression],
        ["Value Threshold", formatMoney(decision.thresholds.stopOnHoldValueAt, decision.currency)],
        ["Rate Threshold", formatPercent(decision.thresholds.stopDeliveryRateBelow)],
        ["Rule Result", decision.ruleResult],
        ["Triggered By", decision.trigger],
        ["Suggested Operational Action", decision.suggestedOperationalAction],
        ["Internal Desired State", decision.desiredState],
        ["Executed Action", decision.executedAction],
        ["Holiday Mode observed", decision.holidayModeCurrentlyEnabled === null ? "UNKNOWN" : String(decision.holidayModeCurrentlyEnabled)],
        ["Safe cycles", `${decision.consecutiveSafeCycles}/${decision.stableCyclesBeforeResume}`],
        ["Reasons", decision.reasons.length === 0 ? "-" : decision.reasons.join(", ")]
      ]);
    });
}
