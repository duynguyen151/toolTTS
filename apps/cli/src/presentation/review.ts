import type {
  DecisionHistoryPage,
  DecisionReviewView,
  MetricValue,
} from "@shop-health/decision-workflow";

import { formatDate, formatMoney, formatPercent } from "./output.js";

function section(title: string, rows: ReadonlyArray<readonly [string, string]>): string {
  return `${title}\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}`;
}

function metric<T>(
  value: MetricValue<T>,
  format: (available: T) => string = String,
): string {
  return value.status === "AVAILABLE"
    ? format(value.value)
    : `UNAVAILABLE (${value.reason})`;
}

function reviewSections(view: DecisionReviewView, timeZone: string): string[] {
  const aiRows: Array<readonly [string, string]> = [
    ["Availability", view.ai.status],
  ];
  if (view.ai.status === "AVAILABLE") {
    aiRows.push(
      ["Recommendation", view.ai.recommendation],
      ["Confidence", String(view.ai.confidence)],
      ["Reason Codes", view.ai.reasonCodes.join(", ") || "-"],
      ["Reason", view.ai.reason],
      ["Human Review Required", String(view.ai.humanReviewRequired)],
    );
  } else {
    aiRows.push(
      ["Failure Code", view.ai.failureCode],
      ["Human Review Required", String(view.ai.humanReviewRequired)],
    );
  }
  if ("provider" in view.ai) {
    aiRows.push(
      ["Provider", view.ai.provider],
      ["Model", view.ai.model],
      ["Prompt Version", view.ai.promptVersion],
      ["Policy Version", view.ai.policyVersion],
    );
  }

  const baRows: Array<readonly [string, string]> = [["Status", view.ba.status]];
  if (view.ba.status === "DECIDED") {
    baRows.push(
      ["Decision", view.ba.decision],
      ["Confidence", view.ba.confidence === null ? "-" : String(view.ba.confidence)],
      ["Reason Codes", view.ba.reasonCodes.join(", ")],
      ["Note", view.ba.note ?? "-"],
      ["Decided At", formatDate(view.ba.decidedAt, timeZone)],
    );
  }

  const executionRows: Array<readonly [string, string]> = [["Status", view.execution.status]];
  if (view.execution.status === "SIMULATED") {
    executionRows.push(
      ["Requested Action", view.execution.requestedAction],
      ["Mode", view.execution.mode],
      ["Seller Center Called", String(view.execution.sellerCenterCalled)],
      ["Executed At", formatDate(view.execution.executedAt, timeZone)],
    );
  }

  return [
    section("SHOP", [
      ["Profile", view.shop.profileNo],
      ["Name", view.shop.displayName],
      ["Origin", view.shop.dataOrigin],
      ["Data Coverage", view.shop.dataCoverage],
      ["Last Sync", formatDate(view.shop.lastSyncAt, timeZone)],
      ["Case ID", view.case.id],
    ]),
    section("METRICS", [
      ["Total Orders", metric(view.metrics.totalOrders)],
      ["Onhold Value", metric(view.metrics.onHoldValue, ({ amount, currency }) => formatMoney(amount, currency))],
      ["Delivered Count", metric(view.metrics.deliveredCount)],
      ["Delivery Rate", metric(view.metrics.deliveryRate, formatPercent)],
      ["Cancellation Rate", metric(view.metrics.cancellationRate, formatPercent)],
      ["Refund Rate", metric(view.metrics.refundRate, formatPercent)],
    ]),
    section("RULE", [
      ["Decision", view.rule.decision],
      ["Triggers", view.rule.triggers.join(", ") || "NONE"],
      ["Expression", view.rule.expression],
      ["Onhold Threshold", view.rule.thresholds.stopOnHoldValueAt],
      ["Delivery Threshold", formatPercent(view.rule.thresholds.stopDeliveryRateBelow)],
      ["Minimum Orders", String(view.rule.thresholds.minimumOrdersForRateRule)],
      ["Policy Version", view.rule.policyVersion],
    ]),
    section("AI", aiRows),
    section("BA", baRows),
    section("EXECUTION", executionRows),
    section("HISTORY", view.events.length === 0
      ? [["Events", "-"]]
      : view.events.map((event) => [event.type, formatDate(event.occurredAt, timeZone)] as const)),
  ];
}

export function formatDecisionReview(view: DecisionReviewView, timeZone: string): string {
  return `${reviewSections(view, timeZone).join("\n\n")}\n`;
}

export function formatDecisionHistory(page: DecisionHistoryPage, timeZone: string): string {
  if (page.items.length === 0) {
    return "HISTORY\nCases: -\nNext Cursor: -\n";
  }
  const cases = page.items.map((item, index) => {
    const sections = reviewSections(item, timeZone);
    return `CASE ${index + 1}\n${sections.join("\n\n")}`;
  });
  return `HISTORY\nCases: ${page.items.length}\n\n${cases.join("\n\n")}\n\nNext Cursor: ${page.nextCursor ?? "-"}\n`;
}
