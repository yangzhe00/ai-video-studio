import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "@ai-video/ui-web";
import App, { webManifest } from "./App";
import type { AgentRunSnapshot, CloudProject } from "./api";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); });

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

const testAccount = (id: string) => ({ id, email: `${id}@example.com`, demo_quota: 3, demo_reserved: 0, demo_used: 0 });
const testIdea = (id: string, input: string) => ({ id, clientRequestId: `request-${id}`, input, state: "ready",
  variants: [], selectedVariantId: null, editedPrompt: null, createdAt: 1, updatedAt: 1, error: null, errorCode: null });

describe("web entry", () => {
  it("uses a phone episode summary instead of mounting the node canvas", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const project: CloudProject = { id: "project-phone", title: "手机短片", revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: "episode-phone", title: "第 1 集", shots: [], timeline: [] }],
        assets: [], characters: [] } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: testAccount("phone") });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects")) return Response.json({ projects: [{ id: project.id, title: project.title, revision: 1 }] });
      if (url.endsWith("/projects/project-phone")) return Response.json({ project });
      if (url.endsWith("/projects/project-phone/runs")) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    expect(await screen.findByRole("navigation", { name: "手机主导航" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "全部项目" }));
    fireEvent.click(await screen.findByRole("button", { name: /手机短片.*云端项目/ }));
    await screen.findByRole("heading", { name: "今天想要创作什么？" });
    fireEvent.click(within(screen.getByRole("navigation", { name: "手机主导航" })).getByRole("button", { name: "画布" }));
    expect(screen.getByRole("main", { name: "手机分集概览" })).toBeTruthy();
    expect(document.querySelector(".film-canvas-view")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "继续生成镜头" }));
    expect(screen.getByRole("heading", { name: "今天想要创作什么？" })).toBeTruthy();
  });

  it("shows a real authentication error without exposing a project", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json({ error: String(url).includes("login") ? "邮箱或密码错误" : "请先登录" }, { status: 401 })));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "邮箱" }), { target: { value: "demo@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并开始创作" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("邮箱或密码错误"));
    expect(screen.queryByText("我的项目")).toBeNull();
  });

  it("shows a distinct empty state for every project section and preserves the Home idea draft", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/projects")) return Response.json({ projects: [] });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗第一次做晚餐" } });
    expect(document.querySelector(".web-studio .avs-titlebar")).toBeNull();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
    expect(screen.queryByText(/Agent 在线/)).toBeNull();
    expect(screen.getByRole("heading", { name: "你想拍什么？" })).toBeTruthy();
    const nav = within(screen.getAllByRole("complementary", { name: "主导航" })[0]);
    for (const [label, heading] of [["创作", "创作需要先打开项目"], ["画布", "画布需要先打开项目"],
      ["结果", "结果需要先打开项目"], ["资产", "资产需要先打开项目"]]) {
      fireEvent.click(nav.getByRole("button", { name: label }));
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
      expect(nav.getByRole("button", { name: label }).getAttribute("aria-current")).toBe("page");
      expect(nav.getByRole("button", { name: "首页" }).getAttribute("aria-current")).toBeNull();
    }
    fireEvent.click(nav.getByRole("button", { name: "首页" }));
    expect((screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }) as HTMLTextAreaElement).value).toBe("小狗第一次做晚餐");
    expect(nav.getByRole("button", { name: "首页" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "全部项目" }));
    await screen.findByRole("heading", { name: "我的项目" });
    expect(nav.getByRole("button", { name: "首页" }).getAttribute("aria-current")).toBeNull();
  });

  it("creates a project through the library modal once and opens its workspace", async () => {
    const project: CloudProject = { id: "project-new", title: "新的短片", revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: "episode-new", title: "第 1 集", shots: [], timeline: [] }],
        assets: [], characters: [] } };
    let created = false;
    let postCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects") && init?.method === "POST") { postCount += 1; created = true; return Response.json({ project }); }
      if (url.endsWith("/projects")) return Response.json({ projects: created ? [{ id: project.id, title: project.title, revision: 1 }] : [] });
      if (url.endsWith("/projects/project-new")) return Response.json({ project });
      if (url.endsWith("/projects/project-new/runs")) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "全部项目" }));
    await screen.findByRole("heading", { name: "还没有项目" });
    fireEvent.click(screen.getByRole("button", { name: "＋ 新建项目" }));
    const dialog = within(screen.getByRole("dialog", { name: "新建项目" }));
    fireEvent.change(dialog.getByRole("textbox", { name: "项目名称" }), { target: { value: "新的短片" } });
    fireEvent.click(dialog.getByRole("button", { name: "创建并继续" }));
    fireEvent.keyDown(dialog.getByRole("textbox", { name: "项目名称" }), { key: "Enter" });
    await screen.findByRole("heading", { name: "今天想要创作什么？" });
    expect(postCount).toBe(1);
    expect(screen.queryByRole("dialog", { name: "新建项目" })).toBeNull();
  });

  it("recovers a created project with the same ID after the POST response is lost", async () => {
    let saved: CloudProject | null = null;
    let lookupCount = 0;
    const posted: Array<{ id: string; title: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { id: string; title: string };
        posted.push(body);
        if (!saved) {
          saved = { id: body.id, title: body.title, revision: 1, resourceRevisions: [],
            document: { version: 1, episodes: [{ id: "episode-1", title: "第 1 集", shots: [], timeline: [] }], assets: [], characters: [] } };
          throw new TypeError("response lost");
        }
        return Response.json({ error: "项目 ID 已存在" }, { status: 409 });
      }
      if (url.endsWith("/projects")) return Response.json({ projects: saved ? [{ id: saved.id, title: saved.title, revision: 1 }] : [] });
      if (saved && url.endsWith(`/projects/${saved.id}`)) {
        lookupCount += 1;
        if (lookupCount === 1) throw new TypeError("still offline");
        return Response.json({ project: saved });
      }
      if (saved && url.endsWith(`/projects/${saved.id}/runs`)) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    const first = render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "全部项目" }));
    fireEvent.click(await screen.findByRole("button", { name: "＋ 新建项目" }));
    const dialog = within(screen.getByRole("dialog", { name: "新建项目" }));
    fireEvent.change(dialog.getByRole("textbox", { name: "项目名称" }), { target: { value: "找回的短片" } });
    fireEvent.click(dialog.getByRole("button", { name: "创建并继续" }));
    await dialog.findByRole("alert");
    expect(posted).toHaveLength(1);
    first.unmount();
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "全部项目" }));
    fireEvent.click(await screen.findByRole("button", { name: "＋ 新建项目" }));
    const resumed = within(screen.getByRole("dialog", { name: "新建项目" }));
    expect((resumed.getByRole("textbox", { name: "项目名称" }) as HTMLInputElement).value).toBe("找回的短片");
    fireEvent.click(resumed.getByRole("button", { name: "查询原项目" }));
    await screen.findByRole("heading", { name: "今天想要创作什么？" });
    expect(posted).toHaveLength(2);
    expect(posted[0]).toEqual(posted[1]);
    expect(lookupCount).toBe(3);
    expect(screen.queryByRole("dialog", { name: "新建项目" })).toBeNull();
  });

  it("loads the same project and episode from the cloud session", async () => {
    const project: CloudProject = { id: "project-1", title: "小狗做饭", revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: "episode-1", title: "第 1 集", shots: [], timeline: [], timelineClips: [] }],
        assets: [], characters: [] } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects")) return Response.json({ projects: [{ id: project.id, title: project.title, revision: 1 }] });
      if (url.endsWith("/projects/project-1")) return Response.json({ project });
      if (url.endsWith("/projects/project-1/runs")) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "全部项目" }));
    fireEvent.click(await screen.findByRole("button", { name: /小狗做饭.*云端项目/ }));
    await screen.findByRole("heading", { name: "今天想要创作什么？" });
    expect(screen.getByRole("button", { name: "上传参考照片" })).toBeDefined();
    const nav = within(screen.getAllByRole("complementary", { name: "主导航" })[0]);
    fireEvent.click(nav.getByRole("button", { name: "资产" }));
    expect(screen.getByRole("heading", { name: "项目资产" })).toBeTruthy();
    expect(nav.getByRole("button", { name: "资产" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(nav.getByRole("button", { name: "结果" }));
    expect(screen.getByText(/已保存云端/)).toBeTruthy();
    fireEvent.click(nav.getByRole("button", { name: "首页" }));
    expect(screen.getByRole("heading", { name: "你想拍什么？" })).toBeTruthy();
    fireEvent.click(nav.getByRole("button", { name: "画布" }));
    await screen.findByRole("toolbar", { name: "添加节点" });
    expect(screen.getByRole("button", { name: "文本" })).toBeDefined();
    expect(screen.getByRole("button", { name: "时间线" })).toBeDefined();
  });

  it("shows a completed run on its original canvas node without adding a duplicate", () => {
    const project: CloudProject = { id: "project-1", title: "小狗做饭", revision: 2, resourceRevisions: [],
      document: { version: 1, assets: [{ id: "video-0001", kind: "video" }], characters: [],
        episodes: [{ id: "episode-1", title: "第 1 集", timeline: [], shots: [{ id: "run-0001", runId: "run-0001",
          resultAssetId: "video-0001", sourceAssetId: "photo-0001", prompt: "洗菜", durationSec: 5 }] }],
        extensions: { canvas: { version: 1, episodeGraphs: { "episode-1": { nodes: [{ id: "node-0001", type: "video",
          title: "镜头 1", x: 20, y: 30, shotId: "run-0001" }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } } } } } };
    const nodes = webManifest(project, "episode-1", null).studio!.episodes[0].nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: "node-0001", shotId: "run-0001", resultAssetId: "video-0001" });
  });

  it("keeps an unapproved shot plan out of video results", () => {
    const project: CloudProject = { id: "project-1", title: "小狗做饭", revision: 1, resourceRevisions: [],
      document: { version: 1, assets: [{ id: "photo-1", kind: "image" }], characters: [],
        episodes: [{ id: "episode-1", title: "第 1 集", shots: [], timeline: [] }] } };
    const run = { runId: "run-waiting", projectId: project.id, episodeId: "episode-1", sourceAssetId: "photo-1",
      input: "小狗端上晚餐", durationSec: 5, state: "waiting_approval", planHash: "plan-1",
      plan: { version: 1, planner: "validated-input", requiresApproval: true, steps: [{ id: "generate-video", tool: "image-video",
        sourceAssetId: "photo-1", episodeId: "episode-1", prompt: "小狗端上晚餐", durationSec: 5, demoCredits: 1 }] },
      operation: null } as AgentRunSnapshot;
    const manifest = webManifest(project, "episode-1", run);
    expect(manifest.jobs).toHaveLength(0);
    expect(manifest.shots).toHaveLength(0);
  });

  it("lands on the idea-first Home after reload and offers the recent project explicitly", async () => {
    window.localStorage.setItem("avs-web-last-project", "project-1");
    const project: CloudProject = { id: "project-1", title: "恢复项目", revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: "episode-1", title: "第 1 集", shots: [], timeline: [] }],
        assets: [], characters: [] } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects")) return Response.json({ projects: [{ id: project.id, title: project.title, revision: 1 }] });
      if (url.endsWith("/projects/project-1")) return Response.json({ project });
      if (url.endsWith("/projects/project-1/runs")) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    await screen.findByRole("heading", { name: "你想拍什么？" });
    await screen.findByRole("button", { name: "继续创作" });
    expect(screen.queryByRole("button", { name: /恢复项目.*云端项目/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "继续创作" }));
    await screen.findByRole("heading", { name: "今天想要创作什么？" });
  });

  it("carries a manually written Home idea into the selected project's video prompt", async () => {
    let project: CloudProject = { id: "project-1", title: "手写镜头", revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: "episode-1", title: "第 1 集", shots: [], timeline: [] }],
        assets: [], characters: [] } };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects")) return Response.json({ projects: [{ id: project.id, title: project.title, revision: 1 }] });
      if (url.endsWith("/projects/project-1/commands") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { payload: unknown };
        project = { ...project, document: { ...project.document, briefs: [body.payload as never] } };
        return Response.json({ project });
      }
      if (url.endsWith("/projects/project-1")) return Response.json({ project });
      if (url.endsWith("/projects/project-1/runs")) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗抬头看向镜头" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    await screen.findByRole("heading", { name: "开始这个作品" });
    fireEvent.click(screen.getByRole("button", { name: "加入已有项目" }));
    fireEvent.click(screen.getByRole("button", { name: /手写镜头.*云端项目/ }));
    fireEvent.click(screen.getByRole("button", { name: "直接生成一个镜头" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "我确认这是一段单镜头描述" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "加入项目并继续" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "加入项目并继续" }));
    const prompt = await screen.findByRole("textbox", { name: "最终镜头提示词" }) as HTMLTextAreaElement;
    expect(prompt.value).toBe("小狗抬头看向镜头");
    expect(project.document.briefs).toHaveLength(1);
    expect(screen.getByRole("button", { name: "检查镜头计划" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps new-project submit available after leaving a slow existing-project lookup", async () => {
    const project: CloudProject = { id: "slow-project", title: "慢速项目", revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: "episode-1", title: "第 1 集", shots: [], timeline: [] }],
        assets: [], characters: [] } };
    let resolveDetail!: (response: Response) => void;
    const detail = new Promise<Response>(resolve => { resolveDetail = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects")) return Response.json({ projects: [{ id: project.id, title: project.title, revision: 1 }] });
      if (url.endsWith("/projects/slow-project")) return detail;
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗做饭" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.click(screen.getByRole("button", { name: "加入已有项目" }));
    fireEvent.click(screen.getByRole("button", { name: /慢速项目.*云端项目/ }));
    await screen.findByText("正在加载项目");
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    expect(screen.getByRole("button", { name: "创建项目并继续" }).hasAttribute("disabled")).toBe(false);
    resolveDetail(Response.json({ project }));
    await waitFor(() => expect(screen.getByRole("button", { name: "创建项目并继续" }).hasAttribute("disabled")).toBe(false));
  });

  it("atomically saves a long script, recovers a lost create response, and opens an empty canvas", async () => {
    let created: CloudProject | null = null;
    const posts: Record<string, unknown>[] = [];
    const videoPosts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        posts.push(body);
        created = { id: String(body.id), title: String(body.title), revision: 1, resourceRevisions: [],
          document: { version: 1, episodes: [{ id: String(body.initialEpisodeId), title: "第 1 集", shots: [], timeline: [] }],
            assets: [], characters: [], briefs: [body.initialBrief as never] } };
        throw new TypeError("response lost");
      }
      if (url.endsWith("/projects")) return Response.json({ projects: created ? [{ id: created.id, title: created.title, revision: 1 }] : [] });
      if (created && url.endsWith(`/projects/${created.id}`)) return Response.json({ project: created });
      if (created && url.endsWith(`/projects/${created.id}/runs`) && method === "POST") videoPosts.push(init?.body);
      if (created && url.endsWith(`/projects/${created.id}/runs`)) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    const script = "小狗做饭。".repeat(450);
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: script } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    expect(screen.getByRole("button", { name: "直接生成一个镜头" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    fireEvent.click(screen.getByRole("button", { name: "创建项目并继续" }));
    await screen.findByRole("toolbar", { name: "添加节点" });
    expect(posts).toHaveLength(1);
    expect(posts[0].initialBrief).toMatchObject({ source: "manual", originalText: script, finalText: script });
    expect(videoPosts).toHaveLength(0);
    expect(screen.getByRole("button", { name: /创作原文/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /创作原文/ }));
    expect(within(screen.getByRole("dialog", { name: "创作原文" })).getByRole("textbox", { name: "输入原文" }).textContent).toBe(script);
  });

  it("shows both brief versions after a revision conflict and waits for an explicit choice", async () => {
    const brief = { id: "brief-0001", source: "manual" as const, originalText: "最初的构思", finalText: "服务端第一稿", createdAt: 1, updatedAt: 1 };
    let project: CloudProject = { id: "project-1", title: "冲突作品", revision: 1,
      resourceRevisions: [{ resourceType: "brief", resourceId: brief.id, revision: 1 }],
      document: { version: 1, episodes: [{ id: "episode-1", title: "第 1 集", shots: [], timeline: [] }],
        assets: [], characters: [], briefs: [brief] } };
    let commands = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects")) return Response.json({ projects: [{ id: project.id, title: project.title, revision: project.revision }] });
      if (url.endsWith("/projects/project-1/commands") && init?.method === "POST") {
        commands += 1;
        project = { ...project, revision: 2, resourceRevisions: [{ resourceType: "brief", resourceId: brief.id, revision: 2 }],
          document: { ...project.document, briefs: [{ ...brief, finalText: "服务端已修改的第二稿", updatedAt: 2 }] } };
        return Response.json({ error: "修订冲突" }, { status: 409 });
      }
      if (url.endsWith("/projects/project-1")) return Response.json({ project });
      if (url.endsWith("/projects/project-1/runs")) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "全部项目" }));
    fireEvent.click(await screen.findByRole("button", { name: /冲突作品.*云端项目/ }));
    await screen.findByRole("heading", { name: "今天想要创作什么？" });
    fireEvent.click(within(screen.getByRole("complementary", { name: "主导航" })).getByRole("button", { name: "画布" }));
    fireEvent.click(screen.getByRole("button", { name: /创作原文/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "最终创作内容" }), { target: { value: "本端编辑的第三稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存原文修改" }));
    const comparison = await screen.findByRole("region", { name: "创作原文冲突比较" });
    expect((within(comparison).getByRole("textbox", { name: "本端草稿" }) as HTMLTextAreaElement).value).toBe("本端编辑的第三稿");
    expect((within(comparison).getByRole("textbox", { name: "云端当前版本" }) as HTMLTextAreaElement).value).toBe("服务端已修改的第二稿");
    expect(project.document.briefs?.[0]?.originalText).toBe("最初的构思");
    expect(project.document.briefs?.[0]?.finalText).toBe("服务端已修改的第二稿");
    expect(commands).toBe(1);
    fireEvent.click(within(comparison).getByRole("button", { name: "保留本端草稿并返回" }));
    fireEvent.click(screen.getByRole("button", { name: /创作原文/ }));
    expect((screen.getByRole("textbox", { name: "本端草稿" }) as HTMLTextAreaElement).value).toBe("本端编辑的第三稿");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "确认以本端草稿覆盖云端版本" }));
    expect(commands).toBe(1);
    confirm.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "使用云端版本" }));
    expect((screen.getByRole("textbox", { name: "最终创作内容" }) as HTMLTextAreaElement).value).toBe("服务端已修改的第二稿");
    expect(commands).toBe(1);
  });

  it("restores an unfinished project setup after reload without creating a project", async () => {
    const createPosts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects") && init?.method === "POST") createPosts.push(init.body);
      if (url.endsWith("/projects")) return Response.json({ projects: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    const first = render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "未完成的构思" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    await screen.findByRole("heading", { name: "开始这个作品" });
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    first.unmount();
    render(<ThemeProvider><App /></ThemeProvider>);
    await screen.findByRole("heading", { name: "开始这个作品" });
    expect((screen.getByRole("textbox", { name: "最终创作内容" }) as HTMLTextAreaElement).value).toBe("未完成的构思");
    expect(screen.getByRole("button", { name: "进入画布编排" }).getAttribute("aria-pressed")).toBe("true");
    expect(createPosts).toHaveLength(0);
  });

  it("queries the same Home project after an uncertain create response", async () => {
    let saved: CloudProject | null = null;
    let lookups = 0;
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        posted.push(body);
        saved = { id: String(body.id), title: String(body.title), revision: 1, resourceRevisions: [],
          document: { version: 1, episodes: [{ id: String(body.initialEpisodeId), title: "第 1 集", shots: [], timeline: [] }],
            assets: [], characters: [], briefs: [body.initialBrief as never] } };
        throw new TypeError("response lost");
      }
      if (url.endsWith("/projects")) return Response.json({ projects: saved ? [{ id: saved.id, title: saved.title, revision: 1 }] : [] });
      if (saved && url.endsWith(`/projects/${saved.id}`)) {
        lookups += 1;
        if (lookups === 1) throw new TypeError("still offline");
        return Response.json({ project: saved });
      }
      if (saved && url.endsWith(`/projects/${saved.id}/runs`)) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    fireEvent.click(screen.getByRole("button", { name: "创建项目并继续" }));
    await screen.findByRole("button", { name: "查询原项目" });
    expect(posted).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "查询原项目" }));
    await screen.findByRole("toolbar", { name: "添加节点" });
    expect(posted).toHaveLength(1);
    expect(lookups).toBeGreaterThanOrEqual(2);
  });

  it("keeps idea selection free of video runs until the user checks the shot plan", async () => {
    let project: CloudProject = { id: "project-1", title: "晚餐故事", revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: "episode-1", title: "第 1 集", shots: [], timeline: [] }],
        assets: [{ id: "photo-1", kind: "image", name: "小狗.jpg" }], characters: [] } };
    const variants = [
      { id: "warm-0001", title: "温暖", description: "暖光厨房", prompt: "小狗端上热腾腾的晚餐" },
      { id: "fun-0001", title: "轻快", description: "节奏明快", prompt: "小狗开心地端上晚餐" },
      { id: "film-0001", title: "电影", description: "电影光影", prompt: "小狗在厨房光影中端菜" },
    ];
    let idea: Record<string, unknown> | null = null;
    const videoPosts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas") && method === "GET") return Response.json({ ideaSets: [] });
      if (url.endsWith("/prompt-ideas") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { clientRequestId: string; input: string };
        idea = { id: "idea-0001", clientRequestId: body.clientRequestId, input: body.input, state: "ready", variants,
          selectedVariantId: null, editedPrompt: null, createdAt: Date.now(), updatedAt: Date.now(), error: null, errorCode: null };
        return Response.json({ ideaSet: idea });
      }
      if (url.endsWith("/prompt-ideas/idea-0001/selection") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { variantId: string; editedPrompt: string };
        idea = { ...idea, selectedVariantId: body.variantId, editedPrompt: body.editedPrompt };
        return Response.json({ ideaSet: idea });
      }
      if (url.endsWith("/projects")) return Response.json({ projects: [{ id: project.id, title: project.title, revision: 1,
        updatedAt: Date.now(), recentEpisode: { id: "episode-1", title: "第 1 集", shotCount: 0 } }] });
      if (url.endsWith("/projects/project-1/commands") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { payload: unknown };
        project = { ...project, document: { ...project.document, briefs: [body.payload as never] } };
        return Response.json({ project });
      }
      if (url.endsWith("/projects/project-1")) return Response.json({ project });
      if (url.endsWith("/projects/project-1/runs") && method === "POST") {
        videoPosts.push(JSON.parse(String(init?.body)));
        return Response.json({ run: { runId: "run-1", projectId: project.id, episodeId: "episode-1", state: "waiting_approval",
          sourceAssetId: "photo-1", input: "小狗端上晚餐", durationSec: 5, planHash: "plan-1",
          plan: { planner: "test", steps: [{ prompt: "小狗端上晚餐", durationSec: 5 }] }, operation: null } });
      }
      if (url.endsWith("/projects/project-1/runs")) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗做饭" } });
    fireEvent.click(screen.getByRole("button", { name: "让 Agent 给我 3 个方向" }));
    fireEvent.click(await screen.findByRole("button", { name: /方向 2/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "最终镜头提示词" }), { target: { value: "小狗端上晚餐" } });
    fireEvent.click(screen.getByRole("button", { name: "用这条灵感开始" }));
    await screen.findByRole("heading", { name: "开始这个作品" });
    expect(videoPosts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "加入已有项目" }));
    fireEvent.click(screen.getByRole("button", { name: /晚餐故事.*云端项目/ }));
    fireEvent.click(screen.getByRole("button", { name: "直接生成一个镜头" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "加入项目并继续" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "加入项目并继续" }));
    await screen.findByRole("heading", { name: "确认照片、分集和提示词" });
    expect(videoPosts).toHaveLength(0);
    expect((screen.getByRole("textbox", { name: "最终镜头提示词" }) as HTMLTextAreaElement).value).toBe("小狗端上晚餐");
    fireEvent.click(screen.getByRole("button", { name: "检查镜头计划" }));
    await waitFor(() => expect(videoPosts).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "确认并开始生成" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("complementary", { name: "主导航" })).getByRole("button", { name: "结果" }));
    expect(screen.getByText("还没有视频结果")).toBeTruthy();
    expect(screen.queryByText("提交状态待确认")).toBeNull();
  });

  it("replays a persisted canvas request identity after reload and links the original node", async () => {
    window.localStorage.setItem("avs-web-last-project", "project-1");
    const input = { episodeId: "episode-1", sourceAssetId: "photo-1", input: "小狗洗菜", durationSec: 5 as const };
    const graph = { nodes: [{ id: "node-1", type: "video" as const, title: "镜头 1", x: 20, y: 30,
      clientRequestId: "request-before-reload", runInput: input }], edges: [],
      viewport: { x: 0, y: 0, zoom: 1 } };
    let project: CloudProject = { id: "project-1", title: "恢复画布", revision: 1,
      resourceRevisions: [{ resourceType: "canvas", resourceId: "episode-1", revision: 1 }],
      document: { version: 1, assets: [{ id: "photo-1", kind: "image" }], characters: [],
        episodes: [{ id: "episode-1", title: "第 1 集", shots: [], timeline: [] }],
        extensions: { canvas: { version: 1, episodeGraphs: { "episode-1": graph } } } } };
    const run = { runId: "run-1", projectId: "project-1", ...input, state: "waiting_approval", planHash: "plan-1",
      plan: { planner: "test", steps: [{ prompt: "小狗洗菜", durationSec: 5 }] }, operation: null };
    const requestBodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com",
        demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects")) return Response.json({ projects: [{ id: project.id, title: project.title, revision: project.revision }] });
      if (url.endsWith("/projects/project-1") && init?.method === "GET") return Response.json({ project });
      if (url.endsWith("/projects/project-1/runs") && init?.method === "POST") {
        requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Response.json({ run });
      }
      if (url.endsWith("/projects/project-1/runs")) return Response.json({ runs: [run] });
      if (url.endsWith("/projects/project-1/commands") && init?.method === "POST") {
        const command = JSON.parse(String(init.body)) as { payload: typeof graph };
        project = { ...project, revision: 2,
          resourceRevisions: [{ resourceType: "canvas", resourceId: "episode-1", revision: 2 }],
          document: { ...project.document, extensions: { canvas: {
            version: 1, episodeGraphs: { "episode-1": command.payload },
          } } } };
        return Response.json({ project });
      }
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "继续创作" }));
    await waitFor(() => expect(requestBodies).toHaveLength(1));
    expect(requestBodies[0].clientRequestId).toBe("request-before-reload");
    await waitFor(() => expect((project.document.extensions?.canvas as {
      episodeGraphs: Record<string, { nodes: { shotId?: string }[] }>
    }).episodeGraphs["episode-1"].nodes[0].shotId).toBe("run-1"));
  });

  it("keeps late project and idea lists from the previous account out of the new account", async () => {
    const oldProjects = deferredResponse(), oldIdeas = deferredResponse();
    let session = "A";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: testAccount("A") });
      if (url.endsWith("/auth/logout")) { session = "none"; return Response.json({ ok: true }); }
      if (url.endsWith("/auth/login") && init?.method === "POST") { session = "B"; return Response.json({ account: testAccount("B") }); }
      if (url.endsWith("/projects")) return session === "A" ? oldProjects.promise : Response.json({ projects: [{ id: "B-project", title: "B 的项目", revision: 1 }] });
      if (url.endsWith("/prompt-ideas")) return session === "A" ? oldIdeas.promise : Response.json({ ideaSets: [testIdea("B-idea", "B 的灵感")] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "退出登录" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "邮箱" }), { target: { value: "B@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并开始创作" }));
    await screen.findByText("你的想法：B 的灵感");
    oldProjects.resolve(Response.json({ projects: [{ id: "A-project", title: "A 的私有项目", revision: 1 }] }));
    oldIdeas.resolve(Response.json({ ideaSets: [testIdea("A-idea", "A 的私有灵感")] }));
    fireEvent.click(screen.getByRole("button", { name: "全部项目" }));
    await screen.findByRole("button", { name: /B 的项目.*云端项目/ });
    expect(screen.queryByText("A 的私有项目")).toBeNull();
    fireEvent.click(within(screen.getByRole("complementary", { name: "主导航" })).getByRole("button", { name: "首页" }));
    expect(screen.getByText("你的想法：B 的灵感")).toBeTruthy();
    expect(screen.queryByText(/A 的私有灵感/)).toBeNull();
  });

  it("ignores an old startup auth response after an explicit new login", async () => {
    const oldMe = deferredResponse();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return oldMe.promise;
      if (url.endsWith("/auth/login") && init?.method === "POST") return Response.json({ account: testAccount("B") });
      if (url.endsWith("/projects")) return Response.json({ projects: [] });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "邮箱" }), { target: { value: "B@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并开始创作" }));
    await screen.findByText("B@example.com");
    oldMe.resolve(Response.json({ account: testAccount("A") }));
    await waitFor(() => expect(screen.getByText("B@example.com")).toBeTruthy());
    expect(screen.queryByText("A@example.com")).toBeNull();
  });

  it("clears the previous email and password from the login form after logout", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ error: "请先登录" }, { status: 401 });
      if (url.endsWith("/auth/login") && init?.method === "POST") return Response.json({ account: testAccount("A") });
      if (url.endsWith("/auth/logout")) return Response.json({ ok: true });
      if (url.endsWith("/projects")) return Response.json({ projects: [] });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "邮箱" }), { target: { value: "A@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "private-password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并开始创作" }));
    fireEvent.click(await screen.findByRole("button", { name: "退出登录" }));
    expect((await screen.findByRole("textbox", { name: "邮箱" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe("");
  });

  it("keeps the account visible when logout fails and the server session remains, then retries", async () => {
    let logoutCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: testAccount("A") });
      if (url.endsWith("/auth/logout")) {
        logoutCalls += 1;
        if (logoutCalls === 1) throw new TypeError("network lost");
        return Response.json({ ok: true });
      }
      if (url.endsWith("/projects")) return Response.json({ projects: [] });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "退出登录" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("退出失败，账号仍已登录"));
    expect(screen.getByText("A@example.com")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "邮箱" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByRole("textbox", { name: "邮箱" })).toBeTruthy();
    expect(logoutCalls).toBe(2);
  });

  it("keeps the account and shows uncertainty when logout and session check both lose the network", async () => {
    let authChecks = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/me")) {
        authChecks += 1;
        if (authChecks > 1) throw new TypeError("session check offline");
        return Response.json({ account: testAccount("A") });
      }
      if (url.endsWith("/auth/logout")) throw new TypeError("logout offline");
      if (url.endsWith("/projects")) return Response.json({ projects: [] });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "退出登录" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("退出状态无法确认"));
    expect(screen.getByText("A@example.com")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "邮箱" })).toBeNull();
  });

  it("does not open an old project when its detail returns after switching accounts", async () => {
    const oldDetail = deferredResponse();
    let session = "A";
    const oldProject: CloudProject = { id: "A-project", title: "A 的私有项目", revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: "A-episode", title: "第 1 集", shots: [], timeline: [] }], assets: [], characters: [] } };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: testAccount("A") });
      if (url.endsWith("/auth/logout")) { session = "none"; return Response.json({ ok: true }); }
      if (url.endsWith("/auth/login") && init?.method === "POST") { session = "B"; return Response.json({ account: testAccount("B") }); }
      if (url.endsWith("/projects/A-project")) return oldDetail.promise;
      if (url.endsWith("/projects")) return Response.json({ projects: session === "A" ? [{ id: oldProject.id, title: oldProject.title, revision: 1 }] : [] });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "全部项目" }));
    fireEvent.click(await screen.findByRole("button", { name: /A 的私有项目.*云端项目/ }));
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "邮箱" }), { target: { value: "B@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并开始创作" }));
    await screen.findByText("B@example.com");
    oldDetail.resolve(Response.json({ project: oldProject }));
    fireEvent.click(within(screen.getByRole("complementary", { name: "主导航" })).getByRole("button", { name: "创作" }));
    expect(await screen.findByRole("heading", { name: "创作需要先打开项目" })).toBeTruthy();
    expect(screen.queryByText("A 的私有项目")).toBeNull();
  });

  it("stops an old work setup before writing its brief under a new account", async () => {
    const oldSubmitDetail = deferredResponse();
    let session = "A", detailCalls = 0, briefPosts = 0;
    const oldProject: CloudProject = { id: "A-project", title: "A 的作品", revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: "A-episode", title: "第 1 集", shots: [], timeline: [] }], assets: [], characters: [] } };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: testAccount("A") });
      if (url.endsWith("/auth/logout")) { session = "none"; return Response.json({ ok: true }); }
      if (url.endsWith("/auth/login") && init?.method === "POST") { session = "B"; return Response.json({ account: testAccount("B") }); }
      if (url.endsWith("/projects/A-project/commands")) { briefPosts += 1; return Response.json({ project: oldProject }); }
      if (url.endsWith("/projects/A-project")) { detailCalls += 1; return detailCalls === 1 ? Response.json({ project: oldProject }) : oldSubmitDetail.promise; }
      if (url.endsWith("/projects")) return Response.json({ projects: session === "A" ? [{ id: oldProject.id, title: oldProject.title, revision: 1 }] : [] });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "A 的私有剧本" } });
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    fireEvent.click(screen.getByRole("button", { name: "加入已有项目" }));
    fireEvent.click(screen.getByRole("button", { name: /A 的作品.*云端项目/ }));
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "加入项目并继续" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "加入项目并继续" }));
    await waitFor(() => expect(detailCalls).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "邮箱" }), { target: { value: "B@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并开始创作" }));
    await screen.findByText("B@example.com");
    oldSubmitDetail.resolve(Response.json({ project: oldProject }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "你想拍什么？" })).toBeTruthy());
    expect(briefPosts).toBe(0);
    expect(screen.queryByText("A 的私有剧本")).toBeNull();
  });

  it("lets the new account edit while an old account command is still pending", async () => {
    const oldCommand = deferredResponse();
    let session = "A", oldPosts = 0, newPosts = 0;
    const makeProject = (id: string): CloudProject => ({ id: `${id}-project`, title: `${id} 的作品`, revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: `${id}-episode`, title: "第 1 集", shots: [], timeline: [] }], assets: [], characters: [] } });
    const projects = { A: makeProject("A"), B: makeProject("B") };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: testAccount("A") });
      if (url.endsWith("/auth/logout")) { session = "none"; return Response.json({ ok: true }); }
      if (url.endsWith("/auth/login") && init?.method === "POST") { session = "B"; return Response.json({ account: testAccount("B") }); }
      if (url.endsWith("/projects")) return Response.json({ projects: session === "A" ? [{ id: "A-project", title: projects.A.title, revision: 1 }] : [{ id: "B-project", title: projects.B.title, revision: 1 }] });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects/A-project/commands")) { oldPosts += 1; return oldCommand.promise; }
      if (url.endsWith("/projects/B-project/commands")) { newPosts += 1; return Response.json({ project: projects.B }); }
      if (url.endsWith("/projects/A-project")) return Response.json({ project: projects.A });
      if (url.endsWith("/projects/B-project")) return Response.json({ project: projects.B });
      if (url.endsWith("/projects/A-project/runs") || url.endsWith("/projects/B-project/runs")) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "全部项目" }));
    fireEvent.click(await screen.findByRole("button", { name: /A 的作品.*云端项目/ }));
    await screen.findByRole("heading", { name: "今天想要创作什么？" });
    fireEvent.click(within(screen.getByRole("complementary", { name: "主导航" })).getByRole("button", { name: "画布" }));
    fireEvent.click(await screen.findByRole("button", { name: "文本" }));
    await waitFor(() => expect(oldPosts).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "邮箱" }), { target: { value: "B@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并开始创作" }));
    fireEvent.click(await screen.findByRole("button", { name: "全部项目" }));
    fireEvent.click(await screen.findByRole("button", { name: /B 的作品.*云端项目/ }));
    await screen.findByRole("heading", { name: "今天想要创作什么？" });
    fireEvent.click(within(screen.getByRole("complementary", { name: "主导航" })).getByRole("button", { name: "画布" }));
    fireEvent.click(await screen.findByRole("button", { name: "文本" }));
    await waitFor(() => expect(newPosts).toBe(1));
    oldCommand.resolve(Response.json({ project: projects.A }));
    expect(document.querySelector(".avs-sidebar-project")?.textContent).toContain("B 的作品");
  });

  it("does not finish the new account's photo picker with an old upload response", async () => {
    const oldUpload = deferredResponse(), newUpload = deferredResponse();
    let session = "A";
    const makeProject = (id: string): CloudProject => ({ id: `${id}-project`, title: `${id} 的作品`, revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: `${id}-episode`, title: "第 1 集", shots: [], timeline: [] }], assets: [], characters: [] } });
    const projects = { A: makeProject("A"), B: makeProject("B") };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: testAccount("A") });
      if (url.endsWith("/auth/logout")) { session = "none"; return Response.json({ ok: true }); }
      if (url.endsWith("/auth/login") && init?.method === "POST") { session = "B"; return Response.json({ account: testAccount("B") }); }
      if (url.endsWith("/objects") && init?.method === "POST") return session === "A" ? oldUpload.promise : newUpload.promise;
      if (url.endsWith("/projects")) return Response.json({ projects: session === "A" ? [{ id: "A-project", title: projects.A.title, revision: 1 }] : [{ id: "B-project", title: projects.B.title, revision: 1 }] });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects/B-project/commands") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { payload: { id: string; kind: "image"; name: string } };
        projects.B = { ...projects.B, document: { ...projects.B.document, assets: [...projects.B.document.assets, body.payload] } };
        return Response.json({ project: projects.B });
      }
      if (url.endsWith("/projects/A-project")) return Response.json({ project: projects.A });
      if (url.endsWith("/projects/B-project")) return Response.json({ project: projects.B });
      if (url.endsWith("/projects/A-project/runs") || url.endsWith("/projects/B-project/runs")) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "全部项目" }));
    fireEvent.click(await screen.findByRole("button", { name: /A 的作品.*云端项目/ }));
    await screen.findByRole("heading", { name: "今天想要创作什么？" });
    fireEvent.click(within(screen.getByRole("complementary", { name: "主导航" })).getByRole("button", { name: "画布" }));
    fireEvent.click(await screen.findByRole("button", { name: "图片" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "添加图片节点" })).getByRole("button", { name: "上传本地照片" }));
    fireEvent.change(screen.getByLabelText("上传参考照片文件"), { target: { files: [new File(["old"], "A.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "邮箱" }), { target: { value: "B@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录并开始创作" }));
    fireEvent.click(await screen.findByRole("button", { name: "全部项目" }));
    fireEvent.click(await screen.findByRole("button", { name: /B 的作品.*云端项目/ }));
    await screen.findByRole("heading", { name: "今天想要创作什么？" });
    fireEvent.click(within(screen.getByRole("complementary", { name: "主导航" })).getByRole("button", { name: "画布" }));
    fireEvent.click(await screen.findByRole("button", { name: "图片" }));
    const dialog = within(screen.getByRole("dialog", { name: "添加图片节点" }));
    fireEvent.click(dialog.getByRole("button", { name: "上传本地照片" }));
    fireEvent.change(screen.getByLabelText("上传参考照片文件"), { target: { files: [new File(["new"], "B.jpg", { type: "image/jpeg" })] } });
    await act(async () => { oldUpload.resolve(Response.json({ object: { id: "A-photo", mime: "image/jpeg", size: 3 } })); await oldUpload.promise; });
    expect(dialog.getByRole("button", { name: "确认添加" }).hasAttribute("disabled")).toBe(true);
    await act(async () => { newUpload.resolve(Response.json({ object: { id: "B-photo", mime: "image/jpeg", size: 3 } })); await newUpload.promise; });
    await waitFor(() => expect(dialog.getByRole("button", { name: "确认添加" }).hasAttribute("disabled")).toBe(false));
    expect((dialog.getByRole("combobox", { name: "人物参考照片" }) as HTMLSelectElement).value).toBe("B-photo");
  });

  it("keeps the most recently chosen project when an earlier detail returns late", async () => {
    const slowFirst = deferredResponse();
    const makeProject = (id: string): CloudProject => ({ id, title: `${id} 的作品`, revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: `${id}-episode`, title: "第 1 集", shots: [], timeline: [] }], assets: [], characters: [] } });
    const first = makeProject("first"), second = makeProject("second");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: testAccount("A") });
      if (url.endsWith("/projects")) return Response.json({ projects: [first, second].map(item => ({ id: item.id, title: item.title, revision: 1 })) });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects/first")) return slowFirst.promise;
      if (url.endsWith("/projects/second")) return Response.json({ project: second });
      if (url.endsWith("/projects/second/runs")) return Response.json({ runs: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "全部项目" }));
    fireEvent.click(await screen.findByRole("button", { name: /first 的作品.*云端项目/ }));
    fireEvent.click(screen.getByRole("button", { name: /second 的作品.*云端项目/ }));
    await waitFor(() => expect(document.querySelector(".avs-sidebar-project")?.textContent).toContain("second 的作品"));
    await act(async () => { slowFirst.resolve(Response.json({ project: first })); await slowFirst.promise; });
    await waitFor(() => expect(document.querySelector(".avs-sidebar-project")?.textContent).toContain("second 的作品"));
    expect(document.querySelector(".avs-sidebar-project")?.textContent).not.toContain("first 的作品");
  });
});
