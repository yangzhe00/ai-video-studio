import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { feedbackMessages, StudioShell, useFeedbackDialog } from "@ai-video/components";
import { CanvasPage } from "@ai-video/plugin-canvas/canvas";
import { ensureStudio } from "@ai-video/project-core";
import type { ProjectManifestV2, StudioEpisode } from "@ai-video/project-core";
import "@ai-video/design-tokens/tokens.css";
import "@ai-video/ui-web/styles.css";
import "@ai-video/ui-web/studio.css";
import "@ai-video/components/styles.css";
import "./styles.css";

const base: ProjectManifestV2 = {
  version: 2, id: "feedback-preview", title: "弹框视觉回归 · 模拟项目", assets: [], clips: [], captions: [],
  publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null,
};
const manifest = ensureStudio(base);
const initialEpisode: StudioEpisode = { ...manifest.studio!.episodes[0], nodes: [
  { id: "description", type: "text", title: "镜头描述", x: 180, y: 170, prompt: "小狗在厨房准备晚餐" },
  { id: "shot", type: "video", title: "视频镜头", x: 540, y: 150, durationSec: 5 },
  { id: "timeline", type: "timeline", title: "整集时间线", x: 800, y: 520 },
], edges: [{ id: "connection", from: "description", to: "shot" }] };

function Preview() {
  const [episode, setEpisode] = useState(initialEpisode);
  const [skin, setSkin] = useState<"cream-film" | "cyan-night">("cream-film");
  const feedback = useFeedbackDialog();
  useEffect(() => { document.documentElement.dataset.skin = skin; }, [skin]);
  return <div className="film-app web-studio" style={{ height: "100dvh" }}>
    <div style={{ padding: "8px 16px", background: "var(--avs-warning-bg)", color: "var(--avs-warning)", fontSize: 12, zIndex: 1 }}>
      开发预览 · 模拟画布和项目 · 弹框使用真实共享组件
    </div>
    <StudioShell active="canvas" onNavigate={() => {}}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 10, background: "var(--avs-toolbar)", color: "var(--avs-text)" }}>
        <button type="button" onClick={() => setSkin(current => current === "cream-film" ? "cyan-night" : "cream-film")}>切换{skin === "cream-film" ? "深色" : "浅色"}</button>
        <button type="button" onClick={() => void feedback.input(feedbackMessages.info.newEpisode, "第 2 集")}>新建分集提示</button>
        <button type="button" onClick={() => void feedback.show(feedbackMessages.failure.copyShareAddress)}>显示失败提示</button>
      </div>
      <CanvasPage manifest={manifest} episode={episode} previewUrls={{}} busy={false} saveState="saved"
        onOpenGenerate={() => {}} onOpenEditor={() => {}} onOpenProjects={() => {}}
        onSelectEpisode={() => {}} onCreateEpisode={() => {}} onImportPhoto={async () => null}
        onCreateCharacter={() => {}} onAddCharacterNode={() => {}} onAddNode={() => {}}
        onAddDownstreamVideo={() => {}} onUpdateNode={() => {}} onMoveNode={() => {}}
        onRemoveNode={id => setEpisode(current => ({ ...current,
          nodes: current.nodes.filter(node => node.id !== id),
          edges: current.edges.filter(edge => edge.from !== id && edge.to !== id),
        }))}
        onConnect={() => {}} onDisconnect={() => {}} onRunVideo={() => {}} onRefreshJob={() => {}}
        onAddVideoToTimeline={() => {}} onReorderClip={() => {}} />
    </StudioShell>
    {feedback.dialog}
  </div>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
