"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

export interface CotikLogicalShopDisplay {
  id: string;
  displayName: string;
  region: "US" | "UK";
}

export interface CotikProviderDisplay {
  providerId: string;
  carrierName: string;
  region: "US" | "UK";
}

export function buildCotikTrackingRequest(input: {
  logicalShopId: string;
  orderId: string;
  tracking: string;
  provider: string;
  region: "US" | "UK";
}) {
  return {
    logicalShopId: input.logicalShopId,
    orderId: input.orderId.trim(),
    tracking: input.tracking.trim(),
    provider: input.provider.trim(),
    region: input.region,
  };
}

export function CotikTracking({
  logicalShops,
  providers,
}: {
  logicalShops: CotikLogicalShopDisplay[];
  providers: CotikProviderDisplay[];
}) {
  const [logicalShopId, setLogicalShopId] = useState(logicalShops[0]?.id ?? "");
  const [orderId, setOrderId] = useState("");
  const [tracking, setTracking] = useState("");
  const [provider, setProvider] = useState(() => {
    const region = logicalShops[0]?.region;
    return providers.find((entry) => entry.region === region)?.providerId ?? "";
  });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const selectedShop = useMemo(
    () => logicalShops.find((shop) => shop.id === logicalShopId) ?? null,
    [logicalShopId, logicalShops],
  );
  const regionProviders = useMemo(
    () => providers.filter((entry) => entry.region === selectedShop?.region),
    [providers, selectedShop?.region],
  );
  useEffect(() => {
    if (!regionProviders.some((entry) => entry.providerId === provider)) {
      setProvider(regionProviders[0]?.providerId ?? "");
    }
  }, [provider, regionProviders]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedShop) {
      setMessage("Select a Cotik logical shop first.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/cotik/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCotikTrackingRequest({
          logicalShopId,
          orderId,
          tracking,
          provider,
          region: selectedShop.region,
        })),
      });
      const result = await response.json() as { status?: string; reason?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not stage tracking.");
      setMessage(result.status === "STAGED" ? "STAGED. Candidate queued; the worker may send it on its next tick when both switches are ON." : `Tracking paused: ${result.reason ?? "pipeline guard"}.`);
      if (result.status === "STAGED") {
        setOrderId("");
        setTracking("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not stage tracking.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="cotik-tracking-title" style={{ padding: 20, background: "var(--color-surface, #1e293b)", borderRadius: 12, border: "1px solid var(--color-border, #334155)" }}>
      <h3 id="cotik-tracking-title" style={{ margin: 0, fontSize: "1rem", color: "var(--color-ink, #f8fafc)" }}>Stage Cotik tracking</h3>
      <p style={{ margin: "4px 0 16px", fontSize: "0.8125rem", color: "var(--color-ink-muted, #94a3b8)" }}>
        This control stages a candidate; it does not call Cotik directly. When both Cotik switches are ON, the worker may send pending tracking on its next tick.
      </p>
      <form onSubmit={submit} style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Logical shop</span>
          <select name="logicalShopId" value={logicalShopId} onChange={(event) => setLogicalShopId(event.target.value)} disabled={pending || logicalShops.length === 0}>
            {logicalShops.length === 0 ? <option value="">No logical shops configured</option> : logicalShops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Region: {selectedShop?.region ?? "-"}</span>
          <input aria-label="Region" value={selectedShop?.region ?? ""} readOnly disabled />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Order ID</span>
          <input value={orderId} onChange={(event) => setOrderId(event.target.value)} maxLength={128} required disabled={pending || logicalShops.length === 0} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Tracking number</span>
          <input value={tracking} onChange={(event) => setTracking(event.target.value)} maxLength={256} required disabled={pending || logicalShops.length === 0} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Provider</span>
          <select name="provider" value={provider} onChange={(event) => setProvider(event.target.value)} required disabled={pending || regionProviders.length === 0}>
            {regionProviders.length === 0 ? <option value="">No active providers configured</option> : regionProviders.map((entry) => (
              <option key={entry.providerId} value={entry.providerId}>{entry.carrierName} ({entry.providerId})</option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending || logicalShops.length === 0} style={{ minHeight: 44, alignSelf: "end" }}>
          {pending ? "Staging..." : "Stage tracking"}
        </button>
      </form>
      {message && <p role="status" style={{ margin: "12px 0 0", color: "var(--color-ink-muted, #94a3b8)" }}>{message}</p>}
    </section>
  );
}
