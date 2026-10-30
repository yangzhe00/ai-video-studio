import { describe, expect, it } from "vitest";
import { errorCodeForStatus, makeApiError, parseApiError, parseApiRequest, parseApiResponse, requestSchema } from "./index.ts";

describe("shared API contracts", () => {
  it("validates registered JSON requests before a side effect", () => {
    const body = { clientRequestId: "idea-request-001", input: "小狗做饭" };
    expect(parseApiRequest("POST", "/prompt-ideas", body)).toEqual(body);
    expect(() => parseApiRequest("POST", "/prompt-ideas", { ...body, input: " " })).toThrow();
    expect(() => parseApiRequest("POST", "/projects/project-001/runs", { clientRequestId: "run-0001" })).toThrow();
    const run = { clientRequestId: "run-0001", episodeId: "episode-001", sourceAssetId: "asset-001",
      input: "小狗做饭", durationSec: 5 };
    expect(parseApiRequest("POST", "/projects/project-001/runs", run)).toMatchObject(run);
    expect(() => parseApiRequest("POST", "/projects/project-001/runs", { ...run, durationSec: 10 })).toThrow();
    expect(() => parseApiRequest("POST", "/projects/project-001/commands", { id: "command-001", resourceType: "episode",
      resourceId: "episode-001", baseRevision: -1, payload: {} })).toThrow();
    expect(requestSchema("POST", "/objects")).toBeUndefined();
    expect(requestSchema("GET", "/runs/run-0001/events")).toBeUndefined();
  });

  it("parses project and run envelopes without losing stable IDs", () => {
    const project = { id: "project-001", title: "项目", revision: 1, document: {
      version: 1, assets: [], characters: [], episodes: [{ id: "episode-001", title: "第一集", shots: [], timeline: [] }],
    }, resourceRevisions: [] };
    expect(parseApiResponse<{ project: typeof project }>({ project }).project.id).toBe("project-001");
    const run = { runId: "run-0001", projectId: "project-001", episodeId: "episode-001", sourceAssetId: "asset-001",
      input: "小狗做饭", durationSec: 5, state: "waiting_approval", planHash: "hash", plan: { steps: [{ prompt: "小狗做饭", durationSec: 5 }] }, operation: null };
    expect(parseApiResponse<{ run: typeof run }>({ run }).run.runId).toBe("run-0001");
    expect(() => parseApiResponse({ run: { runId: "run-0001" } })).toThrow();
  });

  it("accepts legacy errors and preserves conflict snapshots", () => {
    expect(parseApiError({ error: "请先登录" }, 401)).toMatchObject({ error: "请先登录", code: "unauthorized" });
    const conflict = { project: { id: "project-001" } };
    expect(parseApiError(makeApiError(409, "修订冲突", conflict), 409)).toMatchObject({ code: "conflict", conflict });
    expect(errorCodeForStatus(503)).toBe("service_unavailable");
  });

  it("protects an unsupported DSL version on the read-only route", () => {
    expect(() => parseApiResponse({ readOnly: true, project: {
      id: "project-001", title: "项目", revision: 1, resourceRevisions: [],
      document: { schema: "ai-video/project", dslVersion: 2 },
    } })).toThrow();
  });

  it("pins voice, TTS, episode render and agent edit request boundaries", () => {
    const voice = { assetId: "voice-asset-001", startMs: 0, inMs: 0, outMs: 1000, volume: 1 };
    expect(parseApiRequest("POST", "/video-edits/edit-0001/commands", { commandId: "command-001", expectedRevision: 1,
      command: { type: "set-audio-mix", originalVolume: 0.5, voiceClips: [voice], musicClips: [] } }).command).toMatchObject({ type: "set-audio-mix" });
    expect(() => parseApiRequest("POST", "/video-edits/edit-0001/commands", { commandId: "command-001", expectedRevision: 1,
      command: { type: "set-audio-mix", originalVolume: 3, voiceClips: [voice], musicClips: [] } })).toThrow();
    expect(() => parseApiRequest("POST", "/video-edits/edit-0001/commands", { commandId: "command-001", expectedRevision: 1,
      command: { type: "set-audio-mix", originalVolume: 1, voiceClips: [{ ...voice, outMs: 0 }], musicClips: [] } })).toThrow();
    const tts = { clientRequestId: "tts-request-001", text: "你好", voiceId: "oversea_male1", voiceLanguage: "en", speed: 1,
      estimateId: "estimate-001", confirmed: true };
    expect(parseApiRequest("POST", "/projects/project-001/tts/tasks", tts)).toMatchObject(tts);
    expect(() => parseApiRequest("POST", "/projects/project-001/tts/tasks", { ...tts, confirmed: false })).toThrow();
    expect(parseApiRequest("POST", "/projects/project-001/episodes/episode-001/render", {
      renderOperationId: "episode-render-001", expectedEpisodeRevision: 2 })).toMatchObject({ expectedEpisodeRevision: 2 });
    expect(parseApiRequest("POST", "/projects/project-001/agent-edits", {
      clientRequestId: "agent-edit-001", episodeId: "episode-001", instruction: "建议调整节奏" })).toMatchObject({ episodeId: "episode-001" });
    expect(() => parseApiRequest("POST", "/agent-edits/edit-set-001/confirm", {
      clientRequestId: "confirm-001", expectedRevision: 1, acceptedActionIds: [] })).toThrow();
  });

  it("parses new task envelopes and rejects unknown Agent actions", () => {
    const base = { id: "task-001", projectId: "project-001", clientRequestId: "request-001",
      voiceAssetId: null, providerTaskId: null, costStatus: "unbilled", error: null, createdAt: 1, updatedAt: 1 };
    expect(parseApiResponse<{ ttsTask: unknown }>({ ttsTask: { ...base, state: "pending" } })).toHaveProperty("ttsTask");
    expect(() => parseApiResponse({ ttsTask: { ...base, state: "unrecognized" } })).toThrow();
    const context = { episode: { revision: 2, shotIds: ["shot-001"] },
      edits: [{ id: "edit-001", shotId: "shot-001", revision: 1, trimStartMs: 0,
        trimEndMs: 5000, captions: [], voiceClips: [] }] };
    const set = { id: "set-001", projectId: "project-001", episodeId: "episode-001", clientRequestId: "request-001",
      revision: 1, state: "ready", error: null, createdAt: 1, updatedAt: 1,
      confirmedActionIds: [], context, actions: [] };
    expect(parseApiResponse<{ agentEdit: typeof set }>({ agentEdit: set }).agentEdit.context).toEqual(context);
    expect(() => parseApiResponse({ agentEdit: { ...set, context: { ...context,
      edits: [{ ...context.edits[0], trimStartMs: -1 }] } } })).toThrow();
    expect(() => parseApiResponse({ agentEdit: { ...set, actions: [{ id: "action-001", type: "run-shell", reason: "bad" }] } })).toThrow();
  });
});
