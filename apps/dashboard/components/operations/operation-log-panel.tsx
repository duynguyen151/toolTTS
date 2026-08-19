"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { formatOperationLogText, type OperationLogEntry } from "./operation-log.js";
import styles from "./operations.module.css";

export function OperationLogPanel({
  entries,
  onClear,
  onClose,
  open,
}: {
  readonly entries: readonly OperationLogEntry[];
  readonly onClear: () => void;
  readonly onClose: () => void;
  readonly open: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const updatePortalTarget = (): void => {
      setPortalTarget(document.getElementById(media.matches ? "mobile-log-slot" : "sidebar-log-slot"));
    };
    updatePortalTarget();
    media.addEventListener("change", updatePortalTarget);
    return () => media.removeEventListener("change", updatePortalTarget);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [entries]);

  if (!open) return null;

  const panel = (
    <aside aria-label="Realtime tool log" className={styles.logPanel} id="operation-realtime-log">
        <header className={styles.logHeader}>
          <div>
            <p>Tool console</p>
            <h2>Realtime Log</h2>
          </div>
          <button aria-label="Close log" className={styles.logClose} onClick={onClose} type="button">Close</button>
        </header>
        <div className={styles.logActions}>
          <button onClick={onClear} type="button">Clear</button>
          <button onClick={() => download(entries, "json")} type="button">Download JSON</button>
          <button onClick={() => download(entries, "log")} type="button">Download .log</button>
        </div>
        {entries.length === 0 ? (
          <p className={styles.logEmpty}>No operation events in this session.</p>
        ) : (
          <ol className={styles.logList} ref={listRef}>
            {entries.map((entry, index) => (
              <li data-level={entry.level} key={`${entry.timestamp}-${index}`}>
                <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                <strong>{entry.state}</strong>
                <p>{entry.message}</p>
              </li>
            ))}
          </ol>
        )}
    </aside>
  );

  return portalTarget === null ? panel : createPortal(panel, portalTarget);
}

function download(entries: readonly OperationLogEntry[], format: "json" | "log"): void {
  const content = format === "json"
    ? `${JSON.stringify(entries, null, 2)}\n`
    : formatOperationLogText(entries);
  const url = URL.createObjectURL(new Blob([content], {
    type: format === "json" ? "application/json" : "text/plain",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `tool-log-${new Date().toISOString().replaceAll(":", "-")}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
