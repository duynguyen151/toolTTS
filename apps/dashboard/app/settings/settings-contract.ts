import {
  AI_TASK_IDS,
  AI_TASK_PROVIDERS,
  AiTaskConfigInputSchema,
  type AiTaskId,
  type AiTaskProvider,
} from "@shop-health/decision-ai";
import {
  GlobalRiskPolicyRevisionSchema,
  ShopRiskPolicyOverrideRevisionSchema,
} from "@shop-health/domain";

const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_REF = /^[A-Z][A-Z0-9_]{0,127}$/;

export type SettingsRequest =
  | { action: "refresh"; autoRefreshEnabled?: boolean; retryOffsetsSeconds?: number[]; addCheckpoint?: string }
  | { action: "checkpoint-add"; localTime: string; enabled: boolean }
  | { action: "checkpoint-edit"; checkpointId: string; localTime: string }
  | { action: "checkpoint-enabled"; checkpointId: string; enabled: boolean }
  | { action: "checkpoint-delete"; checkpointId: string }
  | { action: "policy-global"; version: string; currency: string; thresholds: unknown; caution: unknown; effectiveFrom: string }
  | { action: "policy-shop"; shopId: string; thresholds: unknown; caution: unknown; effectiveFrom: string }
  | { action: "policy-disable-shop"; shopId: string; effectiveFrom: string }
  | { action: "ai-task"; taskId: AiTaskId; provider: AiTaskProvider; baseUrl: string; model: string; secretRef?: string; preserveSecretRef?: true; enabled: boolean; effectiveFrom: string; timeoutMs?: number }
  | { action: "ai-test"; taskId: AiTaskId; effectiveAt: string };

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Settings request must be an object");
  return value as Record<string, unknown>;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !ISO.test(value) || !Number.isFinite(new Date(value).getTime())) throw new Error(`${label} must be an ISO timestamp with an explicit UTC or offset`);
  return value;
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${label} must be a UUID`);
  return value;
}

function aiTaskId(value: unknown): AiTaskId {
  if (typeof value !== "string" || !(AI_TASK_IDS as readonly string[]).includes(value)) throw new Error("Unknown AI task ID");
  return value as AiTaskId;
}

export function parseSettingsRequest(value: unknown): SettingsRequest {
  const request = record(value);
  if (request.action === "refresh") {
    if (request.autoRefreshEnabled !== undefined && typeof request.autoRefreshEnabled !== "boolean") throw new Error("autoRefreshEnabled must be boolean");
    if (request.addCheckpoint !== undefined && (typeof request.addCheckpoint !== "string" || !LOCAL_TIME.test(request.addCheckpoint))) throw new Error("addCheckpoint must be HH:mm in Asia/Bangkok");
    if (request.retryOffsetsSeconds !== undefined && (!Array.isArray(request.retryOffsetsSeconds) || request.retryOffsetsSeconds.length < 1 || request.retryOffsetsSeconds.length > 10 || request.retryOffsetsSeconds.some((offset) => !Number.isInteger(offset) || offset < 0 || offset > 86_400))) throw new Error("retryOffsetsSeconds must contain 1-10 integer seconds");
    return { action: "refresh", ...(request.autoRefreshEnabled === undefined ? {} : { autoRefreshEnabled: request.autoRefreshEnabled as boolean }), ...(request.retryOffsetsSeconds === undefined ? {} : { retryOffsetsSeconds: request.retryOffsetsSeconds as number[] }), ...(request.addCheckpoint === undefined ? {} : { addCheckpoint: request.addCheckpoint }) };
  }
  if (request.action === "checkpoint-add") {
    if (typeof request.localTime !== "string" || !LOCAL_TIME.test(request.localTime)) throw new Error("localTime must be HH:mm in Asia/Bangkok");
    return { action: "checkpoint-add", localTime: request.localTime, enabled: request.enabled !== false };
  }
  if (request.action === "checkpoint-edit") {
    if (typeof request.localTime !== "string" || !LOCAL_TIME.test(request.localTime)) throw new Error("localTime must be HH:mm in Asia/Bangkok");
    return { action: "checkpoint-edit", checkpointId: id(request.checkpointId, "checkpointId"), localTime: request.localTime };
  }
  if (request.action === "checkpoint-enabled") return { action: "checkpoint-enabled", checkpointId: id(request.checkpointId, "checkpointId"), enabled: request.enabled === true };
  if (request.action === "checkpoint-delete") return { action: "checkpoint-delete", checkpointId: id(request.checkpointId, "checkpointId") };
  if (request.action === "policy-global") {
    const effectiveFrom = timestamp(request.effectiveFrom, "effectiveFrom");
    const parsed = GlobalRiskPolicyRevisionSchema.omit({ revisionId: true }).parse({ version: request.version, currency: request.currency, thresholds: request.thresholds, caution: request.caution, effectiveFrom: new Date(effectiveFrom) });
    return { action: "policy-global", ...parsed, effectiveFrom };
  }
  if (request.action === "policy-shop") {
    const effectiveFrom = timestamp(request.effectiveFrom, "effectiveFrom");
    const parsed = ShopRiskPolicyOverrideRevisionSchema.omit({ revisionId: true }).parse({ shopId: id(request.shopId, "shopId"), thresholds: request.thresholds, caution: request.caution, effectiveFrom: new Date(effectiveFrom) });
    return { action: "policy-shop", ...parsed, effectiveFrom };
  }
  if (request.action === "policy-disable-shop") return { action: "policy-disable-shop", shopId: id(request.shopId, "shopId"), effectiveFrom: timestamp(request.effectiveFrom, "effectiveFrom") };
  if (request.action === "ai-task") {
    const taskId = aiTaskId(request.taskId);
    if (typeof request.provider !== "string" || !(AI_TASK_PROVIDERS as readonly string[]).includes(request.provider)) throw new Error("Unknown AI task provider");
    if (request.preserveSecretRef === true && request.secretRef !== undefined) throw new Error("preserveSecretRef cannot include a secretRef");
    if (request.preserveSecretRef !== true && (typeof request.secretRef !== "string" || !SECRET_REF.test(request.secretRef))) throw new Error("secretRef must be a safe server-side reference name");
    const effectiveFrom = timestamp(request.effectiveFrom, "effectiveFrom");
    const parsed = AiTaskConfigInputSchema.parse({ taskId, provider: request.provider, baseUrl: request.baseUrl, model: request.model, secretRef: request.preserveSecretRef === true ? "PRESERVE_SECRET_REF" : request.secretRef, enabled: request.enabled, status: request.enabled === true ? "ENABLED" : "DISABLED", parameters: request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }, effectiveFrom: new Date(effectiveFrom) });
    if (request.preserveSecretRef === true) return { action: "ai-task", taskId: parsed.taskId, provider: parsed.provider, baseUrl: parsed.baseUrl, model: parsed.model, preserveSecretRef: true, enabled: parsed.enabled, effectiveFrom, ...(parsed.parameters.timeoutMs === undefined ? {} : { timeoutMs: parsed.parameters.timeoutMs }) };
    return { action: "ai-task", ...parsed, effectiveFrom };
  }
  if (request.action === "ai-test") return { action: "ai-test", taskId: aiTaskId(request.taskId), effectiveAt: timestamp(request.effectiveAt, "effectiveAt") };
  throw new Error("Unsupported settings action");
}

export function safeAiTaskConfig(config: {
  taskId: string; provider: string; baseUrl: string; model: string; secretRef: string; enabled: boolean; status: string;
  parameters: { timeoutMs?: number | undefined }; revisionId: string; sequence: bigint; effectiveFrom: Date; createdAt: Date;
}) {
  return { taskId: config.taskId, provider: config.provider, baseUrl: config.baseUrl, model: config.model, enabled: config.enabled, status: config.status, timeoutMs: config.parameters.timeoutMs ?? null, revisionId: config.revisionId, sequence: config.sequence.toString(), effectiveFrom: config.effectiveFrom.toISOString(), createdAt: config.createdAt.toISOString() };
}
