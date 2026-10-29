import type { ReactNode } from "react";

export function VideoResultCard({ title, source, meta, actions }: { title: string; source: string; meta?: string; actions?: ReactNode }) {
  return <article className="avs-video-result"><video src={source} controls preload="metadata" /><div><strong>{title}</strong>{meta && <small>{meta}</small>}{actions}</div></article>;
}
