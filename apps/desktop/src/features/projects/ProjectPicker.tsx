import { useState } from "react";
import { desktopPorts } from "../../lib/ports";
import type { OpenProject } from "@ai-video/project-core";
import { Button } from "@ai-video/ui-web";
import { cloudRequest } from "../../lib/cloud";
import type { CloudAccount, CloudProject } from "../../lib/cloud";
import { attachCloudProject } from "../../lib/sync";

interface Props { onOpen: (project: OpenProject) => void; account?: CloudAccount | null; restoreError?: string | null; compact?: boolean }

export function ProjectPicker({ onOpen, account, restoreError, compact = false }: Props) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloudProjects, setCloudProjects] = useState<Pick<CloudProject, "id" | "title">[]>([]);

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

  async function listCloudProjects() {
    try {
      setError(null);
      setCloudProjects((await cloudRequest<{ projects: Pick<CloudProject, "id" | "title">[] }>("/projects")).projects);
    } catch (cause) { setError(`读取云端项目失败：${String(cause)}`); }
  }

  async function openCloud(item: Pick<CloudProject, "id" | "title">) {
    if (!account) return;
    try {
      const parent = await desktopPorts.projects.chooseParent();
      if (!parent) return;
      setBusy(true);
      const safeTitle = item.title.replace(/[\\/]/g, "-").trim() || "云端项目";
      const folder = `${safeTitle}-cloud-${item.id.slice(0, 8)}`;
      const root = `${parent.replace(/\/$/, "")}/${folder}`;
      const local = await desktopPorts.projects.create(root, safeTitle);
      const manifest = await attachCloudProject(root, local, account, item.id);
      onOpen({ root, manifest });
    } catch (cause) { setError(`打开云端项目失败：${String(cause)}`); }
    finally { setBusy(false); }
  }

  return <section className={compact ? "project-picker compact" : "project-picker"} aria-label="项目入口">
    {!compact && <><span className="project-picker-kicker">剪辑工作台</span><h1>开始创作</h1><p>创建本地项目，或打开已有项目。素材、时间线和导出都在这里完成。</p></>}
    <p className="project-picker-sync-note">{account ? `新项目先保存在本机；打开后会尝试关联到 ${account.email}，以实际同步状态为准。`
      : "未登录云端账号：新项目仅保存在本机，网页不会显示。"}</p>
    {restoreError && <p className="project-picker-warning" role="alert">{restoreError}</p>}
    <div className="project-picker-actions">
      <Button onClick={() => setCreating(true)} disabled={busy}>＋ 新建项目</Button>
      <Button variant="secondary" onClick={openExisting} disabled={busy}>打开已有项目</Button>
      {account && <Button variant="secondary" onClick={() => void listCloudProjects()} disabled={busy}>从云端打开</Button>}
    </div>
    {cloudProjects.length > 0 && <div className="cloud-project-list" aria-label="云端项目">{cloudProjects.map(item => <button type="button" key={item.id} disabled={busy} onClick={() => void openCloud(item)}>{item.title}</button>)}</div>}
    {creating && <div className="project-picker-form"><label htmlFor="project-title">项目名称</label><input id="project-title" autoFocus value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void create(); }} placeholder="例如：我的第一支短视频" /><div className="project-picker-actions"><Button variant="ghost" onClick={() => setCreating(false)}>取消</Button><Button onClick={create} disabled={busy}>选择保存位置并创建</Button></div></div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
