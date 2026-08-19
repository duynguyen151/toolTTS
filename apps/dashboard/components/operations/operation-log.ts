const MAX_OPERATION_LOG_ENTRIES = 200;

export type OperationLogLevel = "info" | "warn" | "error";

export interface OperationLogEntry {
  readonly timestamp: string;
  readonly level: OperationLogLevel;
  readonly state: string;
  readonly message: string;
}

export interface CreateOperationLogEntryInput {
  readonly timestamp: string;
  readonly state: string;
  readonly message: string;
}

export function createOperationLogEntry(input: CreateOperationLogEntryInput): OperationLogEntry {
  return {
    timestamp: input.timestamp,
    level: levelForState(input.state),
    state: input.state,
    message: sanitizeOperationMessage(input.message),
  };
}

export function appendOperationLog(
  entries: readonly OperationLogEntry[],
  entry: OperationLogEntry,
): readonly OperationLogEntry[] {
  return [...entries, entry].slice(-MAX_OPERATION_LOG_ENTRIES);
}

export function formatOperationLogText(entries: readonly OperationLogEntry[]): string {
  return entries.map((entry) => (
    `${entry.timestamp} [${entry.level}] ${entry.state}: ${entry.message}\n`
  )).join("");
}

function levelForState(state: string): OperationLogLevel {
  if (state === "ERROR") return "error";
  if (state === "PARTIAL" || state.endsWith("_REQUIRED")) return "warn";
  return "info";
}

function sanitizeOperationMessage(message: string): string {
  const withoutQueryStrings = message.replace(/https?:\/\/[^\s]+/g, (value) => {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "[redacted URL]";
    }
  });
  return withoutQueryStrings
    .split(/\s+(?:with\s+)?(?:cookie|cookies|token|authorization|storage|cdp(?:endpoint)?|user_id|buyer)\b/i)[0]!
    .trim();
}
