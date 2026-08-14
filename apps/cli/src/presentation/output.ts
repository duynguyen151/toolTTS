import Table from "cli-table3";

export interface OutputOptions {
  readonly json?: boolean;
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printKeyValues(rows: ReadonlyArray<readonly [string, string]>): void {
  const table = new Table({
    chars: {
      top: "",
      "top-mid": "",
      "top-left": "",
      "top-right": "",
      bottom: "",
      "bottom-mid": "",
      "bottom-left": "",
      "bottom-right": "",
      left: "",
      "left-mid": "",
      mid: "",
      "mid-mid": "",
      right: "",
      "right-mid": "",
      middle: " "
    },
    style: { "padding-left": 0, "padding-right": 2 }
  });

  for (const [label, value] of rows) {
    table.push([label, value]);
  }
  process.stdout.write(`${table.toString()}\n`);
}

export function printTable(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string>>): void {
  const table = new Table({ head: [...headers] });
  for (const row of rows) {
    table.push([...row]);
  }
  process.stdout.write(`${table.toString()}\n`);
}

export function formatDate(value: Date | string | null, timeZone: string): string {
  if (value === null) return "-";
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

export function formatMoney(amount: string | null, currency: string | null): string {
  if (amount === null) return "-";
  if (currency === null) return amount;
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `${amount} ${currency}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(numeric);
}

export function formatPercent(value: number | null): string {
  if (value === null) return "-";
  return `${(value * 100).toFixed(1)}%`;
}
