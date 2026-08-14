import { CliError } from "./errors.js";

export interface ComparisonPeriod {
  readonly label: string;
  readonly currentStart: Date;
  readonly currentEnd: Date;
  readonly previousStart: Date;
  readonly previousEnd: Date;
}

export function parseComparisonPeriod(period: string, now = new Date()): ComparisonPeriod {
  const match = /^(\d+)d$/.exec(period);
  if (match === null) {
    throw new CliError({
      failureType: "INVALID_PERIOD",
      message: "Period must use the form Nd, for example 30d"
    });
  }

  const days = Number(match[1]);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new CliError({
      failureType: "INVALID_PERIOD",
      message: "Period must be between 1d and 3650d"
    });
  }

  const durationMs = days * 24 * 60 * 60 * 1000;
  const currentEnd = now;
  const currentStart = new Date(currentEnd.getTime() - durationMs);
  const previousEnd = currentStart;
  const previousStart = new Date(previousEnd.getTime() - durationMs);
  return {
    label: `Last ${days} days vs previous ${days} days`,
    currentStart,
    currentEnd,
    previousStart,
    previousEnd
  };
}
