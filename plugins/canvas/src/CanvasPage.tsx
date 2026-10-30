import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  CreationBrief, MediaAsset, ProjectManifestV2, StudioEpisode, StudioNode, StudioNodeType,
} from "@ai-video/project-core";
import { StudioIcon } from "@ai-video/ui-web";

type SaveState = "saved" | "saving" | "failed";
interface Props {
  manifest: ProjectManifestV2;
  episode: StudioEpisode;
  projectRoot?: string;
  shareMessage?: string;
  previewUrls: Record<string, string>;
  busy: boolean;
  saveState: SaveState;
  onOpenGenerate: () => void;
  onOpenEditor: () => void;
  onOpenProjects: () => void;
  onSelectEpisode: (id: string) => void;
  onCreateEpisode: () => void;
  onImportPhoto: () => Promise<string | null>;
  onCreateCharacter: (name: string, description: string, assetId: string) => void;
  onAddCharacterNode: (characterId: string) => void;
  onAddNode: (type: StudioNodeType, assetId?: string) => void;
  onAddDownstreamVideo: (fromId: string) => void;
  onUpdateNode: (nodeId: string, changes: Partial<Omit<StudioNode, "id" | "type">>) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onRemoveNode: (nodeId: string) => void;
  onConnect: (from: string, to: string) => void;
  onDisconnect: (edgeId: string) => void;
  onRunVideo: (nodeId: string) => void;
  onRefreshJob: (jobId: string) => void;
  onAddVideoToTimeline: (nodeId: string, assetId: string) => void;
  onReorderClip: (clipId: string, targetIndex: number) => void;
  onExport?: () => void;
  onOpenVoiceover?: () => void;
  creationBriefs?: CreationBrief[];
  onUpdateCreationBrief?: (id: string, finalText: string, expectedRemoteText?: string) => void | Promise<void>;
}

function shortName(asset: MediaAsset | undefined) { return asset?.relativePath.split("/").pop() ?? "未命名素材"; }
function duration(ms: number) { return `${Math.round(ms / 1000)} 秒`; }

interface BriefConflict { remoteText: string }
function briefSessionKey(projectId: string) { return `avs-brief-drafts:${projectId}`; }
function readBriefSession(projectId: string): { drafts: Record<string, string>; conflicts: Record<string, BriefConflict> } {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(briefSessionKey(projectId)) ?? "{}") as {
      drafts?: Record<string, string>; conflicts?: Record<string, BriefConflict>;
    };
    return { drafts: raw.drafts ?? {}, conflicts: raw.conflicts ?? {} };
  } catch { return { drafts: {}, conflicts: {} }; }
}
function briefConflictFrom(error: unknown): BriefConflict | null {
  if (!error || typeof error !== "object") return null;
  const value = error as { kind?: unknown; remoteText?: unknown };
  return value.kind === "creation-brief-conflict" && typeof value.remoteText === "string"
    ? { remoteText: value.remoteText } : null;
}

function nodeSize(type: StudioNodeType) {
  if (type === "character" || type === "image") return { w: 237, h: 272 };
  if (type === "text") return { w: 270, h: 270 };
  if (type === "video") return { w: 425, h: 340 };
  return { w: 440, h: 157 };
}

interface CanvasRect { left: number; top: number; right: number; bottom: number }
function inspectorPosition(anchor: CanvasRect, nodes: CanvasRect[], width: number, height: number, panelWidth: number, panelHeight: number) {
  const gap = 16;
  const clamp = (value: number, maximum: number) => Math.max(12, Math.min(value, Math.max(12, maximum - 12)));
  const overlap = (a: CanvasRect, b: CanvasRect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const choices = [
    { left: anchor.right + gap, top: anchor.top },
    { left: anchor.left - panelWidth - gap, top: anchor.top },
    { left: anchor.left, top: anchor.bottom + gap },
    { left: anchor.left, top: anchor.top - panelHeight - gap },
  ];
  return choices.map((choice, index) => {
    const left = clamp(choice.left, width - panelWidth);
    const top = clamp(choice.top, height - panelHeight);
    const panel = { left, top, right: left + panelWidth, bottom: top + panelHeight };
    const score = nodes.reduce((sum, node) => sum + overlap(panel, node), 0)
      + (Math.abs(left - choice.left) + Math.abs(top - choice.top)) * 180 + index;
    return { left, top, score };
  }).sort((a, b) => a.score - b.score)[0];
}

export function CanvasPage({
  manifest, episode, projectRoot, shareMessage, previewUrls, busy, saveState, onOpenGenerate, onOpenEditor,
  onOpenProjects, onSelectEpisode, onCreateEpisode, onImportPhoto, onCreateCharacter, onAddCharacterNode,
  onAddNode, onAddDownstreamVideo, onUpdateNode, onMoveNode, onRemoveNode, onConnect, onDisconnect,
  onRunVideo, onRefreshJob, onAddVideoToTimeline, onReorderClip, onExport, onOpenVoiceover, creationBriefs = [], onUpdateCreationBrief,
}: Props) {
  const [zoom, setZoom] = useState(50);
  const [handMode, setHandMode] = useState(false);
  const [pan, setPan] = useState({ x: 104, y: 35 });
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectionCursor, setConnectionCursor] = useState<{ x: number; y: number } | null>(null);
  const [addFromId, setAddFromId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [modal, setModal] = useState<"character" | "image" | "clip" | "share" | null>(null);
  const [characterName, setCharacterName] = useState("");
  const [characterDescription, setCharacterDescription] = useState("");
  const [photoId, setPhotoId] = useState("");
  const [nodeTitle, setNodeTitle] = useState("");
  const [nodePrompt, setNodePrompt] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [briefDraft, setBriefDraft] = useState("");
  const [briefDrafts, setBriefDrafts] = useState<Record<string, string>>(() => readBriefSession(manifest.id).drafts);
  const [briefConflicts, setBriefConflicts] = useState<Record<string, BriefConflict>>(() => readBriefSession(manifest.id).conflicts);
  const [briefError, setBriefError] = useState("");
  const [briefSaving, setBriefSaving] = useState(false);
  const activeBrief = creationBriefs.find(item => item.id === briefId) ?? creationBriefs[0];
  const activeBriefConflict = activeBrief ? briefConflicts[activeBrief.id] : undefined;
  useEffect(() => {
    try { window.sessionStorage.setItem(briefSessionKey(manifest.id), JSON.stringify({ drafts: briefDrafts, conflicts: briefConflicts })); }
    catch { /* the current panel still retains the draft */ }
  }, [manifest.id, briefDrafts, briefConflicts]);

  function setCurrentBriefDraft(id: string, value: string) {
    setBriefDraft(value);
    setBriefDrafts(current => ({ ...current, [id]: value }));
  }
  function clearBriefDraft(id: string) {
    setBriefDrafts(current => { const next = { ...current }; delete next[id]; return next; });
    setBriefConflicts(current => { const next = { ...current }; delete next[id]; return next; });
  }
  function saveBrief(id: string, text: string, expectedRemoteText?: string) {
    if (!onUpdateCreationBrief) return;
    setBriefSaving(true); setBriefError("");
    void Promise.resolve().then(() => onUpdateCreationBrief(id, text, expectedRemoteText)).then(() => {
      clearBriefDraft(id);
      setBriefDraft(text);
    }).catch(cause => {
      const conflict = briefConflictFrom(cause);
      if (conflict) {
        setBriefConflicts(current => ({ ...current, [id]: conflict }));
        setBriefError("这条原文已在另一端修改。请比较两版后明确选择，当前没有覆盖云端。");
      } else setBriefError(String(cause));
    }).finally(() => setBriefSaving(false));
  }
  const dragRef = useRef<{ id: string; sx: number; sy: number; x: number; y: number } | null>(null);
  const connectionDragRef = useRef<{ fromId: string; sx: number; sy: number; moved: boolean } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 });
  const [inspectorHeight, setInspectorHeight] = useState(320);
  const zoomTouched = useRef(false);
  const selectedNode = episode.nodes.find(node => node.id === selectedId) ?? null;
  const selectedEdge = episode.edges.find(edge => edge.id === selectedEdgeId) ?? null;
  const imageAssets = manifest.assets.filter(asset => asset.kind === "image" && !asset.missing);
  const totalMs = manifest.clips.reduce((sum, clip) => sum + clip.outMs - clip.inMs, 0);
  const onlyTimeline = episode.nodes.length === 1 && episode.nodes[0]?.type === "timeline";

  useEffect(() => { zoomTouched.current = false; setPositions({}); setSelectedId(null); setConnectingFrom(null); setConnectionCursor(null); setAddFromId(null); setPan({ x: 104, y: 35 }); }, [episode.id]);
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const fit = () => {
      setWorkspaceSize(current => current.width === workspace.clientWidth && current.height === workspace.clientHeight
        ? current : { width: workspace.clientWidth, height: workspace.clientHeight });
      if (zoomTouched.current) return;
      const right = Math.max(1000, ...episode.nodes.map(node => node.x + nodeSize(node.type).w));
      setZoom(Math.max(25, Math.min(57, Math.floor((workspace.clientWidth - 135) / right * 57))));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [episode.id, episode.nodes.length]);
  useEffect(() => {
    setNodeTitle(selectedNode?.title ?? "");
    setNodePrompt(selectedNode?.prompt ?? "");
  }, [selectedNode?.id]);
  useEffect(() => {
    const inspector = inspectorRef.current;
    if (!inspector) return;
    const measure = () => setInspectorHeight(current => current === inspector.offsetHeight ? current : inspector.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(inspector);
    return () => observer.disconnect();
  }, [selectedId, selectedEdgeId, manifest.clips.length]);

  function position(node: StudioNode) { return positions[node.id] ?? { x: node.x, y: node.y }; }
  function port(node: StudioNode, side: "in" | "out") {
    const pos = position(node), size = nodeSize(node.type);
    if (node.type === "timeline") return { x: pos.x + size.w / 2, y: pos.y };
    if (node.type === "video") return side === "in" ? { x: pos.x, y: pos.y + 176 } : { x: pos.x + size.w / 2, y: pos.y + size.h };
    return { x: pos.x + size.w, y: pos.y + size.h / 2 };
  }
  function edgePath(from: StudioNode, to: StudioNode) {
    const a = port(from, "out"), b = port(to, "in");
    if (to.type === "timeline") return `M ${a.x} ${a.y} C ${a.x} ${a.y + 60}, ${b.x} ${b.y - 60}, ${b.x} ${b.y}`;
    const gap = Math.max(48, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + gap} ${a.y}, ${b.x - gap} ${b.y}, ${b.x} ${b.y}`;
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, node: StudioNode) {
    if (busy || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pos = position(node);
    dragRef.current = { id: node.id, sx: event.clientX, sy: event.clientY, x: pos.x, y: pos.y };
    setSelectedId(node.id);
    setSelectedEdgeId(null);
  }
  function dragMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const scale = zoom / 57;
    setPositions(current => ({ ...current, [drag.id]: { x: Math.round(drag.x + (event.clientX - drag.sx) / scale), y: Math.round(drag.y + (event.clientY - drag.sy) / scale) } }));
  }
  function stopDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const scale = zoom / 57;
    const x = Math.round(drag.x + (event.clientX - drag.sx) / scale);
    const y = Math.round(drag.y + (event.clientY - drag.sy) / scale);
    if (x !== drag.x || y !== drag.y) onMoveNode(drag.id, x, y);
  }

  function finishConnection(targetId: string) {
    if (!connectingFrom) { setSelectedId(targetId); return; }
    if (connectingFrom !== targetId) onConnect(connectingFrom, targetId);
    setConnectingFrom(null);
    setConnectionCursor(null);
    setAddFromId(null);
  }

  function startConnectionDrag(event: ReactPointerEvent<HTMLButtonElement>, fromId: string) {
    if (busy || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    connectionDragRef.current = { fromId, sx: event.clientX, sy: event.clientY, moved: false };
    setConnectingFrom(fromId);
    setConnectionCursor(null);
    setAddFromId(null);
    setSelectedId(null);
    setSelectedEdgeId(null);
  }
  function moveConnectionDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = connectionDragRef.current;
    const workspace = workspaceRef.current;
    if (!drag || !workspace) return;
    if (Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) < 4 && !drag.moved) return;
    drag.moved = true;
    const rect = workspace.getBoundingClientRect();
    const scale = zoom / 57;
    setConnectionCursor({ x: (event.clientX - rect.left - pan.x) / scale, y: (event.clientY - rect.top - pan.y) / scale });
  }
  function stopConnectionDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = connectionDragRef.current;
    if (!drag) return;
    event.stopPropagation();
    connectionDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setConnectionCursor(null);
    if (!drag.moved) return;
    const target = document.elementFromPoint?.(event.clientX, event.clientY)?.closest<HTMLElement>("[data-canvas-node-id]");
    const targetId = target?.dataset.canvasNodeId;
    if (targetId && targetId !== drag.fromId) onConnect(drag.fromId, targetId);
    setConnectingFrom(null);
  }

  function addImageNode() {
    if (!imageAssets.length) { setModal("image"); return; }
    setPhotoId(imageAssets[0].id);
    setModal("image");
  }

  async function importForModal() {
    const id = await onImportPhoto();
    if (id) setPhotoId(id);
  }

  function videoResult(node: StudioNode) {
    const matchingJobs = manifest.jobs.filter(item => item.shotId === node.shotId);
    const job = matchingJobs[matchingJobs.length - 1];
    const resultAssetId = node.resultAssetId ?? job?.outputAssetId ?? undefined;
    return { job, resultAssetId, asset: manifest.assets.find(asset => asset.id === resultAssetId) };
  }

  const toolbar: { name: string; icon: Parameters<typeof StudioIcon>[0]["name"]; action?: () => void; active?: boolean }[] = [
    { name: "文本", icon: "text", action: () => onAddNode("text") },
    { name: "图片", icon: "image", action: addImageNode },
    { name: "视频", icon: "video", action: () => onAddNode("video"), active: true },
    { name: "音频", icon: "audio" },
    { name: "时间线", icon: "clapper", action: () => setSelectedId(episode.nodes.find(node => node.type === "timeline")?.id ?? null) },
    { name: "主体", icon: "user", action: () => { setPhotoId(imageAssets[0]?.id ?? ""); setModal("character"); } },
    { name: "资产", icon: "folder", action: onOpenEditor },
    { name: "上传", icon: "upload", action: () => void importForModal() },
  ];

  const inspectorPlacement = (() => {
    if (!selectedNode && !selectedEdge) return undefined;
    const width = workspaceSize.width || workspaceRef.current?.clientWidth || 1000;
    const height = workspaceSize.height || workspaceRef.current?.clientHeight || 700;
    const scale = zoom / 57;
    const source = selectedEdge && episode.nodes.find(node => node.id === selectedEdge.from);
    const target = selectedEdge && episode.nodes.find(node => node.id === selectedEdge.to);
    const nodePos = selectedNode ? position(selectedNode) : null;
    const nodeWidth = selectedNode ? nodeSize(selectedNode.type).w : 0;
    const edgeMiddle = source && target ? { x: (port(source, "out").x + port(target, "in").x) / 2,
      y: (port(source, "out").y + port(target, "in").y) / 2 } : null;
    const anchorLeft = pan.x + (nodePos?.x ?? edgeMiddle?.x ?? 0) * scale;
    const anchorRight = pan.x + ((nodePos?.x ?? edgeMiddle?.x ?? 0) + nodeWidth) * scale;
    const anchorTop = pan.y + (nodePos?.y ?? edgeMiddle?.y ?? 0) * scale;
    const anchorBottom = anchorTop + (selectedNode ? nodeSize(selectedNode.type).h * scale : 0);
    const panelWidth = Math.min(300, Math.max(180, width - 24));
    const panelHeight = Math.min(inspectorHeight || 320, Math.max(100, height - 24));
    const nodeRects = episode.nodes.map(node => {
      const pos = position(node), size = nodeSize(node.type);
      const left = pan.x + pos.x * scale, top = pan.y + pos.y * scale;
      return { left, top, right: left + size.w * scale, bottom: top + size.h * scale };
    });
    const { left, top } = inspectorPosition({ left: anchorLeft, top: anchorTop, right: anchorRight, bottom: anchorBottom },
      nodeRects, width, height, panelWidth, panelHeight);
    return { left, top };
  })();

  return <div className="film-canvas-view">
    <header className="film-canvas-header">
      <span className="film-canvas-logo">✦</span>
      <select aria-label="当前分集" value={episode.id} onChange={event => onSelectEpisode(event.target.value)}>{manifest.studio!.episodes.map(item => <option key={item.id} value={item.id}>{item.title} · {manifest.title}</option>)}</select>
      <button type="button" className="film-canvas-new-episode" onClick={onCreateEpisode} title="新建分集"><StudioIcon name="plus" size={16} /></button>
      <span className="film-node-count">{episode.nodes.length} 个节点 / {episode.edges.length} 条连接</span>
      <span className="film-saved"><i className={saveState === "failed" ? "failed" : ""} />{saveState === "saving" ? "保存中" : saveState === "failed" ? "保存失败" : "已保存"}</span>
      <span className="film-canvas-header-spacer" />
      <button type="button" className="film-header-share" onClick={() => {
        const selected = activeBrief;
        setBriefId(selected?.id ?? null); setBriefDraft(selected ? briefDrafts[selected.id] ?? selected.finalText : ""); setBriefError(""); setBriefOpen(true);
      }}>创作原文{creationBriefs.length ? ` (${creationBriefs.length})` : ""}</button>
      <button type="button" className="film-header-share" onClick={onOpenGenerate}><StudioIcon name="sparkles" size={17} />生成</button>
      {searchOpen && <input className="film-canvas-search" aria-label="搜索节点" autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索节点" />}
      <button type="button" className="film-header-icon-button" title="搜索节点" aria-label="搜索节点" onClick={() => setSearchOpen(value => !value)}><StudioIcon name="search" size={18} /></button>
      <button type="button" className="film-header-share" onClick={() => setModal("share")}><StudioIcon name="share" size={17} />分享</button>
      {onOpenVoiceover && <button type="button" className="film-header-share" onClick={onOpenVoiceover}>配音与混音</button>}
      <button type="button" className="film-header-export" onClick={onExport} disabled={!onExport || busy || !manifest.clips.length} title={onExport ? "导出整集" : "当前平台暂不支持整集导出"}><StudioIcon name="film" size={17} />导出整集</button>
    </header>
    <div className="film-canvas-body">
      <div className="film-node-toolbar" role="toolbar" aria-label="添加节点">
        {toolbar.map(item => <button key={item.name} type="button" title={item.action ? `添加或打开${item.name}` : `${item.name}稍后支持`} aria-label={item.name} className={item.active ? "active" : ""} onClick={item.action} disabled={!item.action || busy}><StudioIcon name={item.icon} size={19} /></button>)}
      </div>
      <div className="film-canvas-scroll">
        <section ref={workspaceRef} className="film-canvas-workspace" aria-label="分集画布" style={{ backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${48 * zoom / 57}px ${48 * zoom / 57}px` }} onPointerDown={event => {
        if (!handMode || (event.target as Element).closest(".film-node, button")) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        panRef.current = { sx: event.clientX, sy: event.clientY, x: pan.x, y: pan.y };
      }} onPointerMove={event => {
        if (!panRef.current) return;
        const item = panRef.current;
        setPan({ x: item.x + event.clientX - item.sx, y: item.y + event.clientY - item.sy });
      }} onPointerUp={() => { panRef.current = null; }} onPointerCancel={() => { panRef.current = null; }}>
          <div className="film-canvas-chapter"><strong>EPISODE {String(manifest.studio!.episodes.findIndex(item => item.id === episode.id) + 1).padStart(2, "0")}</strong> / {episode.title}<span>连接节点，逐个运行，组合成一集</span></div>
          <div className="film-canvas-layer" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 57})` }}>
            <svg className="film-canvas-connections" aria-hidden="true">
              {episode.edges.map(edge => {
                const from = episode.nodes.find(node => node.id === edge.from), to = episode.nodes.find(node => node.id === edge.to);
                if (!from || !to) return null;
                return <path key={edge.id} d={edgePath(from, to)} className={selectedEdgeId === edge.id ? "selected" : ""} onClick={() => { setSelectedEdgeId(edge.id); setSelectedId(null); }} />;
              })}
              {connectingFrom && connectionCursor && (() => {
                const source = episode.nodes.find(node => node.id === connectingFrom);
                if (!source) return null;
                const start = port(source, "out");
                const bend = Math.max(48, Math.abs(connectionCursor.x - start.x) / 2);
                return <path className="film-canvas-connection-preview" d={`M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${connectionCursor.x - bend} ${connectionCursor.y}, ${connectionCursor.x} ${connectionCursor.y}`} />;
              })()}
            </svg>
            {episode.nodes.map(node => {
              if (onlyTimeline && selectedId !== node.id) return null;
              const pos = position(node);
              const highlight = !search || `${node.title} ${node.prompt ?? ""}`.toLowerCase().includes(search.toLowerCase());
              const character = manifest.studio!.characters.find(item => item.id === node.characterId);
              const asset = manifest.assets.find(item => item.id === (node.type === "character" ? character?.assetId : node.assetId));
              const result = node.type === "video" ? videoResult(node) : null;
              const resultUrl = result?.resultAssetId ? previewUrls[result.resultAssetId] : null;
              const shot = node.shotId ? manifest.shots.find(item => item.id === node.shotId) : null;
              return <article key={node.id} data-canvas-node-id={node.id} className={`film-node film-node-${node.type}${selectedId === node.id ? " selected" : ""}${addFromId === node.id ? " menu-open" : ""}${highlight ? "" : " dimmed"}`}
                style={{ left: pos.x, top: pos.y }} onClick={() => { if (connectingFrom) finishConnection(node.id); else { setSelectedId(node.id); setSelectedEdgeId(null); } }}>
                <div className="film-node-heading" onPointerDown={event => startDrag(event, node)} onPointerMove={dragMove} onPointerUp={stopDrag}>
                  <StudioIcon name={node.type === "character" ? "user" : node.type === "image" ? "image" : node.type === "text" ? "text" : node.type === "video" ? "video" : "clapper"} size={18} />
                  <strong>{node.type === "character" ? "主体 / " : node.type === "text" ? "文本 / " : node.type === "image" ? "图片 / " : node.type === "video" ? "视频 / " : ""}{node.title}</strong>
                  {result?.job && <span className="film-node-job-state">{result.job.state === "succeeded" ? "已生成" : result.job.state === "running" ? "生成中" : result.job.state === "queued" ? "排队中" : result.job.state === "unknown" ? "待确认" : result.job.state === "failed" ? "失败" : "处理中"}</span>}
                </div>
                {(node.type === "character" || node.type === "image") && <div className="film-node-character-body">
                  <div className="film-node-media">{asset && previewUrls[asset.id] ? <img src={previewUrls[asset.id]} alt={shortName(asset)} /> : <StudioIcon name="image" size={32} />}</div>
                  <p>{node.type === "character" ? character?.description || "参考照片 · 已锁定外貌" : shortName(asset)}</p>
                  <button type="button" onClick={event => { event.stopPropagation(); setSelectedId(node.id); }}>{node.type === "character" ? "编辑人物" : "查看图片"} →</button>
                </div>}
                {node.type === "text" && <div className="film-node-text-body"><small>SHOT 01</small><p>{node.prompt || "点击节点，写下镜头、动作和场景。"}</p><span>输出：提示词</span></div>}
                {node.type === "video" && <div className="film-node-video-body">
                  <div className="film-node-video-preview">{resultUrl ? <video src={resultUrl} muted preload="auto" /> : <StudioIcon name="video" size={32} />}
                    {resultUrl && <button type="button" aria-label="播放视频" onClick={event => { event.stopPropagation(); setPlayingUrl(resultUrl); }}><StudioIcon name="play" size={20} /></button>}
                  </div>
                  <strong>{node.title}</strong>
                  <span>{shot?.durationSec ?? node.durationSec ?? 5} 秒 · 无台词 · 逐节点运行</span>
                  {result?.resultAssetId ? <button type="button" onClick={event => { event.stopPropagation(); onAddVideoToTimeline(node.id, result.resultAssetId!); }}>加入时间线</button>
                    : result?.job && !["failed", "succeeded", "draft"].includes(result.job.state) ? <button type="button" onClick={event => { event.stopPropagation(); onRefreshJob(result.job!.id); }}>查询原任务</button>
                      : <button type="button" onClick={event => { event.stopPropagation(); onRunVideo(node.id); }} disabled={busy}>运行此节点</button>}
                </div>}
                {node.type === "timeline" && <div className="film-node-timeline-body"><span>{manifest.clips.length} 个片段 · {duration(totalMs)}</span>
                  <div className="film-node-clip-track">{manifest.clips.slice(0, 3).map((clip, index) => <button type="button" key={clip.id} onClick={event => { event.stopPropagation(); setSelectedId(node.id); }} className={index === 0 ? "first" : ""}>{String(index + 1).padStart(2, "0")} &nbsp;{shortName(manifest.assets.find(asset => asset.id === clip.assetId))}</button>)}
                    <button type="button" className="film-node-add-clip" onClick={event => { event.stopPropagation(); setModal("clip"); }}><StudioIcon name="plus" size={17} /></button></div>
                </div>}
                {node.type !== "timeline" && <><button type="button" className="film-node-port out" aria-label={`从${node.title}开始连线`}
                  onPointerDown={event => startConnectionDrag(event, node.id)} onPointerMove={moveConnectionDrag} onPointerUp={stopConnectionDrag}
                  onPointerCancel={() => { connectionDragRef.current = null; setConnectingFrom(null); setConnectionCursor(null); }}
                  onClick={event => { event.stopPropagation(); if (event.detail === 0) { setConnectingFrom(node.id); setAddFromId(null); } }} />
                  <button type="button" className="film-node-add-next" aria-label={`从${node.title}添加下游节点`} onClick={event => { event.stopPropagation(); setAddFromId(node.id); setConnectingFrom(null); }}><StudioIcon name="plus" size={13} /></button></>}
                {(node.type === "video" || node.type === "timeline") && <button type="button" className={`film-node-port in${node.type === "timeline" ? " top" : ""}`} aria-label={`连接到${node.title}`} onClick={event => { event.stopPropagation(); finishConnection(node.id); }} />}
                {addFromId === node.id && <div className={`film-add-node-menu${node.type === "video" ? " below" : ""}`} onClick={event => event.stopPropagation()}>
                  <small>添加下游节点</small>
                  {node.type === "video" ? <button type="button" disabled={!result?.resultAssetId} onClick={() => { onAddVideoToTimeline(node.id, result!.resultAssetId!); setAddFromId(null); setConnectingFrom(null); }}><StudioIcon name="clapper" size={15} />加入整集时间线</button>
                    : <button type="button" onClick={() => { onAddDownstreamVideo(node.id); setAddFromId(null); setConnectingFrom(null); }}><StudioIcon name="video" size={15} />新建视频节点</button>}
                  <button type="button" onClick={() => { setConnectingFrom(node.id); setAddFromId(null); }}><StudioIcon name="link" size={15} />连接已有节点</button>
                </div>}
              </article>;
            })}
          </div>
          {onlyTimeline && <div className="film-canvas-empty-hint"><span className="film-canvas-empty-icon"><StudioIcon name="share" size={32} /></span><strong>从第一个节点开始</strong><p>上传参考照片创建人物，或添加文本、图片和视频节点。<br />节点连接后由你逐个运行，最终编排成一集。</p><div><button type="button" onClick={() => { setPhotoId(imageAssets[0]?.id ?? ""); setModal("character"); }}>＋ 创建人物</button><button type="button" onClick={() => onAddNode("video")}>＋ 添加节点</button></div></div>}
        </section>
      </div>
      {connectingFrom && <div className="film-connect-hint" role="status">{episode.nodes.find(node => node.id === connectingFrom)?.type === "video" ? "选择时间线节点完成连接" : "选择视频节点完成连接"} <button type="button" onClick={() => { setConnectingFrom(null); setConnectionCursor(null); }}>取消</button></div>}
      <div className="film-canvas-bottom-tools"><button type="button" className={!handMode ? "active" : ""} onClick={() => setHandMode(false)} aria-label="选择工具"><StudioIcon name="cursor" size={16} /></button><button type="button" className={handMode ? "active" : ""} onClick={() => setHandMode(true)} aria-label="平移工具"><StudioIcon name="hand" size={16} /></button><span /><button type="button" onClick={() => { zoomTouched.current = true; setZoom(value => Math.max(25, value - 10)); }} aria-label="缩小">−</button><output>{zoom}%</output><button type="button" onClick={() => { zoomTouched.current = true; setZoom(value => Math.min(110, value + 10)); }} aria-label="放大">＋</button></div>
      <p className="film-canvas-help">拖拽连接点，或依次点击两端连接点</p>
    {(selectedNode || selectedEdge) && <aside ref={inspectorRef} className="film-node-inspector" aria-label="节点设置" style={inspectorPlacement}>
      <div className="film-inspector-head"><strong>{selectedNode ? "节点设置" : "连接设置"}</strong><button type="button" onClick={() => { setSelectedId(null); setSelectedEdgeId(null); }} aria-label="关闭设置"><StudioIcon name="x" size={18} /></button></div>
      {selectedEdge ? <><p>这条连接会把上游内容传递给下游节点。</p><button type="button" className="film-inspector-delete" onClick={() => { onDisconnect(selectedEdge.id); setSelectedEdgeId(null); }}><StudioIcon name="trash" size={16} />断开连接</button></>
        : selectedNode && <><small>{selectedNode.type === "character" ? "人物主体" : selectedNode.type === "image" ? "参考图片" : selectedNode.type === "text" ? "镜头描述" : selectedNode.type === "video" ? "视频镜头" : "整集编排"}</small>
          {selectedNode.type !== "timeline" && <label>节点名称<input value={nodeTitle} onChange={event => setNodeTitle(event.target.value)} onBlur={() => { if (nodeTitle.trim() && nodeTitle !== selectedNode.title) onUpdateNode(selectedNode.id, { title: nodeTitle.trim() }); }} /></label>}
          {(selectedNode.type === "text" || selectedNode.type === "video") && <label>镜头提示词<textarea value={nodePrompt} onChange={event => setNodePrompt(event.target.value)} onBlur={() => { if (nodePrompt !== selectedNode.prompt) onUpdateNode(selectedNode.id, { prompt: nodePrompt }); }} placeholder="描述动作、场景和镜头" /></label>}
          {selectedNode.type === "video" && <><p>新生成镜头固定 5 秒。{selectedNode.durationSec === 10 ? "此旧节点原有 10 秒素材仍可编辑；再次运行将生成 5 秒视频。" : "连接人物或图片、文本后，可逐节点运行。"}</p>{selectedNode.resultAssetId && <button type="button" onClick={() => onRunVideo(selectedNode.id)}>再次生成此节点</button>}</>}
          {selectedNode.type === "timeline" && <><p>本集片段顺序</p><ol className="film-inspector-clips">{manifest.clips.map((clip, index) => <li key={clip.id}><span>{index + 1}. {shortName(manifest.assets.find(asset => asset.id === clip.assetId))}</span><button type="button" disabled={index === 0} onClick={() => onReorderClip(clip.id, index - 1)} aria-label={`将片段 ${index + 1} 前移`}>↑</button><button type="button" disabled={index === manifest.clips.length - 1} onClick={() => onReorderClip(clip.id, index + 1)} aria-label={`将片段 ${index + 1} 后移`}>↓</button></li>)}</ol>{onOpenVoiceover && <button type="button" onClick={onOpenVoiceover}>本集配音与混音 →</button>}<button type="button" onClick={onOpenEditor}>详细剪辑与字幕 →</button></>}
          {selectedNode.type !== "timeline" && <button type="button" className="film-inspector-delete" onClick={() => { if (window.confirm("删除节点会同时断开相关连接，确定删除？")) { onRemoveNode(selectedNode.id); setSelectedId(null); } }}><StudioIcon name="trash" size={16} />删除节点</button>}
        </>}
    </aside>}
    </div>
    {briefOpen && <div className="film-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setBriefOpen(false); }}><section className="film-modal film-brief-panel" role="dialog" aria-modal="true" aria-label="创作原文">
      <div className="film-modal-title"><strong>创作原文 · 非执行资料</strong><button type="button" onClick={() => setBriefOpen(false)} aria-label="关闭"><StudioIcon name="x" size={18} /></button></div>
      <p>这里保存你的原始构思。需要生成时，请手动创建镜头节点并明确运行。</p>
      {creationBriefs.length === 0 ? <p>这个项目还没有创作原文。</p> : <>
        {creationBriefs.length > 1 && <label>选择原文<select aria-label="选择创作原文" value={activeBrief?.id} onChange={event => {
          const next = creationBriefs.find(item => item.id === event.target.value);
          setBriefId(next?.id ?? null); setBriefDraft(next ? briefDrafts[next.id] ?? next.finalText : ""); setBriefError("");
        }}>{creationBriefs.map(item => <option key={item.id} value={item.id}>{item.source === "agent" ? "Agent 灵感" : "我的内容"} · {new Date(item.createdAt).toLocaleString("zh-CN")}</option>)}</select></label>}
        <label>输入原文<textarea aria-label="输入原文" value={activeBrief?.originalText ?? ""} readOnly /></label>
        <label>最终创作内容<textarea aria-label="最终创作内容" value={briefDraft} onChange={event => {
          if (activeBrief) setCurrentBriefDraft(activeBrief.id, event.target.value);
        }} /></label>
        <small>{Array.from(briefDraft).length} / 10000 字</small>
        {briefError && <p role="alert">{briefError}</p>}
        {activeBriefConflict && activeBrief && <section className="film-brief-conflict" aria-label="创作原文冲突比较">
          <h3>创作原文有两个版本</h3><p>确认处理前，云端内容不会被覆盖。</p>
          <div><label>本端草稿<textarea aria-label="本端草稿" value={briefDraft} readOnly /></label>
            <label>云端当前版本<textarea aria-label="云端当前版本" value={activeBriefConflict.remoteText} readOnly /></label></div>
          <button type="button" onClick={() => setBriefOpen(false)}>保留本端草稿并返回</button>
          <button type="button" onClick={() => { setBriefDraft(activeBriefConflict.remoteText); clearBriefDraft(activeBrief.id); setBriefError(""); }}>使用云端版本</button>
          {onUpdateCreationBrief && <button type="button" disabled={briefSaving || !briefDraft.trim() || Array.from(briefDraft).length > 10000} onClick={() => {
            if (!window.confirm("确定用本端草稿覆盖当前云端版本？原始输入仍会保留。")) return;
            saveBrief(activeBrief.id, briefDraft, activeBriefConflict.remoteText);
          }}>确认以本端草稿覆盖云端版本</button>}
        </section>}
        {onUpdateCreationBrief && !activeBriefConflict && <button type="button" className="film-modal-primary" disabled={briefSaving || !briefDraft.trim() || Array.from(briefDraft).length > 10000 || briefDraft === activeBrief?.finalText} onClick={() => {
          if (activeBrief) saveBrief(activeBrief.id, briefDraft);
        }}>保存原文修改</button>}
      </>}
    </section></div>}
    {modal && <div className="film-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}><div className="film-modal" role="dialog" aria-modal="true" aria-label={modal === "character" ? "创建人物" : modal === "image" ? "添加图片节点" : modal === "clip" ? "加入时间线" : "分享画布"}>
      <div className="film-modal-title"><strong>{modal === "character" ? "创建人物" : modal === "image" ? "添加参考图片" : modal === "clip" ? "选择视频片段" : "分享画布"}</strong><button type="button" onClick={() => setModal(null)} aria-label="关闭"><StudioIcon name="x" size={18} /></button></div>
      {modal === "character" && <>
        {manifest.studio!.characters.length > 0 && <div className="film-existing-characters"><small>使用已有主体</small>{manifest.studio!.characters.map(character => <button type="button" className="film-episode-option" key={character.id} onClick={() => { onAddCharacterNode(character.id); setModal(null); }}><StudioIcon name="user" size={17} />{character.name}<StudioIcon name="plus" size={15} /></button>)}</div>}
        <p>上传一张人物或动物照片，后续镜头可复用外貌设定。</p><label>人物名称<input aria-label="人物名称" value={characterName} onChange={event => setCharacterName(event.target.value)} placeholder="例如：小狗" /></label><label>文字设定<textarea aria-label="人物设定" value={characterDescription} onChange={event => setCharacterDescription(event.target.value)} placeholder="例如：棕色柴犬，戴白色厨师帽" /></label>
      </>}
      {(modal === "character" || modal === "image") && <><label>参考照片<select aria-label="人物参考照片" value={photoId} onChange={event => setPhotoId(event.target.value)}><option value="">请选择照片</option>{imageAssets.map(asset => <option key={asset.id} value={asset.id}>{shortName(asset)}</option>)}</select></label><button type="button" className="film-modal-secondary" onClick={() => void importForModal()}><StudioIcon name="upload" size={16} />上传本地照片</button><button type="button" className="film-modal-primary" disabled={!photoId || modal === "character" && !characterName.trim()} onClick={() => { if (modal === "character") onCreateCharacter(characterName, characterDescription, photoId); else onAddNode("image", photoId); setModal(null); setCharacterName(""); setCharacterDescription(""); }}>确认添加</button></>}
      {modal === "clip" && <>{episode.nodes.filter(node => node.type === "video").map(node => { const result = videoResult(node); return result.resultAssetId ? <button type="button" className="film-episode-option" key={node.id} onClick={() => { onAddVideoToTimeline(node.id, result.resultAssetId!); setModal(null); }}><StudioIcon name="video" size={17} />{node.title}<StudioIcon name="plus" size={15} /></button> : null; })}{!episode.nodes.some(node => node.type === "video" && videoResult(node).resultAssetId) && <p>还没有已生成的视频节点。先生成视频，再加入这一集。</p>}</>}
      {modal === "share" && <><p>{shareMessage ?? "项目保存在本地文件夹。可以复制路径，与协作者传递整个项目文件夹。"}</p><code>{projectRoot ?? window.location.href}</code><button type="button" className="film-modal-primary" onClick={() => { void navigator.clipboard.writeText(projectRoot ?? window.location.href); setModal(null); }}>复制{projectRoot ? "项目路径" : "页面地址"}</button><button type="button" className="film-modal-secondary" onClick={onOpenProjects}>打开项目管理</button></>}
    </div></div>}
    {playingUrl && <div className="film-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPlayingUrl(null); }}><div className="film-video-player" role="dialog" aria-modal="true" aria-label="播放视频"><button type="button" onClick={() => setPlayingUrl(null)} aria-label="关闭"><StudioIcon name="x" /></button><video src={playingUrl} autoPlay controls /></div></div>}
  </div>;
}
