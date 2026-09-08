import { jsonHeaders, parseLocalJsonRequest } from "./server/operations/request.js";

export { jsonHeaders } from "./server/operations/request.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACKING_FIELDS = new Set(["logicalShopId", "orderId", "tracking", "provider", "region"]);
const KILL_SWITCH_FIELDS = new Set(["cotikSyncEnabled", "cotikPostEnabled", "confirmEnable"]);

export type CotikRegion = "US" | "UK";

export type TrackingRequest = {
  logicalShopId: string;
  orderId: string;
  tracking: string;
  provider: string;
  region: CotikRegion;
};

export type KillSwitchRequest = {
  cotikSyncEnabled?: boolean;
  cotikPostEnabled?: boolean;
  confirmEnable?: boolean;
};

export function errorResponse(code: string, message: string, status: 400 | 404 | 409 | 503): Response {
  return Response.json({ error: { code, message } }, { status, headers: jsonHeaders() });
}

export async function parseCotikJsonRequest(request: Request) {
  return await parseLocalJsonRequest(request);
}

export async function assertLocalCotikRequest(request: Request) {
  const guarded = await parseLocalJsonRequest(new Request(request.url, {
    method: "POST",
    headers: new Headers(request.headers),
    body: "{}",
  }));
  if (!guarded.ok) return guarded;
  return { ok: true as const };
}

function hasOnlyFields(body: Record<string, unknown>, fields: Set<string>): boolean {
  return Object.keys(body).every((field) => fields.has(field));
}

function nonBlankString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

export function parseTrackingRequest(body: Record<string, unknown>): TrackingRequest {
  if (!hasOnlyFields(body, TRACKING_FIELDS)) throw new Error("Unsupported tracking request field.");

  const logicalShopId = nonBlankString(body.logicalShopId, "logicalShopId", 36);
  if (!UUID_PATTERN.test(logicalShopId)) throw new Error("logicalShopId must be a UUID.");
  const orderId = nonBlankString(body.orderId, "orderId", 128);
  const tracking = nonBlankString(body.tracking, "tracking", 256);
  const provider = nonBlankString(body.provider, "provider", 128);
  if (body.region !== "US" && body.region !== "UK") throw new Error("region must be US or UK.");

  return { logicalShopId, orderId, tracking, provider, region: body.region };
}

export function parseKillSwitchRequest(body: Record<string, unknown>): KillSwitchRequest {
  if (!hasOnlyFields(body, KILL_SWITCH_FIELDS)) throw new Error("Unsupported kill-switch request field.");
  const keys = ["cotikSyncEnabled", "cotikPostEnabled"] as const;
  if (!keys.some((key) => body[key] !== undefined)) throw new Error("At least one kill switch value is required.");

  const syncEnabled = body.cotikSyncEnabled;
  const postEnabled = body.cotikPostEnabled;
  if (syncEnabled !== undefined && typeof syncEnabled !== "boolean") throw new Error("cotikSyncEnabled must be boolean.");
  if (postEnabled !== undefined && typeof postEnabled !== "boolean") throw new Error("cotikPostEnabled must be boolean.");
  if (body.confirmEnable !== undefined && typeof body.confirmEnable !== "boolean") {
    throw new Error("confirmEnable must be boolean.");
  }

  return {
    ...(syncEnabled === undefined ? {} : { cotikSyncEnabled: syncEnabled }),
    ...(postEnabled === undefined ? {} : { cotikPostEnabled: postEnabled }),
    ...(body.confirmEnable === undefined ? {} : { confirmEnable: body.confirmEnable as boolean }),
  };
}
