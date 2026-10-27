import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { createProject, openProject } from "../../lib/native";
import type { OpenProject } from "../../types/project";

interface Props { onOpen: (project: OpenProject) => void }

export function ProjectHome({ onOpen }: Props) {
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
      const parent = await open({ directory: true, multiple: false, title: "选择项目保存位置" });
      if (!parent || typeof parent !== "string") return;
      setBusy(true);
      const root = `${parent.replace(/\/$/, "")}/${cleanTitle}`;
      onOpen({ root, manifest: await createProject(root, cleanTitle) });
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function openExisting() {
    setError(null);
    try {
      const root = await open({ directory: true, multiple: false, title: "选择项目文件夹" });
      if (!root || typeof root !== "string") return;
      setBusy(true);
      onOpen({ root, manifest: await openProject(root) });
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  return <section className="home-content" aria-labelledby="home-title">
    <div className="eyebrow">创作从这里开始</div>
    <h1 id="home-title">让你的故事动起来。</h1>
    <p className="intro">导入人物或动物照片，按自己的想法生成视频；也可以从已有素材开始剪辑。</p>
    <div className="action-grid">
      <button className="action-card primary" onClick={() => setCreating(true)} disabled={busy} type="button"><span className="action-icon" aria-hidden="true">＋</span><span className="action-text"><strong>新建项目</strong><small>从照片或视频开始创作</small></span><span className="action-arrow" aria-hidden="true">↗</span></button>
      <button className="action-card" onClick={openExisting} disabled={busy} type="button"><span className="action-icon" aria-hidden="true">⌁</span><span className="action-text"><strong>打开项目</strong><small>继续编辑本地创作</small></span><span className="action-arrow" aria-hidden="true">↗</span></button>
    </div>
    {creating && <div className="create-panel"><label htmlFor="project-title">项目名称</label><input id="project-title" autoFocus value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void create(); }} placeholder="例如：我的第一支短视频" /><div className="panel-actions"><button type="button" onClick={() => setCreating(false)}>取消</button><button type="button" onClick={create} disabled={busy}>选择保存位置并创建</button></div></div>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="feature-divider" /><div className="feature-row" aria-label="创作流程"><div><span>01</span><strong>导入素材</strong><small>照片或已有视频</small></div><div><span>02</span><strong>生成与剪辑</strong><small>按镜头调整内容</small></div><div><span>03</span><strong>导出作品</strong><small>视频、封面与文案</small></div></div>
  </section>;
}
