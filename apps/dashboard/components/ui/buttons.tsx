import type { ButtonHTMLAttributes, ReactNode } from "react";

type DashboardButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  leadingIcon?: ReactNode;
  loading?: boolean;
};

function buttonContent(
  leadingIcon: ReactNode,
  loading: boolean,
  children: ReactNode,
) {
  return (
    <>
      {loading ? (
        <span className="button-loader" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      ) : leadingIcon ? (
        <span className="button-icon" aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      <span>{children}</span>
    </>
  );
}

export function PrimaryButton({
  children,
  className = "",
  disabled = false,
  leadingIcon,
  loading = false,
  ...props
}: DashboardButtonProps) {
  return (
    <button
      {...props}
      aria-busy={loading}
      className={`button button--primary ${className}`.trim()}
      disabled={disabled || loading}
    >
      {buttonContent(leadingIcon, loading, children)}
    </button>
  );
}

export function SecondaryButton({
  children,
  className = "",
  disabled = false,
  leadingIcon,
  loading = false,
  ...props
}: DashboardButtonProps) {
  return (
    <button
      {...props}
      aria-busy={loading}
      className={`button button--secondary ${className}`.trim()}
      disabled={disabled || loading}
    >
      {buttonContent(leadingIcon, loading, children)}
    </button>
  );
}
