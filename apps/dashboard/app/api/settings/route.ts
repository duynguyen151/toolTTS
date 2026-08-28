import { addRefreshCheckpoint, appendAiTaskConfigRevision, appendGlobalRiskPolicyRevision, appendShopRiskPolicyOverrideRevision, closeDatabase, createDatabase, deleteRefreshCheckpoint, disableShopRiskPolicyOverride, getCurrentAiTaskConfig, getCurrentRefreshSettings, setAutoRefreshEnabled, setRefreshCheckpointEnabled, setRefreshRetryOffsets, updateRefreshCheckpoint } from "@shop-health/db";
import { resolveAiTaskConfig, testAiTaskConnection } from "@shop-health/decision-ai";
import { jsonHeaders, parseLocalJsonRequest } from "../../../lib/server/operations/request.js";
import { parseSettingsRequest, safeAiTaskConfig } from "../../settings/settings-contract.js";

function safeRevision(revision: { revisionId: string; sequence: bigint; effectiveFrom: Date; scope?: string; shopId?: string | null }) {
  return { revisionId: revision.revisionId, sequence: revision.sequence.toString(), effectiveFrom: revision.effectiveFrom.toISOString(), ...(revision.scope === undefined ? {} : { scope: revision.scope }), ...(revision.shopId === undefined ? {} : { shopId: revision.shopId }) };
}

export async function POST(request: Request): Promise<Response> {
  const local = await parseLocalJsonRequest(request);
  if (!local.ok) return Response.json({ error: local.error }, { status: local.status, headers: jsonHeaders() });
  let parsed: ReturnType<typeof parseSettingsRequest>;
  try { parsed = parseSettingsRequest(local.body); } catch (error) { return Response.json({ error: { code: "INVALID_REQUEST", message: error instanceof Error ? error.message : "Invalid settings request" } }, { status: 400, headers: jsonHeaders() }); }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: "DATABASE_URL is required." } }, { status: 503, headers: jsonHeaders() });
  const context = createDatabase(databaseUrl);
  try {
    if (parsed.action === "refresh") {
      let settings = await getCurrentRefreshSettings(context.db);
      if (typeof parsed.autoRefreshEnabled === "boolean") settings = await setAutoRefreshEnabled(context.db, { enabled: parsed.autoRefreshEnabled });
      if (Array.isArray(parsed.retryOffsetsSeconds)) settings = await setRefreshRetryOffsets(context.db, { retryOffsetsSeconds: parsed.retryOffsetsSeconds });
      if (typeof parsed.addCheckpoint === "string") await addRefreshCheckpoint(context.db, { localTime: parsed.addCheckpoint });
      settings = await getCurrentRefreshSettings(context.db);
      return Response.json({ ok: true, data: settings }, { headers: jsonHeaders() });
    }
    if (parsed.action === "checkpoint-edit") return Response.json({ ok: true, data: await updateRefreshCheckpoint(context.db, { checkpointId: String(parsed.checkpointId), localTime: String(parsed.localTime) }) }, { headers: jsonHeaders() });
    if (parsed.action === "checkpoint-enabled") return Response.json({ ok: true, data: await setRefreshCheckpointEnabled(context.db, { checkpointId: String(parsed.checkpointId), enabled: Boolean(parsed.enabled) }) }, { headers: jsonHeaders() });
    if (parsed.action === "checkpoint-delete") return Response.json({ ok: true, data: await deleteRefreshCheckpoint(context.db, { checkpointId: String(parsed.checkpointId) }) }, { headers: jsonHeaders() });
    if (parsed.action === "policy-global") return Response.json({ ok: true, data: safeRevision(await appendGlobalRiskPolicyRevision(context.db, { version: String(parsed.version), currency: String(parsed.currency), thresholds: parsed.thresholds as never, caution: parsed.caution as never, effectiveFrom: new Date(String(parsed.effectiveFrom)) })) }, { headers: jsonHeaders() });
    if (parsed.action === "policy-shop") return Response.json({ ok: true, data: safeRevision(await appendShopRiskPolicyOverrideRevision(context.db, { shopId: String(parsed.shopId), thresholds: parsed.thresholds as never, caution: parsed.caution as never, effectiveFrom: new Date(String(parsed.effectiveFrom)) })) }, { headers: jsonHeaders() });
    if (parsed.action === "policy-disable-shop") return Response.json({ ok: true, data: safeRevision(await disableShopRiskPolicyOverride(context.db, { shopId: String(parsed.shopId), effectiveFrom: new Date(String(parsed.effectiveFrom)) })) }, { headers: jsonHeaders() });
    if (parsed.action === "ai-task") {
      const existing = parsed.preserveSecretRef === true
        ? await getCurrentAiTaskConfig(context.db, { taskId: parsed.taskId, effectiveAt: new Date(String(parsed.effectiveFrom)) })
        : null;
      if (parsed.preserveSecretRef === true && existing === null) return Response.json({ error: { code: "SECRET_REFERENCE_REQUIRED", message: "An existing AI task is required to preserve its secret reference." } }, { status: 400, headers: jsonHeaders() });
      const revision = await appendAiTaskConfigRevision(context.db, { taskId: parsed.taskId, provider: parsed.provider, baseUrl: parsed.baseUrl, model: parsed.model, secretRef: parsed.preserveSecretRef === true ? existing!.secretRef : parsed.secretRef, enabled: parsed.enabled, status: parsed.enabled ? "ENABLED" : "DISABLED", parameters: parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }, effectiveFrom: new Date(String(parsed.effectiveFrom)) } as never);
      return Response.json({ ok: true, data: safeAiTaskConfig(revision) }, { headers: jsonHeaders() });
    }
    if (parsed.action === "ai-test") {
      const effectiveAt = new Date(String(parsed.effectiveAt));
      const current = await getCurrentAiTaskConfig(context.db, { taskId: parsed.taskId as never, effectiveAt });
      const connection = await testAiTaskConnection(resolveAiTaskConfig(parsed.taskId as never, current, process.env), { environment: process.env });
      return Response.json({ ok: true, data: { taskId: parsed.taskId, effectiveAt: effectiveAt.toISOString(), connection } }, { headers: jsonHeaders() });
    }
    return Response.json({ error: { code: "INVALID_REQUEST", message: "Unsupported settings action" } }, { status: 400, headers: jsonHeaders() });
  } catch (error) { return Response.json({ error: { code: "SETTINGS_UPDATE_FAILED", message: error instanceof Error ? error.message : "Settings update failed" } }, { status: 400, headers: jsonHeaders() }); }
  finally { await closeDatabase(context); }
}
