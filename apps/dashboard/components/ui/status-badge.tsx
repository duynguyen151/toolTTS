import type { ReactNode } from "react";

export type StatusTone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: StatusTone;
};

export function StatusBadge({
  children,
  tone = "neutral",
}: StatusBadgeProps) {
  return (
    <span className="status-badge" data-tone={tone}>
      <span className="status-badge__marker" aria-hidden="true" />
      {children}
    </span>
  );
}
