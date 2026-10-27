import type { HTMLAttributes, ReactNode } from "react";

export type PanelProps = HTMLAttributes<HTMLElement> & {
  title?: string;
  action?: ReactNode;
};

export function Panel({ title, action, children, className = "", ...props }: PanelProps) {
  return <section className={`avs-panel ${className}`.trim()} {...props}>
    {(title || action) && <div className="avs-panel__header">{title && <h2>{title}</h2>}{action}</div>}
    {children}
  </section>;
}
