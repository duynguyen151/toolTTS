"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { RefreshSettingsSnapshot } from "@shop-health/db";
import { KNOWN_COTIK_ACCOUNTS, maskToken } from "../../lib/cotik-account-types";
import styles from "./settings.module.css";

type Policy = {
  policyVersion: string;
  currency: string;
  effectiveAt: string;
  thresholds: Record<string, number | string>;
  caution: Record<string, unknown>;
};

type Props = {
  refresh: RefreshSettingsSnapshot;
  policy: Policy;
  selectedShopId: string;
  shops: Array<{ id: string; profileNo: string; displayName: string | null }>;
  aiTasks: Array<Record<string, unknown> | null>;
  accountStatuses?: Array<{
    key: string;
    tokenKey: string;
    name: string;
    owner: string;
    isConfigured: boolean;
    maskedToken: string;
  }>;
};

export function settingsShopHref(shopId: string): string {
  return `/settings?shopId=${encodeURIComponent(shopId)}`;
}

export function buildAiTaskRequest(input: {
  taskId: string;
  provider: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  existing: boolean;
  secretRef: string;
}): Record<string, unknown> {
  return {
    action: "ai-task",
    taskId: input.taskId,
    provider: input.provider,
    baseUrl: input.baseUrl,
    model: input.model,
    enabled: input.enabled,
    effectiveFrom: new Date().toISOString(),
    ...(input.existing ? { preserveSecretRef: true } : { secretRef: input.secretRef }),
  };
}

export function SettingsForm({ refresh, policy, selectedShopId, shops, aiTasks, accountStatuses }: Props) {
  const router = useRouter();

  // Refresh & Checkpoints state
  const [enabled, setEnabled] = useState(refresh.autoRefreshEnabled);
  const [checkpoints, setCheckpoints] = useState(refresh.checkpoints);
  const [offsets, setOffsets] = useState(refresh.retryOffsetsSeconds.join(","));
  const [checkpoint, setCheckpoint] = useState("");
  const [message, setMessage] = useState("");

  // Policy state
  const [shopId, setShopId] = useState(selectedShopId);
  const [thresholds, setThresholds] = useState(() => JSON.stringify(policy.thresholds));
  const [caution, setCaution] = useState(() => JSON.stringify(policy.caution));
  const [policyMessage, setPolicyMessage] = useState("");

  // Friendly threshold inputs
  const [stopOnHold, setStopOnHold] = useState<string>(
    String(policy.thresholds?.stopOnHoldValueAt ?? "3500")
  );
  const [stopDeliveryRate, setStopDeliveryRate] = useState<string>(
    String(
      typeof policy.thresholds?.stopDeliveryRateBelow === "number"
        ? (Number(policy.thresholds.stopDeliveryRateBelow) * 100).toFixed(0)
        : "70"
    )
  );
  const [minOrders, setMinOrders] = useState<string>(
    String(policy.thresholds?.minimumOrdersForRateRule ?? "10")
  );
  const [resumeOnHold, setResumeOnHold] = useState<string>(
    String(policy.thresholds?.resumeOnHoldValueBelow ?? "1000")
  );
  const [resumeDeliveryRate, setResumeDeliveryRate] = useState<string>(
    String(
      typeof policy.thresholds?.resumeDeliveryRateAt === "number"
        ? (Number(policy.thresholds.resumeDeliveryRateAt) * 100).toFixed(0)
        : "80"
    )
  );

  // Sync friendly inputs to thresholds JSON
  const handleFriendlyThresholdChange = (
    field: "stopOnHold" | "stopDeliveryRate" | "minOrders" | "resumeOnHold" | "resumeDeliveryRate",
    val: string
  ) => {
    let nextStopOH = stopOnHold;
    let nextStopDR = stopDeliveryRate;
    let nextMinO = minOrders;
    let nextResumeOH = resumeOnHold;
    let nextResumeDR = resumeDeliveryRate;

    if (field === "stopOnHold") { nextStopOH = val; setStopOnHold(val); }
    if (field === "stopDeliveryRate") { nextStopDR = val; setStopDeliveryRate(val); }
    if (field === "minOrders") { nextMinO = val; setMinOrders(val); }
    if (field === "resumeOnHold") { nextResumeOH = val; setResumeOnHold(val); }
    if (field === "resumeDeliveryRate") { nextResumeDR = val; setResumeDeliveryRate(val); }

    try {
      const current = JSON.parse(thresholds) as Record<string, unknown>;
      const updated = {
        ...current,
        stopOnHoldValueAt: nextStopOH,
        stopDeliveryRateBelow: Number(nextStopDR) / 100,
        minimumOrdersForRateRule: Number(nextMinO) || 1,
        resumeOnHoldValueBelow: nextResumeOH,
        resumeDeliveryRateAt: Number(nextResumeDR) / 100,
      };
      setThresholds(JSON.stringify(updated, null, 2));
    } catch {
      // fallback
    }
  };

  // AI Task state
  const [aiMessage, setAiMessage] = useState("");
  const [aiTaskId, setAiTaskId] = useState("SHOP_HEALTH_REVIEWER");
  const [aiProvider, setAiProvider] = useState("9router");
  const [aiBaseUrl, setAiBaseUrl] = useState("http://127.0.0.1:20128/v1");
  const [aiModel, setAiModel] = useState("");
  const [aiSecretRef, setAiSecretRef] = useState("");
  const [preserveSecretRef, setPreserveSecretRef] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);

  useEffect(() => {
    setCheckpoints(refresh.checkpoints);
  }, [refresh.checkpoints]);

  useEffect(() => {
    setShopId(selectedShopId);
    setThresholds(JSON.stringify(policy.thresholds, null, 2));
    setCaution(JSON.stringify(policy.caution, null, 2));
    setStopOnHold(String(policy.thresholds?.stopOnHoldValueAt ?? "3500"));
    setStopDeliveryRate(
      String(
        typeof policy.thresholds?.stopDeliveryRateBelow === "number"
          ? (Number(policy.thresholds.stopDeliveryRateBelow) * 100).toFixed(0)
          : "70"
      )
    );
    setMinOrders(String(policy.thresholds?.minimumOrdersForRateRule ?? "10"));
    setResumeOnHold(String(policy.thresholds?.resumeOnHoldValueBelow ?? "1000"));
    setResumeDeliveryRate(
      String(
        typeof policy.thresholds?.resumeDeliveryRateAt === "number"
          ? (Number(policy.thresholds.resumeDeliveryRateAt) * 100).toFixed(0)
          : "80"
      )
    );
  }, [policy, selectedShopId]);

  useEffect(() => {
    const task = aiTasks.find((item) => item?.taskId === aiTaskId);
    if (task === undefined || task === null) return;
    setAiProvider(String(task.provider));
    setAiBaseUrl(String(task.baseUrl));
    setAiModel(String(task.model));
    setAiEnabled(task.enabled === true);
    setAiSecretRef("");
    setPreserveSecretRef(true);
  }, [aiTaskId, aiTasks]);

  async function send(body: Record<string, unknown>) {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as {
      ok?: boolean;
      error?: { message?: string };
      data?: {
        connection?: { status?: string; code?: string };
        checkpoints?: typeof refresh.checkpoints;
        autoRefreshEnabled?: boolean;
        retryOffsetsSeconds?: number[];
      };
    };
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await send({
      action: "refresh",
      autoRefreshEnabled: enabled,
      retryOffsetsSeconds: offsets.split(",").map((s) => Number(s.trim()) || 0),
      ...(checkpoint ? { addCheckpoint: checkpoint } : {}),
    });
    setMessage(
      result.ok
        ? "Đã lưu cài đặt Auto Refresh và Checkpoint thành công."
        : result.error?.message ?? "Không thể lưu cài đặt."
    );
    if (result.ok) {
      setCheckpoint("");
      if (result.data?.checkpoints) setCheckpoints(result.data.checkpoints);
    }
  }

  async function testAi() {
    setAiMessage("Đang kiểm tra kết nối AI...");
    const result = await send({ action: "ai-test", taskId: aiTaskId, effectiveAt: new Date().toISOString() });
    setAiMessage(
      result.ok
        ? `Kết nối AI thành công: ${result.data?.connection?.status ?? "OK"} (${result.data?.connection?.code ?? "200"})`
        : result.error?.message ?? "Kiểm tra kết nối thất bại."
    );
  }

  async function saveAi(event: React.FormEvent) {
    event.preventDefault();
    const result = await send(
      buildAiTaskRequest({
        taskId: aiTaskId,
        provider: aiProvider,
        baseUrl: aiBaseUrl,
        model: aiModel,
        enabled: aiEnabled,
        existing: preserveSecretRef,
        secretRef: aiSecretRef,
      })
    );
    setAiMessage(
      result.ok
        ? "Đã lưu cấu hình AI Task (Append Revision) thành công."
        : result.error?.message ?? "Không thể lưu cấu hình AI."
    );
  }

  async function checkpointAction(body: Record<string, unknown>) {
    const result = await send(body);
    setMessage(result.ok ? "Đã cập nhật Checkpoint." : result.error?.message ?? "Lỗi cập nhật Checkpoint.");
    if (result.ok) router.refresh();
  }

  async function savePolicy(scope: "global" | "shop") {
    try {
      const values = JSON.parse(thresholds) as Record<string, unknown>;
      const cautionValues = JSON.parse(caution) as Record<string, unknown>;
      const effectiveFrom = new Date().toISOString();
      const body =
        scope === "global"
          ? {
              action: "policy-global",
              version: policy.policyVersion,
              currency: policy.currency,
              thresholds: values,
              caution: cautionValues,
              effectiveFrom,
            }
          : { action: "policy-shop", shopId, thresholds: values, caution: cautionValues, effectiveFrom };
      const result = await send(body);
      if (result.ok) router.refresh();
      setPolicyMessage(
        result.ok
          ? `Đã lưu phiên bản Chính sách ${scope === "global" ? "toàn hệ thống" : `cửa hàng ${shopId}`} (Append-only) thành công.`
          : result.error?.message ?? "Không thể lưu chính sách."
      );
    } catch {
      setPolicyMessage("Lỗi cú pháp: Ngưỡng Thresholds và Caution phải là JSON object hợp lệ.");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      {/* ── Section 1: Cotik 5 Accounts Status ── */}
      <section className={styles.card} aria-label="Quản trị 5 Tài khoản Cotik">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 className={styles.cardTitle}>5 Tài khoản Cotik AL-Token</h2>
            <p className={styles.cardDesc}>
              Hệ thống kết nối trực tiếp với 5 AL-Token Cotik, đồng bộ đơn hàng và tài chính tự động không cần AdsPower.
            </p>
          </div>
          <Link
            href="/accounts"
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              background: "rgba(224, 35, 28, 0.15)",
              border: "1px solid rgba(224, 35, 28, 0.3)",
              color: "#ff8e88",
              fontSize: "0.8125rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Quản trị riêng từng tài khoản →
          </Link>
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "12px",
          marginTop: "6px",
        }}>
          {(accountStatuses ?? KNOWN_COTIK_ACCOUNTS.map((a) => ({
            key: a.key,
            tokenKey: a.tokenKey,
            name: a.name,
            owner: a.owner,
            isConfigured: true,
            maskedToken: "••••••••",
          }))).map((acc) => (
            <div
              key={acc.key}
              style={{
                padding: "12px 14px",
                borderRadius: "10px",
                background: "rgba(14, 20, 32, 0.7)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <strong style={{ fontSize: "0.875rem", color: "#ffffff" }}>{acc.name}</strong>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: acc.isConfigured ? "#34d399" : "#fbbf24",
                  }}
                />
              </div>
              <small style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>{acc.owner}</small>
              <code style={{ fontSize: "0.625rem", color: "#64748b", fontFamily: "monospace", marginTop: 4 }}>
                {acc.tokenKey}: {acc.maskedToken}
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 2: Intuitive Policy Thresholds Form ── */}
      <section className={styles.card} aria-labelledby="policy-title">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 id="policy-title" className={styles.cardTitle}>Ngưỡng An toàn Vận hành (Risk Policy & Thresholds)</h2>
            <p className={styles.cardDesc}>
              Thiết lập ngưỡng dừng On Hold và tỷ lệ giao hàng (Delivery Rate) để bảo vệ tài khoản Seller Center.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Phạm vi:</span>
            <select
              value={shopId}
              onChange={(event) => {
                setShopId(event.target.value);
                router.replace(event.target.value ? settingsShopHref(event.target.value) : "/settings");
              }}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                background: "rgba(0, 0, 0, 0.4)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                color: "#ffffff",
                fontSize: "0.8125rem",
              }}
            >
              <option value="">Toàn hệ thống (Global Policy)</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.profileNo} {shop.displayName ?? ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Friendly visual policy inputs */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "16px",
          marginTop: "12px",
          padding: "16px",
          borderRadius: "12px",
          background: "rgba(0, 0, 0, 0.25)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
        }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>
              Ngưỡng Dừng On Hold (Stop On Hold)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#94a3b8", fontSize: "0.875rem" }}>$</span>
              <input
                type="number"
                value={stopOnHold}
                onChange={(e) => handleFriendlyThresholdChange("stopOnHold", e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "rgba(14, 20, 32, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#34d399",
                  fontWeight: 700,
                  fontSize: "0.9375rem",
                }}
              />
            </div>
            <small style={{ display: "block", fontSize: "0.6875rem", color: "#94a3b8", marginTop: 4 }}>
              Khi On Hold vượt mức này, Rule sẽ đề xuất PAUSE khẩn cấp.
            </small>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>
              Ngưỡng Dừng Delivery Rate (Stop Rate)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number"
                value={stopDeliveryRate}
                onChange={(e) => handleFriendlyThresholdChange("stopDeliveryRate", e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "rgba(14, 20, 32, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#ff8e88",
                  fontWeight: 700,
                  fontSize: "0.9375rem",
                }}
              />
              <span style={{ color: "#94a3b8", fontSize: "0.875rem" }}>%</span>
            </div>
            <small style={{ display: "block", fontSize: "0.6875rem", color: "#94a3b8", marginTop: 4 }}>
              Khi tỷ lệ giao hàng dưới mức này, Rule kích hoạt cảnh báo rủi ro.
            </small>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>
              Số Đơn Tối Thiểu để xét Rule
            </label>
            <input
              type="number"
              value={minOrders}
              onChange={(e) => handleFriendlyThresholdChange("minOrders", e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "6px",
                background: "rgba(14, 20, 32, 0.8)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                color: "#ffffff",
                fontWeight: 600,
                fontSize: "0.9375rem",
              }}
            />
            <small style={{ display: "block", fontSize: "0.6875rem", color: "#94a3b8", marginTop: 4 }}>
              Tránh cảnh báo sai khi shop mới mở ít đơn (chưa đủ mẫu).
            </small>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>
              Ngưỡng Khôi Phục On Hold (Resume)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#94a3b8", fontSize: "0.875rem" }}>$</span>
              <input
                type="number"
                value={resumeOnHold}
                onChange={(e) => handleFriendlyThresholdChange("resumeOnHold", e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "rgba(14, 20, 32, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#ffffff",
                  fontSize: "0.9375rem",
                }}
              />
            </div>
            <small style={{ display: "block", fontSize: "0.6875rem", color: "#94a3b8", marginTop: 4 }}>
              Mức On Hold an toàn để xem xét mở lại bán hàng.
            </small>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
          <button
            type="button"
            className={styles.submitBtn}
            onClick={() => savePolicy(shopId ? "shop" : "global")}
          >
            {shopId ? "Lưu cài đặt cho Shop được chọn" : "Lưu cài đặt Toàn hệ thống (Global)"}
          </button>
        </div>

        {/* Collapsible details for raw JSON & tests compatibility */}
        <details style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
          <summary style={{ fontSize: "0.75rem", color: "#94a3b8", cursor: "pointer" }}>
            Chế độ nâng cao: Xem / Sửa Raw JSON (Thresholds & Caution)
          </summary>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", color: "#94a3b8" }}>
              Thresholds JSON
              <textarea
                value={thresholds}
                onChange={(event) => setThresholds(event.target.value)}
                style={{
                  width: "100%",
                  minHeight: 120,
                  fontFamily: "monospace",
                  fontSize: "0.8125rem",
                  padding: 8,
                  borderRadius: 6,
                  background: "rgba(10, 15, 26, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#f1f5f9",
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", color: "#94a3b8" }}>
              Caution JSON
              <textarea
                value={caution}
                onChange={(event) => setCaution(event.target.value)}
                style={{
                  width: "100%",
                  minHeight: 80,
                  fontFamily: "monospace",
                  fontSize: "0.8125rem",
                  padding: 8,
                  borderRadius: 6,
                  background: "rgba(10, 15, 26, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#f1f5f9",
                }}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className={styles.secondaryBtn} onClick={() => savePolicy("global")}>
                Append global policy
              </button>
              <button type="button" className={styles.secondaryBtn} disabled={!shopId} onClick={() => savePolicy("shop")}>
                Append shop override
              </button>
            </div>
          </div>
        </details>

        <p role="status" aria-live="polite" style={{ color: "#34d399", fontSize: "0.8125rem", marginTop: 8 }}>
          {policyMessage}
        </p>
      </section>

      {/* ── Section 3: Checkpoints & Auto Refresh ── */}
      <section className={styles.card} aria-labelledby="refresh-title">
        <h2 id="refresh-title" className={styles.cardTitle}>Lịch trình Checkpoint & Auto Refresh (Bangkok GMT+07)</h2>
        <p className={styles.cardDesc}>
          Thiết lập các mốc thời gian hệ thống tự động kiểm tra và đánh giá rủi ro cho danh mục shop.
        </p>

        <form onSubmit={save} aria-label="Refresh settings" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                style={{ width: 18, height: 18, accentColor: "#e0231c" }}
              />
              <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Bật Auto Refresh tự động</span>
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>Khoảng cách Retry (giây):</span>
              <input
                inputMode="numeric"
                value={offsets}
                onChange={(event) => setOffsets(event.target.value)}
                style={{
                  width: 100,
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#ffffff",
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.8125rem", color: "#cbd5e1" }}>Thêm Checkpoint Bangkok mới:</span>
            <input
              pattern="(?:[01]\d|2[0-3]):[0-5]\d"
              placeholder="VD: 08:00"
              value={checkpoint}
              onChange={(event) => setCheckpoint(event.target.value)}
              style={{
                width: 110,
                padding: "6px 12px",
                borderRadius: 6,
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#ffffff",
              }}
            />
            <button type="submit" className={styles.submitBtn}>
              Lưu cấu hình Làm mới
            </button>
          </div>

          <p role="status" aria-live="polite" style={{ color: "#34d399", fontSize: "0.8125rem", margin: 0 }}>
            {message}
          </p>
        </form>

        <div style={{ marginTop: 12 }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase" }}>
            Các Checkpoint đã cấu hình:
          </span>
          <ul aria-label="Configured checkpoints" className={styles.list} style={{ marginTop: 8 }}>
            {checkpoints.map((item) => (
              <li key={`${item.id}:${item.localTime}`} className={styles.listItem}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{
                    padding: "3px 8px",
                    borderRadius: 6,
                    background: "rgba(224, 35, 28, 0.15)",
                    color: "#ff8e88",
                    fontFamily: "monospace",
                    fontWeight: 700,
                  }}>
                    {item.localTime} GMT+07
                  </span>
                  <label style={{ fontSize: "0.8125rem", color: "#cbd5e1" }}>
                    Sửa giờ:{" "}
                    <input
                      aria-label={`Checkpoint ${item.localTime}`}
                      defaultValue={item.localTime}
                      onBlur={(event) => {
                        if (event.target.value !== item.localTime) {
                          void checkpointAction({
                            action: "checkpoint-edit",
                            checkpointId: item.id,
                            localTime: event.target.value,
                          });
                        }
                      }}
                      style={{
                        width: 70,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ffffff",
                      }}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() =>
                      void checkpointAction({
                        action: "checkpoint-enabled",
                        checkpointId: item.id,
                        enabled: !item.enabled,
                      })
                    }
                  >
                    {item.enabled ? "Tạm dừng (Disable)" : "Kích hoạt (Enable)"}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => void checkpointAction({ action: "checkpoint-delete", checkpointId: item.id })}
                  >
                    Xóa
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Section 4: AI Advisory Tasks ── */}
      <section className={styles.card} aria-labelledby="ai-title">
        <h2 id="ai-title" className={styles.cardTitle}>Nhiệm vụ Cố vấn AI (AI Advisory Tasks)</h2>
        <p className={styles.cardDesc}>
          Cấu hình mô hình AI đóng vai trò cố vấn độc lập cho BA. Toàn bộ API key được bảo mật ở server.
        </p>

        <form onSubmit={saveAi} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>
              Nhiệm vụ (Task ID)
            </label>
            <select
              value={aiTaskId}
              onChange={(event) => {
                setAiTaskId(event.target.value);
                setPreserveSecretRef(false);
              }}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#ffffff",
              }}
            >
              {["SHOP_HEALTH_REVIEWER", "FINANCE_SPECIALIST", "ORDER_ANOMALY_REVIEWER", "BA_ASSISTANT"].map((task) => (
                <option key={task} value={task}>{task}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>
              Nhà cung cấp (Provider)
            </label>
            <select
              value={aiProvider}
              onChange={(event) => setAiProvider(event.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#ffffff",
              }}
            >
              {["9router", "openai-compatible", "huggingface-hosted"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>
              Base URL
            </label>
            <input
              type="url"
              required
              value={aiBaseUrl}
              onChange={(event) => setAiBaseUrl(event.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#ffffff",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>
              Mô hình (Model Name)
            </label>
            <input
              required
              value={aiModel}
              onChange={(event) => setAiModel(event.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#ffffff",
              }}
            />
          </div>

          {!preserveSecretRef && (
            <div>
              <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>
                Secret Reference (Tên biến môi trường)
              </label>
              <input
                required
                pattern="[A-Z][A-Z0-9_]{0,127}"
                value={aiSecretRef}
                onChange={(event) => setAiSecretRef(event.target.value)}
                placeholder="VD: TOOL_AI_API_KEY"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "rgba(0,0,0,0.4)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#ffffff",
                }}
              />
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 12, gridColumn: "1 / -1", marginTop: 4 }}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(event) => setAiEnabled(event.target.checked)}
                style={{ width: 18, height: 18, accentColor: "#e0231c" }}
              />
              <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Kích hoạt AI Task</span>
            </label>

            <button type="submit" className={styles.submitBtn}>
              Lưu cấu hình AI (Append AI task revision)
            </button>

            <button type="button" className={styles.secondaryBtn} onClick={testAi}>
              Kiểm tra kết nối AI (Test selected connection)
            </button>
          </div>
        </form>

        <p role="status" aria-live="polite" style={{ color: "#34d399", fontSize: "0.8125rem", marginTop: 8 }}>
          {aiMessage}
        </p>
      </section>
    </div>
  );
}
