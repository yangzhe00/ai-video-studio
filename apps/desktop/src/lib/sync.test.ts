import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureStudio, readCanvasDocument } from "@ai-video/project-core";
import type { ProjectManifestV2 } from "@ai-video/project-core";
import { SyncConflictError, syncProject } from "./sync";
import type { CloudProject } from "./cloud";

const state = vi.hoisted(() => ({ project: null as CloudProject | null, commands: [] as string[] }));
vi.mock("./native", () => ({ saveProject: vi.fn(async () => {}) }));
vi.mock("./cloud", () => ({
  cloudRequest: vi.fn(async () => ({ project: structuredClone(state.project) })),
  cloudUploadAsset: vi.fn(async () => { throw new Error("不应上传已关联素材"); }),
  cloudDownloadAsset: vi.fn(async () => { throw new Error("不应下载已存在素材"); }),
  cloudCommand: vi.fn(async (_project: CloudProject, type: string, id: string, payload: unknown) => {
    const next = structuredClone(state.project!);
    state.commands.push(`${type}:${id}`);
    if (type === "canvas") {
      const canvas = next.document.extensions?.canvas as { version: 1; episodeGraphs: Record<string, unknown> };
      canvas.episodeGraphs[id] = payload;
    } else {
      const field = type === "episode" ? "episodes" : type === "asset" ? "assets" : "characters";
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

beforeEach(() => { state.project = null; state.commands = []; });

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
});
