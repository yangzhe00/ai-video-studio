import type { ReactNode } from "react";
import { StudioIcon } from "@ai-video/ui-web";
import type { SurfaceState } from "./contracts";

export function StatePanel({ state, title, description, action, onAction, detail }: {
  state: SurfaceState; title: string; description: string; action?: string; onAction?: () => void; detail?: ReactNode;
}) {
  const icon = state === "empty" ? "clapper" : state === "loading" ? "refresh" : state === "failed" ? "x" : "search";
  return <section className={`avs-state-panel avs-state-panel--${state}`} role={state === "loading" ? "status" : undefined}>
    <div className="avs-state-icon"><StudioIcon name={icon} size={34} /></div>
    <h2>{title}</h2><p>{description}</p>{detail && <small>{detail}</small>}
    {action && onAction && <button type="button" onClick={onAction}>{action}<StudioIcon name="arrowRight" size={16} /></button>}
  </section>;
}
