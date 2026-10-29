import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "@ai-video/ui-web";
import App, { webManifest } from "./App";
import type { AgentRunSnapshot, CloudProject } from "./api";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); });

describe("web entry", () => {
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
    fireEvent.change(await screen.findByRole("textbox", { name: "你的想法" }), { target: { value: "小狗第一次做晚餐" } });
    expect(document.querySelector(".web-studio .avs-titlebar")).toBeNull();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
    expect(screen.queryByText(/Agent 在线/)).toBeNull();
    expect(screen.getByText(/Agent 帮你构思镜头/)).toBeTruthy();
    const nav = within(screen.getAllByRole("complementary", { name: "主导航" })[0]);
    for (const [label, heading] of [["创作", "创作需要先打开项目"], ["画布", "画布需要先打开项目"],
      ["结果", "结果需要先打开项目"], ["资产", "资产需要先打开项目"]]) {
      fireEvent.click(nav.getByRole("button", { name: label }));
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
      expect(nav.getByRole("button", { name: label }).getAttribute("aria-current")).toBe("page");
      expect(nav.getByRole("button", { name: "首页" }).getAttribute("aria-current")).toBeNull();
    }
    fireEvent.click(nav.getByRole("button", { name: "首页" }));
    expect((screen.getByRole("textbox", { name: "你的想法" }) as HTMLTextAreaElement).value).toBe("小狗第一次做晚餐");
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
    fireEvent.click(await screen.findByRole("button", { name: "开始新项目" }));
    const dialog = within(screen.getByRole("dialog", { name: "新建项目" }));
    fireEvent.change(dialog.getByRole("textbox", { name: "项目名称" }), { target: { value: "找回的短片" } });
    fireEvent.click(dialog.getByRole("button", { name: "创建并继续" }));
    await dialog.findByRole("alert");
    expect(posted).toHaveLength(1);
    first.unmount();
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "开始新项目" }));
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
    expect(screen.getByRole("heading", { name: "今天想拍什么？" })).toBeTruthy();
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
    await screen.findByRole("heading", { name: "今天想拍什么？" });
    await screen.findByRole("button", { name: "继续创作" });
    expect(screen.queryByRole("button", { name: /恢复项目.*云端项目/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "继续创作" }));
    await screen.findByRole("heading", { name: "今天想要创作什么？" });
  });

  it("carries a manually written Home idea into the selected project's video prompt", async () => {
    const project: CloudProject = { id: "project-1", title: "手写镜头", revision: 1, resourceRevisions: [],
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
    fireEvent.change(await screen.findByRole("textbox", { name: "你的想法" }), { target: { value: "小狗抬头看向镜头" } });
    fireEvent.click(screen.getByRole("button", { name: "我已有提示词" }));
    fireEvent.click(await screen.findByRole("button", { name: /手写镜头.*云端项目/ }));
    const prompt = await screen.findByRole("textbox", { name: "场景和动作提示词" }) as HTMLTextAreaElement;
    expect(prompt.value).toBe("小狗抬头看向镜头");
  });

  it("keeps idea selection free of video runs until the user checks the shot plan", async () => {
    const project: CloudProject = { id: "project-1", title: "晚餐故事", revision: 1, resourceRevisions: [],
      document: { version: 1, episodes: [{ id: "episode-1", title: "第 1 集", shots: [], timeline: [] }],
        assets: [{ id: "photo-1", kind: "image", name: "小狗.jpg" }], characters: [] } };
    const variants = [
      { id: "warm", title: "温暖", description: "暖光厨房", prompt: "小狗端上热腾腾的晚餐" },
      { id: "fun", title: "轻快", description: "节奏明快", prompt: "小狗开心地端上晚餐" },
      { id: "film", title: "电影", description: "电影光影", prompt: "小狗在厨房光影中端菜" },
    ];
    let idea: Record<string, unknown> | null = null;
    const videoPosts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-1", email: "demo@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas") && method === "GET") return Response.json({ ideaSets: [] });
      if (url.endsWith("/prompt-ideas") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { clientRequestId: string; input: string };
        idea = { id: "idea-1", clientRequestId: body.clientRequestId, input: body.input, state: "ready", variants };
        return Response.json({ ideaSet: idea });
      }
      if (url.endsWith("/prompt-ideas/idea-1/selection") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { variantId: string; editedPrompt: string };
        idea = { ...idea, selectedVariantId: body.variantId, editedPrompt: body.editedPrompt };
        return Response.json({ ideaSet: idea });
      }
      if (url.endsWith("/projects")) return Response.json({ projects: [{ id: project.id, title: project.title, revision: 1,
        updatedAt: Date.now(), recentEpisode: { id: "episode-1", title: "第 1 集", shotCount: 0 } }] });
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
    fireEvent.change(await screen.findByRole("textbox", { name: "你的想法" }), { target: { value: "小狗做饭" } });
    fireEvent.click(screen.getByRole("button", { name: "给我三种灵感" }));
    fireEvent.click(await screen.findByRole("button", { name: /方向 2/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "最终镜头提示词" }), { target: { value: "小狗端上晚餐" } });
    fireEvent.click(screen.getByRole("button", { name: "保存这一版并继续" }));
    await screen.findByRole("heading", { name: "把这条灵感放在哪个项目？" });
    expect(videoPosts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /晚餐故事.*第 1 集/ }));
    await screen.findByRole("heading", { name: "确认照片、分集和提示词" });
    expect(videoPosts).toHaveLength(0);
    expect((screen.getByRole("textbox", { name: "最终镜头提示词" }) as HTMLTextAreaElement).value).toBe("小狗端上晚餐");
    fireEvent.click(screen.getByRole("button", { name: "检查镜头计划" }));
    await waitFor(() => expect(videoPosts).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "确认并调用后台生成" })).toBeTruthy();
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
});
