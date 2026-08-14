import type { ShopReport } from "@shop-health/domain";

import { formatMoney, formatPercent, printKeyValues } from "./output.js";

function number(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function printShopReport(report: ShopReport): void {
  const current = report.metrics.current;
  process.stdout.write(`SHOP: ${report.shop.profileNo} / ${report.shop.displayName ?? "-"}\n`);
  process.stdout.write(`DATA STATUS: ${report.dataStatus}\n`);
  process.stdout.write(`PERIOD: ${report.period.label}\n\n`);

  process.stdout.write("ORDERS\n");
  printKeyValues([
    ["Total Orders", number(current.orders.total)],
    ["Awaiting Shipment", number(current.orders.awaitingShipment)],
    ["In Transit", number(current.orders.inTransit)],
    ["Delivered/Completed", number(current.orders.deliveredOrCompleted)],
    ["Canceled", number(current.orders.canceled)],
    ["Refunded", number(current.orders.refunded)]
  ]);

  process.stdout.write("\nSALES\n");
  printKeyValues([
    ["Booked Sales", formatMoney(current.bookedSales.value, current.bookedSales.currency)],
    ["Gross Valid Sales", formatMoney(current.grossValidSales.value, current.grossValidSales.currency)],
    ["Refunded Amount", formatMoney(current.refundedAmount.value, current.refundedAmount.currency)],
    ["Net Sales", formatMoney(current.netSales.value, current.netSales.currency)],
    ["Settled Cash", formatMoney(current.settledCash.value, current.settledCash.currency)]
  ]);

  process.stdout.write("\nRISK\n");
  printKeyValues([
    ["Cancellation Rate", formatPercent(current.cancellationRate.value)],
    ["Refund Rate", formatPercent(current.refundRate.value)],
    ["On Hold Order Rate", formatPercent(current.onHoldOrderRate.value)],
    ["On Hold Money Rate", formatPercent(current.onHoldMoneyRate.value)],
    ["Settlement Rate", formatPercent(current.settlementRate.value)]
  ]);

  process.stdout.write("\nHEALTH\n");
  printKeyValues([
    ["Score", report.health.score === null ? "-" : `${report.health.score.toFixed(1)}/100`],
    ["Confidence", formatPercent(report.health.confidence)],
    ["Recommendation", report.health.recommendation ?? "-"],
    ["Warnings", report.health.warnings.length === 0 ? "-" : report.health.warnings.join(", ")]
  ]);
}
