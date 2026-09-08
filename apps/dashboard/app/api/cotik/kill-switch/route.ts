import {
  closeDatabase,
  createDatabase,
  getCotikWorkflowSettings,
  setCotikWorkflowSettings,
} from "@shop-health/db";

import {
  assertLocalCotikRequest,
  errorResponse,
  jsonHeaders,
  parseCotikJsonRequest,
  parseKillSwitchRequest,
} from "../../../../lib/cotik-route.js";

export const dynamic = "force-dynamic";

function safeSettings(settings: {
  cotikSyncEnabled: boolean;
  cotikPostEnabled: boolean;
  deploymentId: string | null;
  lastResetAt: Date | null;
  updatedAt: Date | null;
}) {
  return {
    cotikSyncEnabled: settings.cotikSyncEnabled,
    cotikPostEnabled: settings.cotikPostEnabled,
    deploymentId: settings.deploymentId,
    lastResetAt: settings.lastResetAt?.toISOString() ?? null,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
  };
}

export async function GET(request: Request): Promise<Response> {
  const guarded = await assertLocalCotikRequest(request);
  if (!guarded.ok) return Response.json({ error: guarded.error }, { status: guarded.status, headers: jsonHeaders() });

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return errorResponse("DATABASE_UNAVAILABLE", "DATABASE_URL is required.", 503);

  const context = createDatabase(databaseUrl);
  try {
    const settings = await getCotikWorkflowSettings(context.db);
    return Response.json(safeSettings(settings ?? {
      cotikSyncEnabled: false,
      cotikPostEnabled: false,
      deploymentId: null,
      lastResetAt: null,
      updatedAt: null,
    }), { headers: jsonHeaders() });
  } finally {
    await closeDatabase(context);
  }
}

export async function POST(request: Request): Promise<Response> {
  const guarded = await parseCotikJsonRequest(request);
  if (!guarded.ok) return Response.json({ error: guarded.error }, { status: guarded.status, headers: jsonHeaders() });

  let input;
  try {
    input = parseKillSwitchRequest(guarded.body);
  } catch (error) {
    return errorResponse("INVALID_REQUEST", error instanceof Error ? error.message : "Invalid kill-switch request.", 400);
  }

  const enabling = input.cotikSyncEnabled === true || input.cotikPostEnabled === true;
  if (enabling && input.confirmEnable !== true) {
    return errorResponse("ENABLE_CONFIRMATION_REQUIRED", "Explicit confirmation is required before enabling a Cotik switch.", 400);
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return errorResponse("DATABASE_UNAVAILABLE", "DATABASE_URL is required.", 503);

  const context = createDatabase(databaseUrl);
  try {
    const updated = await setCotikWorkflowSettings(context.db, {
      ...(input.cotikSyncEnabled === undefined ? {} : { cotikSyncEnabled: input.cotikSyncEnabled }),
      ...(input.cotikPostEnabled === undefined ? {} : { cotikPostEnabled: input.cotikPostEnabled }),
    });
    return Response.json(safeSettings(updated), { headers: jsonHeaders() });
  } catch (error) {
    return errorResponse("COTIK_SETTINGS_UPDATE_FAILED", "Cotik kill-switch settings could not be updated.", 503);
  } finally {
    await closeDatabase(context);
  }
}
