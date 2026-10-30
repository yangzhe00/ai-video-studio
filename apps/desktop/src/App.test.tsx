import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as cloud from "./lib/cloud";
import * as sync from "./lib/sync";
import { createEpisode, ensureStudio, selectEpisode } from "@ai-video/project-core";

const mocks = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn(), create: vi.fn(), chooseParent: vi.fn(), chooseExisting: vi.fn(), audit: vi.fn(), read: vi.fn() }));
vi.mock("./lib/ports", () => ({ desktopPorts: { projects: { open: mocks.open, save: mocks.save, create: mocks.create, chooseParent: mocks.chooseParent, chooseExisting: mocks.chooseExisting }, media: { audit: mocks.audit, read: mocks.read } } }));

const manifest = { version: 2 as const, id: "p", title: "上次项目", assets: [], clips: [], captions: [], publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null };

describe("C4 studio entry", () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); mocks.audit.mockResolvedValue([]); mocks.read.mockResolvedValue(new Uint8Array()); mocks.save.mockResolvedValue(undefined); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shows one input and two actions before opening the project library", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "你想拍什么？" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "用我的内容开始" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "全部项目" }));
    expect(within(screen.getByRole("dialog", { name: "选择项目" })).getByRole("button", { name: /新建项目/ })).toBeTruthy();
    expect(within(screen.getByRole("dialog", { name: "选择项目" })).getByRole("button", { name: "打开已有项目" })).toBeTruthy();
    expect(screen.getByText("AI Video Studio")).toBeTruthy();
  });

  it("keeps every no-project navigation page clickable without losing the unfinished setup", () => {
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗准备晚餐" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    const nav = within(screen.getByRole("complementary", { name: "主导航" }));
    for (const [label, heading] of [["创作", "创作需要先打开项目"], ["画布", "画布需要先打开项目"],
      ["结果", "结果需要先打开项目"], ["资产", "资产需要先打开项目"]]) {
      fireEvent.click(nav.getByRole("button", { name: label }));
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
      expect(nav.getByRole("button", { name: label }).getAttribute("aria-current")).toBe("page");
      expect(screen.queryByRole("dialog", { name: "选择项目" })).toBeNull();
    }
    fireEvent.click(nav.getByRole("button", { name: "首页" }));
    expect(screen.getByRole("heading", { name: "开始这个作品" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "最终创作内容" }) as HTMLTextAreaElement).value).toBe("小狗准备晚餐");
    expect(screen.getByRole("button", { name: "进入画布编排" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("saves an offline full script as non-executable source before entering canvas", async () => {
    mocks.chooseParent.mockResolvedValue("/tmp");
    mocks.create.mockImplementation(async (_root, title, brief) => ({ ...manifest, title, extensions: { creationBriefs: [brief] } }));
    render(<App />);
    const script = "小狗做饭。".repeat(450);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: script } });
    expect(screen.getByRole("button", { name: "让 Agent 给我 3 个方向" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    fireEvent.click(screen.getByRole("button", { name: "创建项目并继续" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    const saved = mocks.save.mock.calls[0][1];
    expect(saved.extensions.creationBriefs[0]).toMatchObject({ source: "manual", originalText: script, finalText: script });
    expect(mocks.create.mock.calls[0][2]).toMatchObject({ source: "manual", originalText: script, finalText: script });
    expect(localStorage.getItem("ai-video-studio:pending-local-create")).toBeNull();
    expect(saved.studio.episodes[0].nodes.some((node: { type: string }) => node.type === "text" || node.type === "video")).toBe(false);
    await screen.findByRole("toolbar", { name: "添加节点" });
    expect(screen.getByRole("button", { name: /创作原文/ })).toBeTruthy();
  });

  it("recovers an atomically created local brief when its follow-up save fails", async () => {
    mocks.chooseParent.mockResolvedValue("/tmp");
    let created: typeof manifest & { extensions?: { creationBriefs: unknown[] } } = manifest;
    mocks.create.mockImplementation(async (_root, title, brief) => {
      created = { ...manifest, title, extensions: { creationBriefs: [brief] } };
      return created;
    });
    mocks.open.mockImplementation(async () => created);
    mocks.save.mockRejectedValueOnce(new Error("write lost")).mockResolvedValue(undefined);
    const first = render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    fireEvent.click(screen.getByRole("button", { name: "创建项目并继续" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("write lost"));
    expect(localStorage.getItem("ai-video-studio:pending-local-create")).toContain("小狗端菜");
    expect(localStorage.getItem("ai-video-studio:last-project-root")).toBeNull();
    first.unmount();
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    fireEvent.click(screen.getByRole("button", { name: "查询原项目" }));
    await screen.findByRole("toolbar", { name: "添加节点" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(created.extensions?.creationBriefs).toHaveLength(1);
    expect(mocks.save.mock.calls[0][1].extensions.creationBriefs[0].id)
      .toBe(mocks.save.mock.calls[1][1].extensions.creationBriefs[0].id);
    expect(localStorage.getItem("ai-video-studio:pending-local-create")).toBeNull();
    expect(localStorage.getItem("ai-video-studio:last-project-root")).toMatch(/小狗端菜/);
  });

  it("recovers the on-disk brief when native creation succeeds but its IPC response is lost", async () => {
    let diskBrief: unknown;
    let disk: unknown;
    mocks.chooseParent.mockResolvedValue("/tmp");
    mocks.create.mockImplementation(async (_root, title, brief) => {
      diskBrief = brief;
      disk = { ...manifest, title, extensions: { creationBriefs: [brief] } };
      expect(localStorage.getItem("ai-video-studio:pending-local-create")).toContain(brief.id);
      throw new Error("IPC response lost");
    });
    mocks.open.mockImplementation(async () => disk);
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    fireEvent.click(screen.getByRole("button", { name: "创建项目并继续" }));
    await screen.findByRole("toolbar", { name: "添加节点" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledWith("/tmp/小狗端菜");
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][1].extensions.creationBriefs).toEqual([diskBrief]);
    expect(localStorage.getItem("ai-video-studio:pending-local-create")).toBeNull();
    expect(localStorage.getItem("ai-video-studio:last-project-root")).toBe("/tmp/小狗端菜");
  });

  it("restores a pending creation across restart with the original brief ID", async () => {
    let diskBrief: unknown;
    let disk: unknown;
    mocks.chooseParent.mockResolvedValue("/tmp");
    mocks.create.mockImplementation(async (_root, title, brief) => {
      diskBrief = brief;
      disk = { ...manifest, title, extensions: { creationBriefs: [brief] } };
      throw new Error("IPC response lost");
    });
    mocks.open.mockRejectedValueOnce(new Error("read temporarily unavailable")).mockImplementation(async () => disk);
    const first = render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    fireEvent.click(screen.getByRole("button", { name: "创建项目并继续" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("IPC response lost"));
    const pending = JSON.parse(localStorage.getItem("ai-video-studio:pending-local-create")!) as { brief: { id: string } };
    expect(pending.brief.id).toBe((diskBrief as { id: string }).id);
    first.unmount();
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    expect((screen.getByRole("textbox", { name: "项目名称" }) as HTMLInputElement).value).toBe("小狗端菜");
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    fireEvent.click(screen.getByRole("button", { name: "查询原项目" }));
    await screen.findByRole("toolbar", { name: "添加节点" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][1].extensions.creationBriefs).toEqual([diskBrief]);
    expect(localStorage.getItem("ai-video-studio:pending-local-create")).toBeNull();
  });

  it("does not adopt or overwrite a same-name folder with different source text", async () => {
    const disk = { ...manifest, title: "小狗端菜", extensions: { creationBriefs: [{ id: "other-brief", source: "manual",
      originalText: "另一部影片", finalText: "另一部影片", createdAt: 1, updatedAt: 1 }] } };
    mocks.chooseParent.mockResolvedValue("/tmp");
    mocks.create.mockRejectedValue(new Error("already exists"));
    mocks.open.mockResolvedValue(disk);
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    fireEvent.click(screen.getByRole("button", { name: "创建项目并继续" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already exists"));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(localStorage.getItem("ai-video-studio:last-project-root")).toBeNull();
    expect(screen.getByRole("heading", { name: "开始这个作品" })).toBeTruthy();
  });

  it("does not claim an old same-name and same-text project with a different brief ID", async () => {
    const disk = { ...manifest, title: "小狗端菜", extensions: { creationBriefs: [{ id: "other-brief", source: "manual",
      originalText: "小狗端菜", finalText: "小狗端菜", createdAt: 1, updatedAt: 1 }] } };
    mocks.chooseParent.mockResolvedValue("/tmp");
    mocks.create.mockRejectedValue(new Error("already exists"));
    mocks.open.mockResolvedValue(disk);
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    fireEvent.click(screen.getByRole("button", { name: "创建项目并继续" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already exists"));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(localStorage.getItem("ai-video-studio:last-project-root")).toBeNull();
    expect(screen.getByRole("heading", { name: "开始这个作品" })).toBeTruthy();
  });

  it("does not recover a matching disk brief if the pending intent disappeared", async () => {
    let disk: unknown;
    mocks.chooseParent.mockResolvedValue("/tmp");
    mocks.create.mockImplementation(async (_root, title, brief) => {
      disk = { ...manifest, title, extensions: { creationBriefs: [brief] } };
      localStorage.removeItem("ai-video-studio:pending-local-create");
      throw new Error("already exists");
    });
    mocks.open.mockImplementation(async () => disk);
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    fireEvent.click(screen.getByRole("button", { name: "创建项目并继续" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already exists"));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(localStorage.getItem("ai-video-studio:last-project-root")).toBeNull();
  });

  it("requires an explicit new attempt before replacing a different pending creation", async () => {
    const pendingBrief = { id: "pending-brief", source: "manual", originalText: "上一部剧本",
      finalText: "上一部剧本", createdAt: 1, updatedAt: 1 };
    localStorage.setItem("ai-video-studio:pending-local-create", JSON.stringify({ version: 1,
      root: "/tmp/上一部剧本", title: "上一部剧本", brief: pendingBrief }));
    mocks.chooseParent.mockResolvedValue("/tmp");
    mocks.create.mockImplementation(async (_root, title, brief) => ({ ...manifest, title, extensions: { creationBriefs: [brief] } }));
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "新的剧本" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    fireEvent.click(screen.getByRole("button", { name: "查询原项目" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("上次本机创建结果待确认"));
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "另起新项目" }));
    fireEvent.click(screen.getByRole("button", { name: "创建项目并继续" }));
    await screen.findByRole("toolbar", { name: "添加节点" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][2].id).not.toBe(pendingBrief.id);
  });

  it.each(["direct", "canvas"] as const)("opens the chosen second episode for an existing project in %s mode", async mode => {
    const twoEpisodes = createEpisode(ensureStudio(manifest), "第 2 集");
    const firstId = twoEpisodes.studio!.episodes[0].id;
    const secondId = twoEpisodes.studio!.episodes[1].id;
    const firstActive = selectEpisode(twoEpisodes, firstId);
    mocks.chooseExisting.mockResolvedValue("/tmp/two-episodes");
    mocks.open.mockResolvedValue(firstActive);
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗端上晚餐" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.click(screen.getByRole("button", { name: "加入已有项目" }));
    fireEvent.click(screen.getByRole("button", { name: "选择其他本机项目" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "选择本机项目" })).getByRole("button", { name: "打开已有项目" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "选择本机项目" })).toBeNull());
    fireEvent.change(screen.getByRole("combobox", { name: "目标分集" }), { target: { value: secondId } });
    fireEvent.click(screen.getByRole("button", { name: mode === "direct" ? "直接生成一个镜头" : "进入画布编排" }));
    if (mode === "direct") fireEvent.click(screen.getByRole("checkbox", { name: "我确认这是一段单镜头描述" }));
    fireEvent.click(screen.getByRole("button", { name: "加入项目并继续" }));
    await waitFor(() => expect(mocks.save.mock.calls.some(([, saved]) => saved.studio?.activeEpisodeId === secondId)).toBe(true));
    if (mode === "direct") {
      expect((await screen.findByRole("textbox", { name: "场景和动作提示词" }) as HTMLTextAreaElement).value).toBe("小狗端上晚餐");
      expect(screen.getAllByText(/第 2 集/).length).toBeGreaterThan(0);
    } else {
      await screen.findByRole("toolbar", { name: "添加节点" });
      expect(document.querySelector(".film-canvas-chapter")?.textContent).toContain("第 2 集");
    }
  });

  it("carries a selected cloud idea into an explicitly opened local project without generating", async () => {
    const account = { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 };
    const variants = [
      { id: "variant-a", title: "温暖", description: "暖光", prompt: "小狗在厨房端菜" },
      { id: "variant-b", title: "轻快", description: "快节奏", prompt: "小狗开心端菜" },
      { id: "variant-c", title: "电影", description: "暗光", prompt: "小狗在光影中端菜" },
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
        idea = { id: "idea-0001", clientRequestId: request.clientRequestId, input: request.input, state: "ready", variants };
        return { ideaSet: idea } as never;
      }
      if (path === "/prompt-ideas/idea-0001/selection" && method === "POST") {
        const selection = body as { variantId: string; editedPrompt: string };
        idea = { ...idea, selectedVariantId: selection.variantId, editedPrompt: selection.editedPrompt };
        return { ideaSet: idea } as never;
      }
      throw new Error("offline sync fixture");
    });
    mocks.chooseExisting.mockResolvedValue("/tmp/story");
    mocks.open.mockResolvedValue(manifest);
    render(<App />);
    fireEvent.change(await screen.findByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗做饭" } });
    fireEvent.click(screen.getByRole("button", { name: "让 Agent 给我 3 个方向" }));
    fireEvent.click(await screen.findByRole("button", { name: /方向 2/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "最终镜头提示词" }), { target: { value: "小狗开心地端上晚餐" } });
    fireEvent.click(screen.getByRole("button", { name: "用这条灵感开始" }));
    await screen.findByRole("heading", { name: "开始这个作品" });
    fireEvent.click(screen.getByRole("button", { name: "加入已有项目" }));
    fireEvent.click(screen.getByRole("button", { name: "选择其他本机项目" }));
    const dialog = await screen.findByRole("dialog", { name: "选择本机项目" });
    fireEvent.click(within(dialog).getByRole("button", { name: "打开已有项目" }));
    fireEvent.click(screen.getByRole("button", { name: "直接生成一个镜头" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "加入项目并继续" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "加入项目并继续" }));
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
    fireEvent.click(screen.getByRole("button", { name: "全部项目" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "选择项目" })).getByRole("button", { name: "打开已有项目" }));
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
    fireEvent.click(screen.getByRole("button", { name: "全部项目" }));
    expect(within(screen.getByRole("dialog", { name: "选择项目" })).getByRole("button", { name: "打开已有项目" })).toBeTruthy();
    expect(localStorage.getItem("ai-video-studio:last-project-root")).toBeNull();
  });
});
