"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const DECISIONS = ["SCALE", "CONTINUE", "SLOW_SELL", "WATCH", "PAUSE"] as const;
const PLANNED_METHODS = ["DISABLE_FLASH_SALE", "INCREASE_PRICE", "OTHER"] as const;
const REASONS = [
  "HIGH_ABSOLUTE_EXPOSURE",
  "LOW_DELIVERY_RATE",
  "HIGH_VOLUME_HEALTHY",
  "LOW_SAMPLE_SIZE",
  "CARRIER_SYSTEMIC_DELAY",
  "RAPID_ONHOLD_GROWTH",
  "DELIVERY_DETERIORATION",
  "REFUND_SPIKE",
  "DATA_INCOMPLETE",
  "RECOVERY_TREND",
  "THRESHOLD_FLAPPING",
  "OTHER",
] as const;

export function LiveBaForm({ caseId, profileNo }: { caseId: string; profileNo: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState<string>("");
  const [reasonCode, setReasonCode] = useState<string>("");
  const [plannedMethods, setPlannedMethods] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("A submission creates an append-only LIVE revision.");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!decision || !reasonCode) {
      setMessage("Decision and reason code are required.");
      return;
    }
    if (decision === "SLOW_SELL" && plannedMethods.length === 0) {
      setMessage("At least one planned method is required for SLOW_SELL.");
      return;
    }
    if (decision === "SLOW_SELL" && plannedMethods.includes("OTHER") && !notes.trim()) {
      setMessage("Notes are required when planned method OTHER is selected.");
      return;
    }
    if (reasonCode === "OTHER" && !notes.trim()) {
      setMessage("Notes are required when reason code is OTHER.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/decisions/ba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileNo,
          caseId,
          baDecision: {
            decision,
            reasonCode,
            ...(decision === "SLOW_SELL" ? { plannedMethods } : {}),
            ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
          },
        }),
      });
      const result = await response.json() as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || result.ok !== true) {
        setMessage(result.error?.message ?? "The LIVE BA decision could not be submitted.");
        return;
      }
      setMessage("LIVE BA decision persisted. Reloading the current decision and full revision history.");
      setDecision("");
      setReasonCode("");
      setPlannedMethods([]);
      setNotes("");
      router.refresh();
    } catch {
      setMessage("The LIVE BA decision could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-labelledby="live-ba-submit-heading">
      <h3 id="live-ba-submit-heading">Submit LIVE BA decision</h3>
      <fieldset disabled={busy}>
        <legend>Decision <strong>Required</strong></legend>
        {DECISIONS.map((value) => (
          <label key={value}>
            <input
              name="decision"
              type="radio"
              value={value}
              checked={decision === value}
              onChange={() => setDecision(value)}
            />
            {value}
          </label>
        ))}
      </fieldset>
      <fieldset disabled={busy || decision !== "SLOW_SELL"} hidden={decision !== "SLOW_SELL"}>
        <legend>Planned methods <strong>Required for SLOW_SELL</strong></legend>
        {PLANNED_METHODS.map((method) => <label key={method}><input name="plannedMethods" type="checkbox" value={method} checked={plannedMethods.includes(method)} onChange={(event) => setPlannedMethods((current) => event.target.checked ? [...current, method] : current.filter((value) => value !== method))} />{method}</label>)}
      </fieldset>
      <label>
        Reason code <strong>Required</strong>
        <select name="reasonCode" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
          <option value="">Select a reason</option>
          {REASONS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label>
        Notes {reasonCode === "OTHER" ? <strong>Required for OTHER</strong> : <span>Optional</span>}
        <textarea name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>{busy ? "Submitting..." : "Submit BA decision"}</button>
      <p role="status" aria-live="polite">{message}</p>
    </form>
  );
}
