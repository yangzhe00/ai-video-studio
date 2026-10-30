import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureStudio, readCanvasDocument } from "@ai-video/project-core";
import type { ProjectManifestV2 } from "@ai-video/project-core";
import { ensureCloudReference, SyncConflictError, syncProject } from "./sync";
import type { CloudProject } from "./cloud";

const state = vi.hoisted(() => ({ project: null as CloudProject | null, commands: [] as string[],
  requests: [] as { path: string; method: string; body?: any }[], failCreateResponse: false }));
vi.mock("./native", () => ({ saveProject: vi.fn(async () => {}) }));
vi.mock("./cloud", () => ({
  cloudRequest: vi.fn(async (path: string, method = "GET", body?: any) => {
    state.requests.push({ path, method, body });
    if (method === "POST" && path === "/projects") {
      state.project ??= { id: body.id, title: body.title, revision: 1,
        document: { version: 1, episodes: [{ id: body.initialEpisodeId, title: "第 1 集", shots: [], timeline: [] }],
          assets: [], characters: [], briefs: body.initialBrief ? [body.initialBrief] : [] },
        resourceRevisions: [{ resourceType: "episode", resourceId: body.initialEpisodeId, revision: 1 },
          ...(body.initialBrief ? [{ resourceType: "brief" as const, resourceId: body.initialBrief.id, revision: 1 }] : [])] };
      if (state.failCreateResponse) { state.failCreateResponse = false; throw new Error("网络断开"); }
    }
    if (!state.project) throw new Error("项目不存在");
    return { project: structuredClone(state.project) };
  }),
  cloudUploadAsset: vi.fn(async () => { throw new Error("不应上传已关联素材"); }),
  cloudDownloadAsset: vi.fn(async () => { throw new Error("不应下载已存在素材"); }),
  cloudCommand: vi.fn(async (_project: CloudProject, type: string, id: string, payload: unknown) => {
    const next = structuredClone(state.project!);
    state.commands.push(`${type}:${id}`);
    if (type === "canvas") {
      next.document.extensions ??= {};
      next.document.extensions.canvas ??= { version: 1, episodeGraphs: {} };
      const canvas = next.document.extensions.canvas as { version: 1; episodeGraphs: Record<string, unknown> };
      canvas.episodeGraphs[id] = payload;
    } else {
      const field = type === "episode" ? "episodes" : type === "asset" ? "assets" : type === "brief" ? "briefs" : "characters";
      next.document.briefs ??= [];
      const entries = next.document[field] as { id: string }[];
      const index = entries.findIndex(item => item.id === id);
      if (index >= 0) entries[index] = payload as { id: string };
      else entries.push(payload as { id: string });
    }
    next.revision++;
    const resource = next.resourceRevisions.find(item => item.resourceType === type && item.resourceId === id);
    if (resource) resource.revision++;
    else next.resourceRevisions.push({ resourceType: type as "episode", resourceId: id, revision: 1 });
    state.project = next;
    return structuredClone(next);
  }),
}));

const account = { id: "account-0001", email: "a@example.com", demo_quota: 1, demo_reserved: 0, demo_used: 0 };

function fixture(): ProjectManifestV2 {
  const image = { id: "local-image", kind: "image" as const, relativePath: "assets/photo.jpg",
    durationMs: null, width: 640, height: 480, missing: false };
  const base: ProjectManifestV2 = { version: 2, id: "project-0001", title: "项目", assets: [image], clips: [], captions: [],
    publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null };
  const local = ensureStudio(base);
  local.studio!.characters = [{ id: "character-0001", name: "人物 B", description: "", assetId: image.id }];
  const episode = local.studio!.episodes[0];
  state.project = { id: local.id, title: local.title, revision: 3,
    document: { version: 1,
      episodes: [{ id: episode.id, title: episode.title, shots: [], timeline: [], timelineClips: [] }],
      assets: [{ id: "cloud-image", kind: "image", name: "photo.jpg" }],
      characters: [{ id: "character-0001", name: "人物 B", description: "", assetId: "cloud-image" }],
      extensions: { canvas: readCanvasDocument(local) },
    },
    resourceRevisions: [
      { resourceType: "asset", resourceId: "cloud-image", revision: 1 },
      { resourceType: "character", resourceId: "character-0001", revision: 1 },
      { resourceType: "episode", resourceId: episode.id, revision: 1 },
      { resourceType: "canvas", resourceId: episode.id, revision: 1 },
    ],
  };
  local.extensions = { ...local.extensions, cloudSync: { version: 1, accountId: account.id, projectId: local.id,
    revision: state.project.revision, assetMap: { [image.id]: "cloud-image" }, fingerprint: "",
    resourceRevisions: structuredClone(state.project.resourceRevisions) } };
  return local;
}

beforeEach(() => { state.project = null; state.commands = []; state.requests = []; state.failCreateResponse = false; });

describe("desktop resource sync", () => {
  it("pushes local episode A while pulling an independent cloud character B edit", async () => {
    const seeded = await syncProject("/project", fixture(), account);
    state.commands = [];
    const local = structuredClone(seeded.manifest);
    local.studio!.episodes[0].title = "本地修改 A";
    const remote = state.project!;
    remote.document.characters[0].name = "云端修改 B";
    remote.revision++;
    remote.resourceRevisions.find(item => item.resourceType === "character")!.revision++;
    const result = await syncProject("/project", local, account);
    expect(state.commands).toEqual([`episode:${local.studio!.episodes[0].id}`]);
    expect(result.manifest.studio!.episodes[0].title).toBe("本地修改 A");
    expect(result.manifest.studio!.characters[0].name).toBe("云端修改 B");
  });

  it("stops when the same character changed locally and in cloud", async () => {
    const seeded = await syncProject("/project", fixture(), account);
    state.commands = [];
    const local = structuredClone(seeded.manifest);
    local.studio!.characters[0].name = "本地人物";
    const remote = state.project!;
    remote.document.characters[0].name = "云端人物";
    remote.revision++;
    remote.resourceRevisions.find(item => item.resourceType === "character")!.revision++;
    let conflict: SyncConflictError | null = null;
    try { await syncProject("/project", local, account); }
    catch (error) { if (error instanceof SyncConflictError) conflict = error; }
    expect(conflict).toBeInstanceOf(SyncConflictError);
    expect(conflict!.cloudRevision).toBe(2);
    expect(state.commands).toEqual([]);
    expect(local.studio!.characters[0].name).toBe("本地人物");
    expect(remote.document.characters[0].name).toBe("云端人物");
    const resolved = await syncProject("/project", local, account, {
      resourceType: conflict!.resourceType, resourceId: conflict!.resourceId,
      cloudRevision: conflict!.cloudRevision, choice: "cloud",
    });
    expect(resolved.manifest.studio!.characters[0].name).toBe("云端人物");
  });

  it("does not overwrite a newer cloud revision after the user selected an older conflict", async () => {
    const seeded = await syncProject("/project", fixture(), account);
    const local = structuredClone(seeded.manifest);
    local.studio!.characters[0].name = "本地人物";
    const remote = state.project!;
    remote.document.characters[0].name = "云端人物";
    remote.revision++;
    remote.resourceRevisions.find(item => item.resourceType === "character")!.revision++;
    await expect(syncProject("/project", local, account, {
      resourceType: "character", resourceId: "character-0001", cloudRevision: 1, choice: "local",
    })).rejects.toThrow("同步冲突");
    expect(remote.document.characters[0].name).toBe("云端人物");
  });

  it("creates the first cloud brief with the project and keeps it on local pull", async () => {
    const local = ensureStudio({ version: 2, id: "project-new-0001", title: "新项目", assets: [], clips: [], captions: [],
      publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null });
    const brief = { id: "brief-new-0001", source: "manual" as const, originalText: "🐶做饭", finalText: "🐶做饭",
      createdAt: 1, updatedAt: 1 };
    local.extensions = { ...local.extensions, creationBriefs: [brief] };
    const result = await syncProject("/project", local, account);
    expect(state.requests.find(item => item.path === "/projects" && item.method === "POST")?.body.initialBrief).toEqual(brief);
    expect(result.manifest.extensions?.creationBriefs).toEqual([brief]);
    expect(result.project.document.briefs).toEqual([brief]);
    expect(state.commands.filter(item => item.startsWith("brief:"))).toEqual([]);
  });

  it("replays the same cloud creation intent after the first response is lost", async () => {
    const local = ensureStudio({ version: 2, id: "project-replay-0001", title: "重试项目", assets: [], clips: [], captions: [],
      publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null });
    const brief = { id: "brief-replay-0001", source: "manual" as const, originalText: "原文", finalText: "原文",
      createdAt: 1, updatedAt: 1 };
    local.extensions = { ...local.extensions, creationBriefs: [brief] };
    state.failCreateResponse = true;
    await expect(syncProject("/project", local, account)).rejects.toThrow("网络断开");
    const recovered = await syncProject("/project", local, account);
    expect(state.requests.filter(item => item.path === "/projects" && item.method === "POST").map(item => item.body))
      .toEqual([expect.objectContaining({ id: local.id, initialBrief: brief })]);
    expect(state.requests.filter(item => item.path === `/projects/${local.id}` && item.method === "GET").length).toBeGreaterThanOrEqual(2);
    expect(recovered.project.document.briefs).toEqual([brief]);
    expect(recovered.manifest.extensions?.creationBriefs).toEqual([brief]);
  });

  it("pushes and pulls independent briefs without losing timeline and blocks same-brief concurrent edits", async () => {
    const local = fixture();
    const episode = local.studio!.episodes[0];
    episode.clips = [{ id: "clip-0001", assetId: "local-image", inMs: 0, outMs: 5000, volume: 1 }];
    state.project!.document.episodes[0].timeline = ["cloud-image"];
    state.project!.document.episodes[0].timelineClips = [{ id: "clip-0001", assetId: "cloud-image", inMs: 0, outMs: 5000, volume: 1 }];
    const seeded = await syncProject("/project", local, account);
    state.commands = [];
    const withBrief = structuredClone(seeded.manifest);
    const brief = { id: "brief-sync-0001", source: "manual" as const, originalText: "第一稿", finalText: "第一稿",
      createdAt: 10, updatedAt: 10 };
    withBrief.extensions = { ...withBrief.extensions, creationBriefs: [brief] };
    const pushed = await syncProject("/project", withBrief, account);
    expect(state.commands).toContain("brief:brief-sync-0001");
    expect(pushed.manifest.studio!.episodes[0].clips).toEqual(episode.clips);
    const independent = structuredClone(pushed.manifest);
    state.project!.document.briefs!.push({ ...brief, id: "brief-sync-0002", originalText: "云端新稿", finalText: "云端新稿" });
    state.project!.revision++;
    state.project!.resourceRevisions.push({ resourceType: "brief", resourceId: "brief-sync-0002", revision: 1 });
    const pulled = await syncProject("/project", independent, account);
    expect(pulled.manifest.extensions?.creationBriefs).toHaveLength(2);
    expect(pulled.manifest.studio!.episodes[0].clips).toEqual(episode.clips);
    const concurrent = structuredClone(pulled.manifest);
    concurrent.extensions!.creationBriefs = [{ ...brief, finalText: "本地修订", updatedAt: 20 },
      (concurrent.extensions!.creationBriefs as typeof brief[])[1]];
    state.project!.document.briefs![0] = { ...brief, finalText: "云端修订", updatedAt: 21 };
    state.project!.revision++;
    state.project!.resourceRevisions.find(item => item.resourceType === "brief" && item.resourceId === brief.id)!.revision++;
    await expect(syncProject("/project", concurrent, account)).rejects.toMatchObject({
      resourceType: "brief", resourceId: brief.id, localRevision: 1, cloudRevision: 2,
    });
    expect(state.project!.document.briefs![0].finalText).toBe("云端修订");
  });

  it("uploads every local brief before preparing a cloud reference for a video plan", async () => {
    const local = fixture();
    const briefs = ["brief-reference-0001", "brief-reference-0002"].map((id, index) => ({
      id, source: "manual" as const, originalText: `原文 ${index}`, finalText: `原文 ${index}`,
      createdAt: 1, updatedAt: 1,
    }));
    local.extensions = { ...local.extensions, creationBriefs: briefs };
    const result = await ensureCloudReference("/project", local, account, "local-image");
    expect(state.commands.filter(item => item.startsWith("brief:"))).toEqual(briefs.map(item => `brief:${item.id}`));
    expect(state.project!.document.briefs).toEqual(briefs);
    expect(result.cloudAssetId).toBe("cloud-image");
  });
});
