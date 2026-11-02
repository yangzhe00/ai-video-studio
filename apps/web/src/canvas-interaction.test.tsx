import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CanvasPage } from "@ai-video/plugin-canvas/canvas";
import { ensureStudio } from "@ai-video/project-core";
import type { ProjectManifestV2, StudioNode } from "@ai-video/project-core";

afterEach(() => { cleanup(); Reflect.deleteProperty(document, "elementFromPoint"); });

function setup(completed = false) {
  const initial: ProjectManifestV2 = {
    version: 2, id: "project-1", title: "连线测试", assets: [{ id: "photo", kind: "image", relativePath: "photo.jpg",
      durationMs: null, width: 100, height: 100, missing: false }, ...(completed ? [{ id: "output", kind: "video" as const,
      relativePath: "output.mp4", durationMs: 5000, width: 100, height: 100, missing: false }] : [])], clips: [], captions: [],
    publishingCopy: "", coverTimeMs: null, shots: completed ? [{ id: "shot", sourceAssetId: "photo", prompt: "做饭",
      durationSec: 5, speaking: false, script: null, acceptedAudioAssetId: null, modelId: "test" }] : [],
    jobs: completed ? [{ id: "job", shotId: "shot", provider: "kling", modelId: "test", state: "succeeded",
      remoteId: null, estimatedUsd: 0, actualUsd: 0, outputAssetId: "output" }] : [], budgetUsd: null,
  };
  const manifest = ensureStudio(initial);
  const episode = manifest.studio!.episodes[0];
  const nodes: StudioNode[] = [
    { id: "image", type: "image", title: "参考照片", x: 20, y: 80, assetId: "photo" },
    { id: "text", type: "text", title: "镜头描述", x: 310, y: 60, prompt: "做饭" },
    { id: "video", type: "video", title: "视频镜头", x: 650, y: 80, durationSec: 5,
      ...(completed ? { shotId: "shot", resultAssetId: "output" } : {}) },
    { id: "timeline", type: "timeline", title: "整集时间线", x: 780, y: 500 },
  ];
  episode.nodes = nodes;
  const onConnect = vi.fn();
  const onRemoveNode = vi.fn();
  render(<CanvasPage manifest={manifest} episode={episode} previewUrls={completed ? { photo: "/api/objects/photo", output: "/api/objects/output" } : {}} busy={false} saveState="saved"
    onOpenGenerate={() => {}} onOpenEditor={() => {}} onOpenProjects={() => {}}
    onSelectEpisode={() => {}} onCreateEpisode={() => {}} onImportPhoto={async () => null}
    onCreateCharacter={() => {}} onAddCharacterNode={() => {}} onAddNode={() => {}}
    onAddDownstreamVideo={() => {}} onUpdateNode={() => {}} onMoveNode={() => {}}
    onRemoveNode={onRemoveNode} onConnect={onConnect} onDisconnect={() => {}}
    onRunVideo={() => {}} onRefreshJob={() => {}} onAddVideoToTimeline={() => {}}
    onReorderClip={() => {}} />);
  return { onConnect, onRemoveNode, nodes };
}

describe("canvas connection and editing", () => {
  it("does not download a completed video until the user opens its player", () => {
    setup(true);
    expect(document.querySelector("video")).toBeNull();
    expect(document.querySelector('.film-node-video-preview img')?.getAttribute("src")).toBe("/api/objects/photo");
    fireEvent.click(screen.getByRole("button", { name: "播放视频" }));
    expect(document.querySelector('video[src="/api/objects/output"]')).not.toBeNull();
  });

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

  it("cancels node deletion without changing the graph, then confirms through the themed warning", async () => {
    const { onRemoveNode } = setup();
    fireEvent.click(screen.getByText("图片 / 参考照片"));
    fireEvent.click(screen.getByRole("button", { name: "删除节点" }));
    expect(screen.getByRole("alertdialog", { name: "删除这个节点？" }).textContent).toContain("断开相关连接");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onRemoveNode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "删除节点" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "删除这个节点？" })).getByRole("button", { name: "删除节点" }));
    await waitFor(() => expect(onRemoveNode).toHaveBeenCalledExactlyOnceWith("image"));
  });
});
