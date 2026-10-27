import type { HTMLAttributes } from "react";

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "success" | "warning";
};

export function StatusBadge({ tone = "neutral", className = "", ...props }: StatusBadgeProps) {
  return <span className={`avs-status-badge avs-status-badge--${tone} ${className}`.trim()} {...props} />;
}
