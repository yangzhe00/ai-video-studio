import { useEffect, useState } from "react";
import type { CreationBrief, SyncResourceType } from "@ai-video/project-core";

export type SyncConflictChoice = "local" | "cloud";

export interface SyncConflictResource {
  resourceType: SyncResourceType;
  resourceId: string;
  title: string;
  local: { revision: number; preview: string; brief?: Pick<CreationBrief, "source" | "originalText" | "finalText"> };
  cloud: { revision: number; preview: string; brief?: Pick<CreationBrief, "source" | "originalText" | "finalText"> };
}

interface Props {
  projectTitle: string;
  resources: SyncConflictResource[];
  busy?: boolean;
  onCancel: () => void;
  onResolve: (choices: Record<string, SyncConflictChoice>) => void;
}

export function syncConflictKey(resource: Pick<SyncConflictResource, "resourceType" | "resourceId">): string {
  return `${resource.resourceType}:${resource.resourceId}`;
}

const resourceLabels: Record<SyncResourceType, string> = {
  episode: "分集", asset: "素材", character: "主体", canvas: "画布", brief: "创作原文",
};

export function SyncConflictDialog({ projectTitle, resources, busy = false, onCancel, onResolve }: Props) {
  const [choices, setChoices] = useState<Record<string, SyncConflictChoice>>({});
  const resourceSet = resources.map(item => `${syncConflictKey(item)}:${item.local.revision}:${item.cloud.revision}`).join("|");
  useEffect(() => setChoices({}), [resourceSet]);
  const ready = resources.length > 0 && resources.every(item => choices[syncConflictKey(item)]);

  return <div className="avs-sync-conflict-backdrop">
    <section className="avs-sync-conflict" role="dialog" aria-modal="true" aria-labelledby="avs-sync-conflict-title">
      <header>
        <div><span>同步需要你决定</span><h2 id="avs-sync-conflict-title">{projectTitle} 存在 {resources.length} 处冲突</h2></div>
        <button type="button" onClick={onCancel} disabled={busy} aria-label="取消同步">×</button>
      </header>
      <p>逐项选择版本。保留本地会覆盖该云端资源；采用云端会替换本地对应内容。处理前会保存本地项目备份；取消后本地项目保持原样。</p>
      <div className="avs-sync-conflict-list">{resources.map(item => {
        const key = syncConflictKey(item);
        return <fieldset key={key} disabled={busy}>
          <legend>{resourceLabels[item.resourceType]} · {item.title}</legend>
          <div className="avs-sync-conflict-options">
            {(["local", "cloud"] as const).map(side => <label key={side} className={choices[key] === side ? "selected" : ""}>
              <span><input type="radio" name={key} checked={choices[key] === side}
                onChange={() => setChoices(current => ({ ...current, [key]: side }))} />
                {side === "local" ? "保留本地并覆盖云端" : "采用云端"} <small>修订 {item[side].revision}</small></span>
              {item.resourceType === "brief" && item[side].brief ? <div className="avs-sync-conflict-brief">
                <p>来源：{item[side].brief.source === "agent" ? "Agent 灵感" : "手写"}</p>
                <strong>输入原文</strong><pre>{item[side].brief.originalText}</pre>
                <strong>最终创作内容</strong><pre>{item[side].brief.finalText}</pre>
              </div> : <pre>{item[side].preview}</pre>}
            </label>)}
          </div>
        </fieldset>;
      })}</div>
      <footer><button type="button" onClick={onCancel} disabled={busy}>取消，稍后处理</button>
        <button type="button" onClick={() => onResolve(choices)} disabled={!ready || busy}>按选择继续同步</button></footer>
    </section>
  </div>;
}
