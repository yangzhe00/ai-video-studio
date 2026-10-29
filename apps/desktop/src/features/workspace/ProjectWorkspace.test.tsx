import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspace } from "./ProjectWorkspace";

const mocks = vi.hoisted(() => ({ choose: vi.fn(), audit: vi.fn(), import: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock("../../lib/ports", () => ({ desktopPorts: { media: { chooseFiles: mocks.choose, audit: mocks.audit, import: mocks.import, read: mocks.read }, projects: { save: mocks.save } } }));

const manifest = { version: 2 as const, id: "p", title: "故事", assets: [], clips: [], captions: [], publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null };

describe("ProjectWorkspace", () => {
  beforeEach(() => {
    mocks.read.mockResolvedValue(new ArrayBuffer(0));
    mocks.save.mockResolvedValue(undefined);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it("imports a selected file into the project and saves the manifest", async () => {
    mocks.audit.mockResolvedValue([]);
    mocks.choose.mockResolvedValue(["/tmp/original.png"]);
    const asset = { id: "a", kind: "image", relativePath: "media/source/a.png", durationMs: null, width: 320, height: 240, missing: false };
    mocks.import.mockResolvedValue(asset);
    render(<ProjectWorkspace project={{ root: "/tmp/story", manifest }} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 导入" }));
    await waitFor(() => expect(mocks.import).toHaveBeenCalledWith("/tmp/story", "/tmp/original.png"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("/tmp/story", expect.objectContaining({ assets: [asset] })));
    expect(screen.getByRole("button", { name: "将 a.png 加入时间线" })).toBeTruthy();
  });

  it("keeps service setup, model names and cost estimates out of the AI workspace", async () => {
    mocks.audit.mockResolvedValue([]);
    render(<ProjectWorkspace project={{ root: "/tmp/story", manifest }} />);
    fireEvent.click(screen.getByRole("tab", { name: "AI 创作" }));
    expect(screen.getByText("照片生成视频 · 分镜草稿")).toBeTruthy();
    expect(screen.queryByText("模型服务设置")).toBeNull();
    expect(screen.queryByText("生成费用预估")).toBeNull();
    expect(screen.queryByLabelText("选择模型服务")).toBeNull();
  });

  it("uses the reordered clips in both storyboard and timeline", async () => {
    const assets = [
      { id: "a", kind: "image" as const, relativePath: "media/source/a.png", durationMs: null, width: 320, height: 240, missing: false },
      { id: "b", kind: "image" as const, relativePath: "media/source/b.png", durationMs: null, width: 320, height: 240, missing: false },
    ];
    const clips = [
      { id: "first", assetId: "a", inMs: 0, outMs: 5000, volume: 1 },
      { id: "second", assetId: "b", inMs: 0, outMs: 5000, volume: 1 },
    ];
    mocks.audit.mockResolvedValue(assets);
    const { container } = render(<ProjectWorkspace project={{ root: "/tmp/story", manifest: { ...manifest, assets, clips } }} />);
    const cards = container.querySelectorAll(".editor-storyboard li");
    fireEvent.dragStart(cards[0]);
    fireEvent.dragOver(cards[1]);
    fireEvent.drop(cards[1]);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("/tmp/story", expect.objectContaining({ clips: [clips[1], clips[0]] })));
    fireEvent.click(screen.getByRole("tab", { name: "时间线" }));
    const timeline = container.querySelectorAll(".editor-timeline-clip strong");
    expect(Array.from(timeline, item => item.textContent)).toEqual(["b.png", "a.png"]);
    fireEvent.change(screen.getByRole("slider", { name: "播放头位置" }), { target: { value: "6000" } });
    expect(container.querySelector(".editor-preview-heading span")?.textContent).toBe("a.png");
  });
});
