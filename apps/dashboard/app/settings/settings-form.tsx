"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { RefreshSettingsSnapshot } from "@shop-health/db";

type Policy = { policyVersion: string; currency: string; effectiveAt: string; thresholds: Record<string, number | string>; caution: Record<string, unknown> };
type Props = { refresh: RefreshSettingsSnapshot; policy: Policy; selectedShopId: string; shops: Array<{ id: string; profileNo: string; displayName: string | null }>; aiTasks: Array<Record<string, unknown> | null> };

export function settingsShopHref(shopId: string): string {
  return `/settings?shopId=${encodeURIComponent(shopId)}`;
}

export function SettingsForm({ refresh, policy, selectedShopId, shops, aiTasks }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(refresh.autoRefreshEnabled);
  const [checkpoints, setCheckpoints] = useState(refresh.checkpoints);
  const [offsets, setOffsets] = useState(refresh.retryOffsetsSeconds.join(","));
  const [checkpoint, setCheckpoint] = useState("");
  const [thresholds, setThresholds] = useState(() => JSON.stringify(policy.thresholds));
  const [caution, setCaution] = useState(() => JSON.stringify(policy.caution));
  const [shopId, setShopId] = useState(selectedShopId);
  const [policyMessage, setPolicyMessage] = useState("");
  const [message, setMessage] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const [aiTaskId, setAiTaskId] = useState("SHOP_HEALTH_REVIEWER");
  const [aiProvider, setAiProvider] = useState("9router");
  const [aiBaseUrl, setAiBaseUrl] = useState("http://127.0.0.1:20128/v1");
  const [aiModel, setAiModel] = useState("");
  const [aiSecretRef, setAiSecretRef] = useState("");
  const [preserveSecretRef, setPreserveSecretRef] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  useEffect(() => { setCheckpoints(refresh.checkpoints); }, [refresh.checkpoints]);
  useEffect(() => { setShopId(selectedShopId); setThresholds(JSON.stringify(policy.thresholds)); setCaution(JSON.stringify(policy.caution)); }, [policy, selectedShopId]);
  useEffect(() => {
    const task = aiTasks.find((item) => item?.taskId === aiTaskId);
    if (task === undefined || task === null) return;
    setAiProvider(String(task.provider)); setAiBaseUrl(String(task.baseUrl)); setAiModel(String(task.model)); setAiEnabled(task.enabled === true); setAiSecretRef(""); setPreserveSecretRef(true);
  }, [aiTaskId, aiTasks]);
  async function send(body: Record<string, unknown>) {
    const response = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return await response.json() as { ok?: boolean; error?: { message?: string }; data?: { connection?: { status?: string; code?: string }; checkpoints?: typeof refresh.checkpoints; autoRefreshEnabled?: boolean; retryOffsetsSeconds?: number[] } };
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await send({ action: "refresh", autoRefreshEnabled: enabled, retryOffsetsSeconds: offsets.split(",").map(Number), ...(checkpoint ? { addCheckpoint: checkpoint } : {}) });
    setMessage(result.ok ? "Refresh settings saved." : result.error?.message ?? "Settings could not be saved.");
    if (result.ok) { setCheckpoint(""); if (result.data?.checkpoints) setCheckpoints(result.data.checkpoints); }
  }
  async function testAi() {
    const result = await send({ action: "ai-test", taskId: aiTaskId, effectiveAt: new Date().toISOString() });
    setAiMessage(result.ok ? `Connection: ${result.data?.connection?.status ?? "UNKNOWN"} (${result.data?.connection?.code ?? "-"})` : result.error?.message ?? "Connection test failed.");
  }
  async function saveAi(event: React.FormEvent) {
    event.preventDefault();
    const result = await send({ action: "ai-task", taskId: aiTaskId, provider: aiProvider, baseUrl: aiBaseUrl, model: aiModel, ...(preserveSecretRef ? { preserveSecretRef: true } : { secretRef: aiSecretRef }), enabled: aiEnabled, effectiveFrom: new Date().toISOString() });
    setAiMessage(result.ok ? "AI task revision appended." : result.error?.message ?? "AI task could not be saved.");
  }
  async function checkpointAction(body: Record<string, unknown>) {
    const result = await send(body);
    setMessage(result.ok ? "Checkpoint updated." : result.error?.message ?? "Checkpoint could not be updated.");
    if (result.ok) router.refresh();
  }
  async function savePolicy(scope: "global" | "shop") {
    try {
      const values = JSON.parse(thresholds) as Record<string, unknown>;
      const cautionValues = JSON.parse(caution) as Record<string, unknown>;
      const effectiveFrom = new Date().toISOString();
      const body = scope === "global"
        ? { action: "policy-global", version: policy.policyVersion, currency: policy.currency, thresholds: values, caution: cautionValues, effectiveFrom }
        : { action: "policy-shop", shopId, thresholds: values, caution: cautionValues, effectiveFrom };
      const result = await send(body);
      if (result.ok) router.refresh();
      setPolicyMessage(result.ok ? "Policy revision appended." : result.error?.message ?? "Policy could not be saved.");
    } catch { setPolicyMessage("Thresholds and caution must be JSON objects."); }
  }
  return <div className="settings-grid">
    <section className="settings-card" aria-labelledby="refresh-title"><h2 id="refresh-title">Auto Refresh & checkpoints</h2><form onSubmit={save} aria-label="Refresh settings"><fieldset><legend>Auto Refresh</legend><label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enabled</label><label>Retry offsets (seconds)<input inputMode="numeric" value={offsets} onChange={(event) => setOffsets(event.target.value)} /></label><label>Add Bangkok checkpoint<input pattern="(?:[01]\d|2[0-3]):[0-5]\d" placeholder="08:00" value={checkpoint} onChange={(event) => setCheckpoint(event.target.value)} /></label><p>Checkpoints use GMT+07 wall-clock values.</p><button type="submit">Save refresh settings</button></fieldset><p role="status" aria-live="polite">{message}</p></form><ul aria-label="Configured checkpoints">{checkpoints.map((item) => <li key={`${item.id}:${item.localTime}`}><label>Checkpoint <input aria-label={`Checkpoint ${item.localTime}`} defaultValue={item.localTime} onBlur={(event) => { if (event.target.value !== item.localTime) void checkpointAction({ action: "checkpoint-edit", checkpointId: item.id, localTime: event.target.value }); }} /></label><button type="button" onClick={() => void checkpointAction({ action: "checkpoint-enabled", checkpointId: item.id, enabled: !item.enabled })}>{item.enabled ? "Disable" : "Enable"}</button><button type="button" onClick={() => void checkpointAction({ action: "checkpoint-delete", checkpointId: item.id })}>Delete</button></li>)}</ul></section>
    <section className="settings-card" aria-labelledby="policy-title"><h2 id="policy-title">Effective policy</h2><dl><div><dt>Scope</dt><dd>{selectedShopId ? "Selected shop" : "Global"}</dd></div><div><dt>Version</dt><dd>{policy.policyVersion}</dd></div><div><dt>Currency</dt><dd>{policy.currency}</dd></div><div><dt>Effective at</dt><dd>{policy.effectiveAt}</dd></div><div><dt>Stop On Hold</dt><dd>{String(policy.thresholds.stopOnHoldValueAt)}</dd></div><div><dt>Stop Delivery Rate</dt><dd>{String(policy.thresholds.stopDeliveryRateBelow)}</dd></div></dl><p>Global policy and shop overrides are append-only.</p><label>Thresholds JSON<textarea value={thresholds} onChange={(event) => setThresholds(event.target.value)} /></label><label>Caution JSON<textarea value={caution} onChange={(event) => setCaution(event.target.value)} /></label><div><button type="button" onClick={() => savePolicy("global")}>Append global policy</button><label>Shop override<select value={shopId} onChange={(event) => { setShopId(event.target.value); router.replace(event.target.value ? settingsShopHref(event.target.value) : "/settings"); }}><option value="">Global policy</option>{shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.profileNo} {shop.displayName ?? ""}</option>)}</select></label><button type="button" disabled={!shopId} onClick={() => savePolicy("shop")}>Append shop override</button></div><p role="status" aria-live="polite">{policyMessage}</p></section>
    <section className="settings-card" aria-labelledby="ai-title"><h2 id="ai-title">AI tasks</h2><p>Secrets remain server-side; only a reference name is stored.</p><ul>{aiTasks.map((task, index) => <li key={index}>{task?.taskId ? `${String(task.taskId)} · ${String(task.status)}` : "Unset"}</li>)}</ul><form onSubmit={saveAi}><label>Task<select value={aiTaskId} onChange={(event) => { setAiTaskId(event.target.value); setPreserveSecretRef(false); }}>{["SHOP_HEALTH_REVIEWER", "FINANCE_SPECIALIST", "ORDER_ANOMALY_REVIEWER", "BA_ASSISTANT"].map((task) => <option key={task}>{task}</option>)}</select></label><label>Provider<select value={aiProvider} onChange={(event) => setAiProvider(event.target.value)}>{["9router", "openai-compatible", "huggingface-hosted"].map((provider) => <option key={provider}>{provider}</option>)}</select></label><label>Base URL<input type="url" required value={aiBaseUrl} onChange={(event) => setAiBaseUrl(event.target.value)} /></label><label>Model<input required value={aiModel} onChange={(event) => setAiModel(event.target.value)} /></label>{preserveSecretRef ? <p>Existing secret reference is preserved.</p> : <label>Secret reference<input required pattern="[A-Z][A-Z0-9_]{0,127}" value={aiSecretRef} onChange={(event) => setAiSecretRef(event.target.value)} /></label>}<label><input type="checkbox" checked={aiEnabled} onChange={(event) => setAiEnabled(event.target.checked)} /> Enabled</label><button type="submit">Append AI task revision</button></form><button type="button" onClick={testAi}>Test selected connection</button><p role="status" aria-live="polite">{aiMessage}</p></section>
  </div>;
}
