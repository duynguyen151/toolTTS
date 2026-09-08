"use client";

import React, { useState, useTransition } from "react";
import { CotikTracking, type CotikLogicalShopDisplay, type CotikProviderDisplay } from "./cotik-tracking";

export interface CotikAccountDisplay {
  id: string;
  displayName: string;
  status: string;
  priority: number;
  lastSeenAt: string | null;
}

export interface CotikSettingsProps {
  accounts: CotikAccountDisplay[];
  providers: CotikProviderDisplay[];
  logicalShops?: CotikLogicalShopDisplay[];
  syncEnabled: boolean;
  postEnabled: boolean;
  activeDeploymentId?: string | null;
  lastResetAt?: string | null;
  onToggleSwitch?: (key: "sync" | "post", targetState: boolean) => Promise<void>;
}

export function CotikSettings({
  accounts,
  providers,
  logicalShops = [],
  syncEnabled: initialSyncEnabled,
  postEnabled: initialPostEnabled,
  activeDeploymentId,
  lastResetAt,
  onToggleSwitch
}: CotikSettingsProps) {
  const [syncEnabled, setSyncEnabled] = useState(initialSyncEnabled);
  const [postEnabled, setPostEnabled] = useState(initialPostEnabled);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const handleToggle = (key: "sync" | "post", currentState: boolean) => {
    const nextState = !currentState;
    if (nextState && typeof window !== "undefined" && !window.confirm("Enable this Cotik switch? When both Cotik switches are ON, the worker may send pending tracking automatically on its next tick.")) {
      return;
    }
    if (key === "sync") setSyncEnabled(nextState);
    if (key === "post") setPostEnabled(nextState);

    startTransition(async () => {
      try {
        if (onToggleSwitch) {
          await onToggleSwitch(key, nextState);
        } else {
          // Fallback to internal API endpoint if provided
          const response = await fetch("/api/cotik/kill-switch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              [key === "sync" ? "cotikSyncEnabled" : "cotikPostEnabled"]: nextState,
              ...(nextState ? { confirmEnable: true } : {})
            })
          });
          if (!response.ok) {
            const result = await response.json().catch(() => null) as { error?: { message?: string } } | null;
            throw new Error(result?.error?.message ?? "Could not update the Cotik kill switch.");
          }
        }
        setMessage(`Successfully updated ${key === "sync" ? "Sync" : "POST Write"} kill switch.`);
      } catch (err) {
        // Revert on error
        if (key === "sync") setSyncEnabled(currentState);
        if (key === "post") setPostEnabled(currentState);
        setMessage(`Error toggling switch: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };

  const getStatusBadgeStyle = (status: string) => {
    switch (status.toUpperCase()) {
      case "ACTIVE":
        return { background: "rgba(16, 185, 129, 0.15)", color: "#10b981", border: "1px solid #10b98144" };
      case "TOKEN_EXPIRED":
        return { background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b", border: "1px solid #f59e0b44" };
      case "BLOCKED":
        return { background: "rgba(239, 68, 68, 0.15)", color: "#ef4444", border: "1px solid #ef444444" };
      case "SUBSCRIPTION_EXPIRED":
        return { background: "rgba(168, 85, 247, 0.15)", color: "#a855f7", border: "1px solid #a855f744" };
      case "DISABLED":
        return { background: "rgba(100, 116, 139, 0.15)", color: "#64748b", border: "1px solid #64748b44" };
      case "SHOP_DISCONNECTED":
        return { background: "rgba(251, 146, 60, 0.15)", color: "#fb923c", border: "1px solid #fb923c44" };
      case "RATE_LIMITED":
        return { background: "rgba(234, 179, 8, 0.15)", color: "#eab308", border: "1px solid #eab30844" };
      case "NETWORK_ERROR":
        return { background: "rgba(239, 68, 68, 0.10)", color: "#f87171", border: "1px solid #f8717144" };
      case "UNKNOWN":
      default:
        return { background: "rgba(148, 163, 184, 0.15)", color: "#94a3b8", border: "1px solid #94a3b844" };
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%" }}>
      {/* Header & Status Banner */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 20px",
          background: "var(--color-surface, #1e293b)",
          borderRadius: "12px",
          border: "1px solid var(--color-border, #334155)"
        }}
      >
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0, color: "var(--color-ink, #f8fafc)" }}>
            Cotik Multi-Account & Fulfillment Controls
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "var(--color-ink-muted, #94a3b8)" }}>
            Multi-account credential vault, carrier rule validation, and dual kill switches.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span
            style={{
              padding: "4px 12px",
              borderRadius: "9999px",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: syncEnabled ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
              color: syncEnabled ? "#10b981" : "#ef4444",
              border: syncEnabled ? "1px solid #10b98155" : "1px solid #ef444455"
            }}
          >
            SYNC: {syncEnabled ? "ENABLED" : "OFF"}
          </span>
          <span
            style={{
              padding: "4px 12px",
              borderRadius: "9999px",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: postEnabled ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
              color: postEnabled ? "#10b981" : "#ef4444",
              border: postEnabled ? "1px solid #10b98155" : "1px solid #ef444455"
            }}
          >
            TRACKING POST: {postEnabled ? "ENABLED" : "OFF"}
          </span>
        </div>
      </div>

      {message && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "8px",
            background: "rgba(59, 130, 246, 0.1)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
            color: "#60a5fa",
            fontSize: "0.875rem"
          }}
        >
          {message}
        </div>
      )}

      {/* Dual Kill Switches Card */}
      <div
        style={{
          padding: "20px",
          background: "var(--color-surface, #1e293b)",
          borderRadius: "12px",
          border: "1px solid var(--color-border, #334155)",
          display: "flex",
          flexDirection: "column",
          gap: "16px"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-ink, #f8fafc)" }}>
              Dual Kill Switches (Deployment Resettable)
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: "0.8125rem", color: "var(--color-ink-muted, #94a3b8)" }}>
              Deployment reset resets both switches to OFF. AI automated enabling is strictly prohibited.
            </p>
          </div>
          {activeDeploymentId && (
            <div style={{ fontSize: "0.75rem", color: "var(--color-ink-muted, #94a3b8)", textAlign: "right" }}>
              <div>Deployment ID: <code>{activeDeploymentId}</code></div>
              {lastResetAt && <div>Last Reset: {new Date(lastResetAt).toLocaleString()}</div>}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "8px" }}>
          {/* Sync Switch */}
          <div
            style={{
              padding: "16px",
              borderRadius: "8px",
              background: "rgba(15, 23, 42, 0.5)",
              border: "1px solid var(--color-border, #334155)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--color-ink, #f8fafc)" }}>
                Cotik Order Sync
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--color-ink-muted, #94a3b8)", marginTop: "2px" }}>
                Multi-account polling & winner projection
              </div>
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleToggle("sync", syncEnabled)}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "0.8125rem",
                cursor: isPending ? "not-allowed" : "pointer",
                background: syncEnabled ? "#ef4444" : "#10b981",
                color: "#ffffff",
                border: "none",
                transition: "opacity 0.2s",
                opacity: isPending ? 0.6 : 1
              }}
            >
              {syncEnabled ? "Turn OFF" : "Turn ON"}
            </button>
          </div>

          {/* POST Switch */}
          <div
            style={{
              padding: "16px",
              borderRadius: "8px",
              background: "rgba(15, 23, 42, 0.5)",
              border: "1px solid var(--color-border, #334155)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--color-ink, #f8fafc)" }}>
                Cotik Tracking POST Writer
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--color-ink-muted, #94a3b8)", marginTop: "2px" }}>
                Strict fulfillment tracking write (import-tracking-v2)
              </div>
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleToggle("post", postEnabled)}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "0.8125rem",
                cursor: isPending ? "not-allowed" : "pointer",
                background: postEnabled ? "#ef4444" : "#10b981",
                color: "#ffffff",
                border: "none",
                transition: "opacity 0.2s",
                opacity: isPending ? 0.6 : 1
              }}
            >
              {postEnabled ? "Turn OFF" : "Turn ON"}
            </button>
          </div>
        </div>
      </div>

      {/* Cotik Accounts Table */}
      <div
        style={{
          padding: "20px",
          background: "var(--color-surface, #1e293b)",
          borderRadius: "12px",
          border: "1px solid var(--color-border, #334155)"
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 600, color: "var(--color-ink, #f8fafc)" }}>
          Configured Accounts ({accounts.length})
        </h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border, #334155)", textAlign: "left", color: "var(--color-ink-muted, #94a3b8)" }}>
                <th style={{ padding: "8px 12px" }}>Display Name</th>
                <th style={{ padding: "8px 12px" }}>Status</th>
                <th style={{ padding: "8px 12px" }}>Priority</th>
                <th style={{ padding: "8px 12px" }}>Last Seen</th>
                <th style={{ padding: "8px 12px" }}>Vault Security</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "16px 12px", textAlign: "center", color: "var(--color-ink-muted, #94a3b8)" }}>
                    No Cotik accounts configured.
                  </td>
                </tr>
              ) : (
                accounts.map((account) => (
                  <tr key={account.id} style={{ borderBottom: "1px solid rgba(51, 65, 85, 0.4)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 500, color: "var(--color-ink, #f8fafc)" }}>
                      {account.displayName}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "6px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          ...getStatusBadgeStyle(account.status)
                        }}
                      >
                        {account.status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--color-ink, #f8fafc)" }}>
                      {account.priority}
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--color-ink-muted, #94a3b8)" }}>
                      {account.lastSeenAt ? new Date(account.lastSeenAt).toLocaleString() : "Never"}
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--color-success, #10b981)", fontSize: "0.75rem" }}>
                      🔒 AES-256-GCM Vault
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Explicit Provider Catalog */}
      <div
        style={{
          padding: "20px",
          background: "var(--color-surface, #1e293b)",
          borderRadius: "12px",
          border: "1px solid var(--color-border, #334155)"
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 600, color: "var(--color-ink, #f8fafc)" }}>
          Explicit Provider Catalog ({providers.length})
        </h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border, #334155)", textAlign: "left", color: "var(--color-ink-muted, #94a3b8)" }}>
                <th style={{ padding: "8px 12px" }}>Region</th>
                <th style={{ padding: "8px 12px" }}>Carrier</th>
                <th style={{ padding: "8px 12px" }}>Provider ID</th>
                <th style={{ padding: "8px 12px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: "16px 12px", textAlign: "center", color: "var(--color-ink-muted, #94a3b8)" }}>
                    No explicit providers configured.
                  </td>
                </tr>
              ) : (
                providers.map((provider) => (
                  <tr key={`${provider.region}-${provider.providerId}`} style={{ borderBottom: "1px solid rgba(51, 65, 85, 0.4)" }}>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        style={{
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          background: "rgba(59, 130, 246, 0.15)",
                          color: "#60a5fa"
                        }}
                      >
                        {provider.region}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--color-ink, #f8fafc)" }}>
                      {provider.carrierName}
                    </td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--color-ink-muted, #94a3b8)" }}>
                      {provider.providerId}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        style={{
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          background: "rgba(16, 185, 129, 0.15)",
                          color: "#10b981"
                        }}
                      >
                        ACTIVE
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CotikTracking logicalShops={logicalShops} providers={providers} />
    </div>
  );
}
