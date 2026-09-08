import type { ReactNode } from "react";

export interface CardProps {
  id?: string;
  title?: ReactNode;
  eyebrow?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  variant?: "surface" | "subtle" | "strong";
  padding?: "none" | "sm" | "md" | "lg";
}

export function Card({
  id,
  title,
  eyebrow,
  badge,
  actions,
  children,
  className = "",
  variant = "surface",
  padding = "md",
}: CardProps) {
  const hasHeader = title !== undefined || eyebrow !== undefined || badge !== undefined || actions !== undefined;

  return (
    <section
      id={id}
      className={`card card--${variant} card--padding-${padding} ${className}`.trim()}
      {...(title && typeof title === "string" ? { "aria-label": title } : {})}
    >
      {hasHeader && (
        <header className="card__header">
          <div className="card__heading-group">
            {eyebrow && <span className="card__eyebrow">{eyebrow}</span>}
            {title && (typeof title === "string" ? <h2 className="card__title">{title}</h2> : title)}
          </div>
          {(badge !== undefined || actions !== undefined) && (
            <div className="card__actions">
              {badge}
              {actions}
            </div>
          )}
        </header>
      )}
      <div className="card__body">{children}</div>
    </section>
  );
}
