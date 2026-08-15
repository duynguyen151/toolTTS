import type { UpdateDataEvent } from "../../../lib/operations-contract.js";
import type { DashboardOperations } from "../../../lib/server/operations/dashboard-operations.js";
import { jsonHeaders, parseLocalProfileRequest } from "../../../lib/server/operations/request.js";

const encoder = new TextEncoder();

export function createUpdateDataHandler(operations: DashboardOperations) {
  return async function updateData(request: Request): Promise<Response> {
    const parsed = await parseLocalProfileRequest(request);
    if (!parsed.ok) {
      return Response.json({ error: parsed.error }, { status: parsed.status, headers: jsonHeaders() });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let terminalSent = false;
        const send = (event: UpdateDataEvent): void => {
          if (terminalSent) return;
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          if (event.terminal) {
            terminalSent = true;
            controller.close();
          }
        };

        try {
          await operations.updateData(parsed.profileNo, send);
        } catch {
          send({
            state: "ERROR",
            message: "Update Data stopped unexpectedly.",
            terminal: true,
            completedKinds: [],
            error: { code: "UNEXPECTED_ERROR", message: "Update Data stopped unexpectedly." },
          });
        }
        if (!terminalSent) {
          send({
            state: "ERROR",
            message: "Update Data ended without a terminal state.",
            terminal: true,
            completedKinds: [],
            error: { code: "UNEXPECTED_ERROR", message: "Update Data ended without a terminal state." },
          });
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
