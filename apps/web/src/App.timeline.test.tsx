import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "@ai-video/ui-web";
import App from "./App";
import type { CloudProject } from "./api";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });

describe("web episode timeline entry", () => {
  it("opens the shared editor from canvas and returns to the same episode", async () => {
    HTMLMediaElement.prototype.pause = vi.fn();
    let project: CloudProject = { id: "project-timeline", title: "小狗做饭", revision: 3,
      resourceRevisions: [{ resourceType: "episode", resourceId: "episode-one", revision: 3 }],
      document: { version: 1, episodes: [{ id: "episode-one", title: "第 1 集", shots: [],
        timeline: ["video-one", "video-two"], timelineClips: [
          { id: "clip-one", assetId: "video-one", inMs: 0, outMs: 5000, volume: 1 },
          { id: "clip-two", assetId: "video-two", inMs: 0, outMs: 5000, volume: 1 }],
        audio: { version: 2, originalVolume: 1, voiceClips: [{ id: "voice-clip", assetId: "voice-one",
          startMs: 0, inMs: 0, outMs: 2000, volume: 1, anchor: { kind: "absolute" } }], musicClips: [] } }],
        assets: [{ id: "video-one", kind: "video", name: "镜头", durationMs: 5000 },
          { id: "video-two", kind: "video", name: "第二镜头", durationMs: 5000 },
          { id: "voice-one", kind: "voice", name: "妈妈下班", durationMs: 2000 }], characters: [] } };
    const savedEpisodes: Array<{ timeline: string[] }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: "account-one", email: "demo@example.com",
        demo_quota: 3, demo_reserved: 0, demo_used: 0 } });
      if (url.endsWith("/prompt-ideas")) return Response.json({ ideaSets: [] });
      if (url.endsWith("/projects")) return Response.json({ projects: [{ id: project.id, title: project.title, revision: 3 }] });
      if (url.endsWith("/projects/project-timeline")) return Response.json({ project });
      if (url.endsWith("/projects/project-timeline/commands") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body)) as { payload: CloudProject["document"]["episodes"][number] };
        savedEpisodes.push(payload.payload);
        project = { ...project, revision: project.revision + 1,
          resourceRevisions: [{ resourceType: "episode", resourceId: "episode-one", revision: 4 }],
          document: { ...project.document, episodes: [payload.payload] } };
        return Response.json({ project });
      }
      if (url.endsWith("/projects/project-timeline/runs")) return Response.json({ runs: [] });
      if (url.endsWith("/tts/voices")) return Response.json({ voices: [] });
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "全部项目" }));
    fireEvent.click(await screen.findByRole("button", { name: /小狗做饭.*云端项目/ }));
    await screen.findByRole("heading", { name: "今天想要创作什么？" });
    const navigation = within(screen.getByRole("complementary", { name: "主导航" }));
    fireEvent.click(navigation.getByRole("button", { name: "画布" }));
    fireEvent.click(await screen.findByRole("button", { name: "整集剪辑" }));
    expect(screen.getByRole("region", { name: "整集剪辑" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /妈妈下班，0.0 秒开始/ })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "本集配音与导出" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "将镜头 2前移" }));
    await waitFor(() => expect(savedEpisodes).toHaveLength(1));
    expect(savedEpisodes[0].timeline).toEqual(["video-two", "video-one"]);
    fireEvent.click(screen.getByRole("button", { name: "返回画布" }));
    expect(await screen.findByRole("button", { name: "整集剪辑" })).toBeTruthy();
  });
});
