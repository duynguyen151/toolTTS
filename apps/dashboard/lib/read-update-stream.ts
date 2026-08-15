import type {
  OperationError,
  UpdateDataEvent,
  UpdateDataState,
} from "./operations-contract.js";
import { isOperationErrorCode, isTerminalUpdateState } from "./operations-contract.js";

const UPDATE_STATES = new Set<UpdateDataState>([
  "READY",
  "OPENING_PROFILE",
  "CONNECTING",
  "SYNCING_ORDERS",
  "SYNCING_FINANCE",
  "RECONCILING",
  "SUCCESS",
  "PARTIAL",
  "ERROR",
  "LOGIN_REQUIRED",
  "SECURITY_CHECK_REQUIRED",
  "HUMAN_ACTION_REQUIRED",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOperationError(value: unknown): value is OperationError {
  return isRecord(value)
    && isOperationErrorCode(value.code)
    && typeof value.message === "string";
}

function parseEvent(line: string): UpdateDataEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Update stream contained invalid JSON");
  }

  if (!isRecord(value)
    || typeof value.state !== "string"
    || !UPDATE_STATES.has(value.state as UpdateDataState)
    || typeof value.message !== "string"
    || typeof value.terminal !== "boolean"
    || value.terminal !== isTerminalUpdateState(value.state as UpdateDataState)
    || !Array.isArray(value.completedKinds)
    || !value.completedKinds.every((kind) => kind === "orders" || kind === "finance")
    || !(value.error === null || isOperationError(value.error))) {
    throw new Error("Update stream contained an invalid event");
  }

  return value as unknown as UpdateDataEvent;
}

export async function* readUpdateDataEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<UpdateDataEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalSeen = false;

  const readEvent = (line: string): UpdateDataEvent => {
    if (terminalSeen) throw new Error("Update stream contained events after a terminal state");
    const event = parseEvent(line);
    terminalSeen = event.terminal;
    return event;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) yield readEvent(line);
        newline = buffer.indexOf("\n");
      }

      if (done) break;
    }

    const finalLine = buffer.trim();
    if (finalLine.length > 0) yield readEvent(finalLine);
    if (!terminalSeen) throw new Error("Update stream ended without a terminal event");
  } finally {
    reader.releaseLock();
  }
}
