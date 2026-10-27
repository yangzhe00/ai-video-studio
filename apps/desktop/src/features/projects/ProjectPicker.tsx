import { useState } from "react";
import { desktopPorts } from "../../lib/ports";
import type { OpenProject } from "@ai-video/project-core";
import { Button } from "@ai-video/ui-web";

interface Props { onOpen: (project: OpenProject) => void; restoreError?: string | null; compact?: boolean }

export function ProjectPicker({ onOpen, restoreError, compact = false }: Props) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle === "." || cleanTitle === ".." || /[\\/]/.test(cleanTitle)) {
      setError("请输入不含斜杠的项目名称"); return;
    }
    setError(null);
    try {
      const parent = await desktopPorts.projects.chooseParent();
      if (!parent) return;
      setBusy(true);
      const root = `${parent.replace(/\/$/, "")}/${cleanTitle}`;
      onOpen({ root, manifest: await desktopPorts.projects.create(root, cleanTitle) });
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function openExisting() {
    setError(null);
    try {
      const root = await desktopPorts.projects.chooseExisting();
      if (!root) return;
      setBusy(true);
      onOpen({ root, manifest: await desktopPorts.projects.open(root) });
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  return <section className={compact ? "project-picker compact" : "project-picker"} aria-label="项目入口">
    {!compact && <><span className="project-picker-kicker">剪辑工作台</span><h1>开始创作</h1><p>创建本地项目，或打开已有项目。素材、时间线和导出都在这里完成。</p></>}
    {restoreError && <p className="project-picker-warning" role="alert">{restoreError}</p>}
    <div className="project-picker-actions">
      <Button onClick={() => setCreating(true)} disabled={busy}>＋ 新建项目</Button>
      <Button variant="secondary" onClick={openExisting} disabled={busy}>打开已有项目</Button>
    </div>
    {creating && <div className="project-picker-form"><label htmlFor="project-title">项目名称</label><input id="project-title" autoFocus value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void create(); }} placeholder="例如：我的第一支短视频" /><div className="project-picker-actions"><Button variant="ghost" onClick={() => setCreating(false)}>取消</Button><Button onClick={create} disabled={busy}>选择保存位置并创建</Button></div></div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
