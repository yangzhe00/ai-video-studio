import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CanvasPage } from "@ai-video/plugin-canvas/canvas";
import { ensureStudio } from "@ai-video/project-core";
import type { ProjectManifestV2, StudioNode } from "@ai-video/project-core";

afterEach(() => { cleanup(); Reflect.deleteProperty(document, "elementFromPoint"); });

function setup() {
  const initial: ProjectManifestV2 = {
    version: 2, id: "project-1", title: "连线测试", assets: [{ id: "photo", kind: "image", relativePath: "photo.jpg",
      durationMs: null, width: 100, height: 100, missing: false }], clips: [], captions: [],
    publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null,
  };
  const manifest = ensureStudio(initial);
  const episode = manifest.studio!.episodes[0];
  const nodes: StudioNode[] = [
    { id: "image", type: "image", title: "参考照片", x: 20, y: 80, assetId: "photo" },
    { id: "text", type: "text", title: "镜头描述", x: 310, y: 60, prompt: "做饭" },
    { id: "video", type: "video", title: "视频镜头", x: 650, y: 80, durationSec: 5 },
    { id: "timeline", type: "timeline", title: "整集时间线", x: 780, y: 500 },
  ];
  episode.nodes = nodes;
  const onConnect = vi.fn();
  render(<CanvasPage manifest={manifest} episode={episode} previewUrls={{}} busy={false} saveState="saved"
    onOpenGenerate={() => {}} onOpenEditor={() => {}} onOpenProjects={() => {}}
    onSelectEpisode={() => {}} onCreateEpisode={() => {}} onImportPhoto={async () => null}
    onCreateCharacter={() => {}} onAddCharacterNode={() => {}} onAddNode={() => {}}
    onAddDownstreamVideo={() => {}} onUpdateNode={() => {}} onMoveNode={() => {}}
    onRemoveNode={() => {}} onConnect={onConnect} onDisconnect={() => {}}
    onRunVideo={() => {}} onRefreshJob={() => {}} onAddVideoToTimeline={() => {}}
    onReorderClip={() => {}} />);
  return { onConnect, nodes };
}

describe("canvas connection and editing", () => {
  it("connects image and text to video, then video to timeline by clicking ports", () => {
    const { onConnect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "从参考照片开始连线" }));
    fireEvent.click(screen.getByRole("button", { name: "连接到视频镜头" }));
    fireEvent.click(screen.getByRole("button", { name: "从镜头描述开始连线" }));
    fireEvent.click(screen.getByRole("button", { name: "连接到视频镜头" }));
    fireEvent.click(screen.getByRole("button", { name: "从视频镜头开始连线" }));
    fireEvent.click(screen.getByRole("button", { name: "连接到整集时间线" }));
    expect(onConnect.mock.calls).toEqual([["image", "video"], ["text", "video"], ["video", "timeline"]]);
  });

  it("drops a dragged wire on the target node", () => {
    const { onConnect } = setup();
    const output = screen.getByRole("button", { name: "从参考照片开始连线" });
    const target = screen.getByText("视频 / 视频镜头").closest("article")!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    fireEvent.pointerDown(output, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(output, { pointerId: 1, clientX: 400, clientY: 200 });
    fireEvent.pointerUp(output, { pointerId: 1, clientX: 400, clientY: 200 });
    expect(onConnect).toHaveBeenCalledWith("image", "video");
  });

  it("places the editor beside each selected node instead of pinning it to the corner", () => {
    setup();
    const workspace = screen.getByRole("region", { name: "分集画布" });
    Object.defineProperty(workspace, "clientWidth", { configurable: true, value: 1300 });
    Object.defineProperty(workspace, "clientHeight", { configurable: true, value: 700 });
    fireEvent.click(screen.getByText("图片 / 参考照片"));
    const imageLeft = Number.parseFloat((screen.getByRole("complementary", { name: "节点设置" }) as HTMLElement).style.left);
    fireEvent.click(screen.getByText("视频 / 视频镜头"));
    const videoLeft = Number.parseFloat((screen.getByRole("complementary", { name: "节点设置" }) as HTMLElement).style.left);
    expect(imageLeft).toBeGreaterThan(0);
    expect(videoLeft).not.toBe(imageLeft);
  });
});
