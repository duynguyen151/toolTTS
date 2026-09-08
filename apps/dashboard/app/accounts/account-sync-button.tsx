"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface AccountSyncButtonProps {
  accountKey: string;
  accountName: string;
  shopCount?: number;
  size?: "small" | "medium";
}

export function AccountSyncButton({
  accountKey,
  accountName,
  shopCount,
  size = "medium",
}: AccountSyncButtonProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
    details?: string;
  } | null>(null);

  const handleSyncAccount = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (syncing) return;

    setSyncing(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/sync/cotik/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountKey }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        setFeedback({
          type: "success",
          message: `Đã đồng bộ thành công ${data.succeededShops}/${data.totalShops} shop của tài khoản ${accountName}!`,
        });
        router.refresh();
      } else {
        const errorMsg = data.message || data.error?.message || "Đồng bộ tài khoản thất bại";
        setFeedback({
          type: "error",
          message: `Lỗi đồng bộ: ${errorMsg}`,
          details: data.details
            ?.filter((d: any) => d.status === "FAILED")
            ?.map((d: any) => `${d.displayName || d.profileNo}: ${d.error}`)
            ?.join("; "),
        });
      }
    } catch {
      setFeedback({
        type: "error",
        message: "Lỗi kết nối mạng khi gửi lệnh đồng bộ tài khoản",
      });
    } finally {
      setSyncing(false);
    }
  };

  const isSmall = size === "small";

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <button
        type="button"
        onClick={handleSyncAccount}
        disabled={syncing}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: isSmall ? "6px 12px" : "8px 16px",
          borderRadius: "8px",
          background: syncing
            ? "rgba(100, 116, 139, 0.25)"
            : "linear-gradient(135deg, rgba(239, 68, 68, 0.9), rgba(244, 63, 94, 0.9))",
          color: "#ffffff",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          fontSize: isSmall ? "0.8125rem" : "0.875rem",
          fontWeight: 600,
          cursor: syncing ? "not-allowed" : "pointer",
          boxShadow: syncing ? "none" : "0 4px 12px rgba(244, 63, 94, 0.25)",
          transition: "all 0.15s ease",
        }}
        title={`Đồng bộ toàn bộ các shop của tài khoản ${accountName}`}
      >
        <span
          style={{
            display: "inline-block",
            animation: syncing ? "spin 1s linear infinite" : "none",
            fontSize: "1rem",
          }}
        >
          {syncing ? "⟳" : "⚡"}
        </span>
        <span>
          {syncing
            ? `Đang đồng bộ ${shopCount ? `${shopCount} shop...` : "account..."}`
            : `Đồng bộ Account ${accountName}`}
        </span>
      </button>

      {feedback && (
        <div
          style={{
            fontSize: "0.775rem",
            padding: "4px 8px",
            borderRadius: "6px",
            background: feedback.type === "success" ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
            border: feedback.type === "success" ? "1px solid rgba(34, 197, 94, 0.4)" : "1px solid rgba(239, 68, 68, 0.4)",
            color: feedback.type === "success" ? "#4ade80" : "#f87171",
            maxWidth: 320,
          }}
        >
          <div>{feedback.message}</div>
          {feedback.details && (
            <div style={{ fontSize: "0.72rem", opacity: 0.85, marginTop: 2 }}>{feedback.details}</div>
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
