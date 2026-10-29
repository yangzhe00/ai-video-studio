import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as cloud from "./lib/cloud";
import * as sync from "./lib/sync";

const mocks = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn(), chooseExisting: vi.fn(), audit: vi.fn(), read: vi.fn() }));
vi.mock("./lib/ports", () => ({ desktopPorts: { projects: { open: mocks.open, save: mocks.save, chooseExisting: mocks.chooseExisting }, media: { audit: mocks.audit, read: mocks.read } } }));

const manifest = { version: 2 as const, id: "p", title: "上次项目", assets: [], clips: [], captions: [], publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null };

describe("C4 studio entry", () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); mocks.audit.mockResolvedValue([]); mocks.read.mockResolvedValue(new Uint8Array()); mocks.save.mockResolvedValue(undefined); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shows new and open actions in the C4 creation shell on first launch", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /新建项目/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开已有项目" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /把今天的灵感/ })).toBeTruthy();
    expect(screen.getByText("AI Video Studio")).toBeTruthy();
  });

  it("carries a selected cloud idea into an explicitly opened local project without generating", async () => {
    const account = { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 };
    const variants = [
      { id: "a", title: "温暖", description: "暖光", prompt: "小狗在厨房端菜" },
      { id: "b", title: "轻快", description: "快节奏", prompt: "小狗开心端菜" },
      { id: "c", title: "电影", description: "暗光", prompt: "小狗在光影中端菜" },
    ];
    let idea: Record<string, unknown> | null = null;
    const calls: string[] = [];
    vi.spyOn(sync, "syncProject").mockImplementation(async (_root, currentManifest) => ({ manifest: currentManifest, project: {}, direction: "current" } as never));
    vi.spyOn(cloud, "cloudRequest").mockImplementation(async (path, method = "GET", body) => {
      calls.push(`${method} ${path}`);
      if (path === "/auth/me") return { account } as never;
      if (path === "/prompt-ideas" && method === "GET") return { ideaSets: [] } as never;
      if (path === "/prompt-ideas" && method === "POST") {
        const request = body as { clientRequestId: string; input: string };
        idea = { id: "idea-1", clientRequestId: request.clientRequestId, input: request.input, state: "ready", variants };
        return { ideaSet: idea } as never;
      }
      if (path === "/prompt-ideas/idea-1/selection" && method === "POST") {
        const selection = body as { variantId: string; editedPrompt: string };
        idea = { ...idea, selectedVariantId: selection.variantId, editedPrompt: selection.editedPrompt };
        return { ideaSet: idea } as never;
      }
      throw new Error("offline sync fixture");
    });
    mocks.chooseExisting.mockResolvedValue("/tmp/story");
    mocks.open.mockResolvedValue(manifest);
    render(<App />);
    fireEvent.change(await screen.findByRole("textbox", { name: "你的想法" }), { target: { value: "小狗做饭" } });
    fireEvent.click(screen.getByRole("button", { name: "给我三种灵感" }));
    fireEvent.click(await screen.findByRole("button", { name: /方向 2/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "最终镜头提示词" }), { target: { value: "小狗开心地端上晚餐" } });
    fireEvent.click(screen.getByRole("button", { name: "保存这一版并继续" }));
    const dialog = await screen.findByRole("dialog", { name: "选择项目" });
    fireEvent.click(within(dialog).getByRole("button", { name: "打开已有项目" }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "场景和动作提示词" }) as HTMLTextAreaElement).value).toBe("小狗开心地端上晚餐"));
    expect(calls.filter(value => value.includes("/runs"))).toHaveLength(0);
  });

  it("restores the last project straight into Generate and opens Canvas", async () => {
    localStorage.setItem("ai-video-studio:last-project-root", "/tmp/last-project");
    mocks.open.mockResolvedValue(manifest);
    render(<App />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "生成" })).toBeTruthy());
    await waitFor(() => expect(mocks.save.mock.calls.some(([, value]) => value.studio?.episodes.length === 1)).toBe(true));
    expect(screen.getAllByText(/上次项目/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "仅保存在本机" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("region", { name: "项目入口" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "画布" }));
    expect(screen.getByRole("toolbar", { name: "添加节点" })).toBeTruthy();
    expect(screen.getByText("从第一个节点开始")).toBeTruthy();
  });

  it("remembers a project opened from the workspace", async () => {
    mocks.chooseExisting.mockResolvedValue("/tmp/story");
    mocks.open.mockResolvedValue(manifest);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "打开已有项目" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "生成" })).toBeTruthy());
    expect(localStorage.getItem("ai-video-studio:last-project-root")).toBe("/tmp/story");
  });

  it("adds a text node to the current episode and saves the project", async () => {
    localStorage.setItem("ai-video-studio:last-project-root", "/tmp/last-project");
    mocks.open.mockResolvedValue(manifest);
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "画布" }));
    fireEvent.click(screen.getByRole("button", { name: "文本" }));
    await waitFor(() => expect(mocks.save.mock.calls.some(([, value]) => value.studio?.episodes[0].nodes.some((node: { type: string }) => node.type === "text"))).toBe(true));
  });

  it("creates a new episode from a generated video and adds it to that timeline", async () => {
    const image = { id: "photo", kind: "image", relativePath: "media/source/photo.png", durationMs: null, width: 100, height: 100, missing: false };
    const video = { id: "video", kind: "video", relativePath: "media/generated/clip.mp4", durationMs: 5000, width: 100, height: 100, missing: false };
    const withResult = {
      ...manifest, assets: [image, video],
      shots: [{ id: "shot", sourceAssetId: "photo", prompt: "厨房里的小狗", durationSec: 5, speaking: false, script: null, acceptedAudioAssetId: null, modelId: "kling-v2-5-turbo" }],
      jobs: [{ id: "job", shotId: "shot", provider: "kling", modelId: "kling-v2-5-turbo", state: "succeeded", remoteId: "remote", estimatedUsd: 1, actualUsd: 1, outputAssetId: "video" }],
    };
    localStorage.setItem("ai-video-studio:last-project-root", "/tmp/last-project");
    mocks.open.mockResolvedValue(withResult);
    mocks.audit.mockResolvedValue([image, video]);
    vi.spyOn(window, "prompt").mockReturnValue("第 2 集");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "加入画布 →" }));
    fireEvent.click(screen.getByRole("button", { name: /新建分集/ }));
    await waitFor(() => expect(screen.getByRole("toolbar", { name: "添加节点" })).toBeTruthy());
    expect(document.querySelector(".film-canvas-chapter")?.textContent).toMatch(/第 2 集/);
    fireEvent.click(screen.getByRole("button", { name: "加入时间线" }));
    await waitFor(() => expect(mocks.save.mock.calls.some(([, value]) => value.studio?.episodes.length === 2 && value.clips.length === 1)).toBe(true));
  });

  it("reuses a reference-photo character in another episode", async () => {
    const image = { id: "photo", kind: "image", relativePath: "media/source/photo.png", durationMs: null, width: 100, height: 100, missing: false };
    localStorage.setItem("ai-video-studio:last-project-root", "/tmp/last-project");
    mocks.open.mockResolvedValue({ ...manifest, assets: [image] });
    mocks.audit.mockResolvedValue([image]);
    vi.spyOn(window, "prompt").mockReturnValue("第 2 集");
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "画布" }));
    fireEvent.click(screen.getByRole("button", { name: "主体" }));
    fireEvent.change(screen.getByRole("textbox", { name: "人物名称" }), { target: { value: "小狗" } });
    fireEvent.change(screen.getByRole("combobox", { name: "人物参考照片" }), { target: { value: "photo" } });
    fireEvent.click(screen.getByRole("button", { name: "确认添加" }));
    await waitFor(() => expect(mocks.save.mock.calls.some(([, value]) => value.studio?.characters.length === 1)).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "从小狗添加下游节点" }));
    fireEvent.click(screen.getByRole("button", { name: "新建视频节点" }));
    await waitFor(() => expect(mocks.save.mock.calls.some(([, value]) => value.studio?.episodes[0].edges.length === 1)).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "新建分集" }));
    await waitFor(() => expect(document.querySelector(".film-canvas-chapter")?.textContent).toMatch(/第 2 集/));
    fireEvent.click(screen.getByRole("button", { name: "主体" }));
    fireEvent.click(screen.getByRole("button", { name: "小狗" }));
    await waitFor(() => expect(mocks.save.mock.calls.some(([, value]) => value.studio?.episodes[1]?.nodes.some((node: { type: string }) => node.type === "character"))).toBe(true));
  });

  it("keeps the workspace usable when the last folder disappeared", async () => {
    localStorage.setItem("ai-video-studio:last-project-root", "/tmp/missing");
    mocks.open.mockRejectedValue(new Error("missing"));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/无法打开/));
    expect(screen.getByRole("button", { name: "打开已有项目" })).toBeTruthy();
    expect(localStorage.getItem("ai-video-studio:last-project-root")).toBeNull();
  });
});
