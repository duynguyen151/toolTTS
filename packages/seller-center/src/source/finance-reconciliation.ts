import type { RawStatementOrder, StatementStatResponse } from "../extractors/schemas.js";
import { SellerCenterError } from "../errors.js";

interface ExactDecimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

export function assertOnHoldReconciled(
  response: StatementStatResponse,
  rows: readonly RawStatementOrder[],
): void {
  const summary = response.data.to_settle_amount_stat;
  const officialTotal = summary?.amount;
  const breakdown = summary?.reasons_detail;
  if (!officialTotal?.amount || !officialTotal.currency || !breakdown?.length) {
    reconciliationFailed("official amount or reason breakdown is unavailable");
  }

  const currency = normalizedCurrency(officialTotal.currency);
  const officialByReason = new Map<string, ExactDecimal>();
  for (const detail of breakdown) {
    if (detail.reason === undefined || !detail.amount?.amount || !detail.amount.currency) {
      reconciliationFailed("official reason breakdown is incomplete");
    }
    assertCurrency(currency, detail.amount.currency);
    addAmount(officialByReason, String(detail.reason), detail.amount.amount);
  }

  const collectedByReason = new Map<string, ExactDecimal>();
  const seenIds = new Set<string>();
  for (const row of rows) {
    if (seenIds.has(row.statement_detail_id)) {
      reconciliationFailed("duplicate settlement row was collected");
    }
    seenIds.add(row.statement_detail_id);
    assertCurrency(currency, row.settlement_amount.currency);
    addAmount(collectedByReason, String(row.to_settle_reason), row.settlement_amount.amount);
  }

  const officialBreakdownTotal = sumAmounts(officialByReason.values());
  const collectedTotal = sumAmounts(collectedByReason.values());
  const expectedTotal = parseDecimal(officialTotal.amount);
  if (!decimalEquals(officialBreakdownTotal, expectedTotal)) {
    reconciliationFailed("official total does not equal its reason breakdown");
  }
  if (!decimalEquals(collectedTotal, expectedTotal)) {
    reconciliationFailed("collected rows do not equal the official total");
  }

  const reasons = new Set([...officialByReason.keys(), ...collectedByReason.keys()]);
  for (const reason of reasons) {
    const official = officialByReason.get(reason) ?? zeroDecimal();
    const collected = collectedByReason.get(reason) ?? zeroDecimal();
    if (!decimalEquals(official, collected)) {
      reconciliationFailed(`collected rows do not equal official reason ${reason}`);
    }
  }
}

function reconciliationFailed(detail: string): never {
  throw new SellerCenterError(
    "LAYOUT_CHANGED",
    `Finance On hold reconciliation failed: ${detail}`,
  );
}

function normalizedCurrency(value: string): string {
  const currency = value.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) reconciliationFailed("official currency is invalid");
  return currency;
}

function assertCurrency(expected: string, actual: string): void {
  if (normalizedCurrency(actual) !== expected) {
    reconciliationFailed("official and collected currencies differ");
  }
}

function addAmount(target: Map<string, ExactDecimal>, key: string, value: string): void {
  target.set(key, addDecimals(target.get(key) ?? zeroDecimal(), parseDecimal(value)));
}

function parseDecimal(value: string): ExactDecimal {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) reconciliationFailed("amount is not a non-negative decimal");
  const fraction = match[2] ?? "";
  return {
    coefficient: BigInt(`${match[1]}${fraction}`),
    scale: fraction.length,
  };
}

function addDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient: scaleCoefficient(left, scale) + scaleCoefficient(right, scale),
    scale,
  };
}

function sumAmounts(values: Iterable<ExactDecimal>): ExactDecimal {
  let total = zeroDecimal();
  for (const value of values) total = addDecimals(total, value);
  return total;
}

function decimalEquals(left: ExactDecimal, right: ExactDecimal): boolean {
  const scale = Math.max(left.scale, right.scale);
  return scaleCoefficient(left, scale) === scaleCoefficient(right, scale);
}

function scaleCoefficient(value: ExactDecimal, scale: number): bigint {
  return value.coefficient * (10n ** BigInt(scale - value.scale));
}

function zeroDecimal(): ExactDecimal {
  return { coefficient: 0n, scale: 0 };
}
