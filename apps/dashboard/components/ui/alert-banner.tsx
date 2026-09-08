import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

export type AlertTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface AlertBannerProps {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function AlertBanner({
  tone = "info",
  title,
  children,
  onDismiss,
  className = "",
}: AlertBannerProps) {
  const Icon =
    tone === "success"
      ? CheckCircleIcon
      : tone === "warning"
      ? ExclamationTriangleIcon
      : tone === "danger"
      ? XCircleIcon
      : InformationCircleIcon;

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      aria-live="polite"
      className={`alert-banner alert-banner--${tone} ${className}`.trim()}
    >
      <Icon className="alert-banner__icon" aria-hidden="true" />
      <div className="alert-banner__content">
        {title && <strong className="alert-banner__title">{title}</strong>}
        <div className="alert-banner__message">{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Đóng thông báo"
          className="alert-banner__dismiss"
          onClick={onDismiss}
        >
          <XMarkIcon aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
