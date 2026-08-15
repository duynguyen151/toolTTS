import { describe, expect, it } from "vitest";

import type { UpdateDataEvent } from "./operations-contract.js";
import { readUpdateDataEvents } from "./read-update-stream.js";

function event(state: UpdateDataEvent["state"], terminal = false): UpdateDataEvent {
  return {
    state,
    message: state,
    terminal,
    completedKinds: [],
    error: null,
  };
}

function streamFrom(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<UpdateDataEvent[]> {
  const values: UpdateDataEvent[] = [];
  for await (const value of readUpdateDataEvents(stream)) values.push(value);
  return values;
}

describe("readUpdateDataEvents", () => {
  it("parses events split across arbitrary response chunks", async () => {
    const first = JSON.stringify(event("OPENING_PROFILE"));
    const second = JSON.stringify(event("SUCCESS", true));
    const payload = `${first}\n${second}\n`;

    await expect(collect(streamFrom([
      payload.slice(0, 7),
      payload.slice(7, first.length + 3),
      payload.slice(first.length + 3),
    ]))).resolves.toEqual([
      event("OPENING_PROFILE"),
      event("SUCCESS", true),
    ]);
  });

  it("parses multiple lines in one chunk and a final line without a newline", async () => {
    const payload = [
      JSON.stringify(event("SYNCING_ORDERS")),
      JSON.stringify(event("SYNCING_FINANCE")),
      JSON.stringify(event("SUCCESS", true)),
    ].join("\n");

    await expect(collect(streamFrom([payload]))).resolves.toEqual([
      event("SYNCING_ORDERS"),
      event("SYNCING_FINANCE"),
      event("SUCCESS", true),
    ]);
  });

  it("accepts HUMAN_ACTION_REQUIRED as a terminal operator state", async () => {
    await expect(collect(streamFrom([
      JSON.stringify(event("HUMAN_ACTION_REQUIRED", true)),
    ]))).resolves.toEqual([event("HUMAN_ACTION_REQUIRED", true)]);
  });

  it("rejects malformed event JSON", async () => {
    await expect(collect(streamFrom(["{not-json}\n"]))).rejects.toThrow(
      "Update stream contained invalid JSON",
    );
  });

  it("rejects JSON that does not match the update event contract", async () => {
    await expect(collect(streamFrom(["{\"state\":\"SUCCESS\"}\n"]))).rejects.toThrow(
      "Update stream contained an invalid event",
    );
  });

  it("rejects stream errors with codes outside the client-safe allowlist", async () => {
    await expect(collect(streamFrom([
      `${JSON.stringify({
        ...event("ERROR", true),
        error: { code: "PRIVATE_UPSTREAM_ERROR", message: "Unexpected upstream detail" },
      })}\n`,
    ]))).rejects.toThrow("Update stream contained an invalid event");
  });

  it("rejects a stream that ends before a terminal event", async () => {
    await expect(collect(streamFrom([
      `${JSON.stringify(event("SYNCING_ORDERS"))}\n`,
    ]))).rejects.toThrow("Update stream ended without a terminal event");
  });

  it("rejects events whose terminal flag does not match their state", async () => {
    await expect(collect(streamFrom([
      `${JSON.stringify(event("SUCCESS"))}\n`,
    ]))).rejects.toThrow("Update stream contained an invalid event");
  });
});
