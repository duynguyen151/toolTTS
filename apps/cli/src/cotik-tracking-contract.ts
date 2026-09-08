import type { AutoTrackingSheetInput } from "./cotik-tracking-workflow.js";

export type AutoTrackingRequest =
  | { readonly action: "status" }
  | { readonly action: "stop" }
  | { readonly action: "execute"; readonly input: AutoTrackingSheetInput };

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function parseAutoTrackingRequest(raw: string): AutoTrackingRequest {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("request must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const action = requireText(record.action, "action");
  if (action === "status" || action === "stop") return { action };
  if (action !== "execute") throw new Error("action must be status, execute, or stop");

  if (typeof record.input !== "object" || record.input === null || Array.isArray(record.input)) {
    throw new Error("input is required for execute");
  }
  const inputRecord = record.input as Record<string, unknown>;
  const targetDate = inputRecord.targetDate === undefined ? undefined : requireText(inputRecord.targetDate, "input.targetDate");
  const fromDate = inputRecord.fromDate === undefined ? undefined : requireText(inputRecord.fromDate, "input.fromDate");
  if ((targetDate === undefined) === (fromDate === undefined)) {
    throw new Error("exactly one of input.targetDate or input.fromDate is required");
  }
  const dateFormat = inputRecord.dateFormat === undefined ? undefined : requireText(inputRecord.dateFormat, "input.dateFormat");
  if (dateFormat !== undefined && dateFormat !== "MDY" && dateFormat !== "DMY") {
    throw new Error("input.dateFormat must be MDY or DMY");
  }
  const writeback = inputRecord.writeback === undefined ? undefined : inputRecord.writeback;
  if (writeback !== undefined && typeof writeback !== "boolean") {
    throw new Error("input.writeback must be boolean");
  }
  const relay = inputRecord.relay === undefined ? undefined : inputRecord.relay;
  if (relay !== undefined && typeof relay !== "boolean") {
    throw new Error("input.relay must be boolean");
  }
  if (inputRecord.region !== "US") throw new Error("input.region must be US");
  const input: AutoTrackingSheetInput = {
    spreadsheetId: requireText(inputRecord.spreadsheetId, "input.spreadsheetId"),
    tab: requireText(inputRecord.tab, "input.tab"),
    range: requireText(inputRecord.range, "input.range"),
    region: "US",
    ...(targetDate === undefined ? {} : { targetDate }),
    ...(fromDate === undefined ? {} : { fromDate }),
    ...(dateFormat === undefined ? {} : { dateFormat }),
    ...(writeback === undefined ? {} : { writeback }),
    ...(relay === undefined ? {} : { relay })
  };
  return { action, input };
}
