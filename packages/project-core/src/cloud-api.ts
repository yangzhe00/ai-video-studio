import type { CloudProjectDocument, SyncResourceRevision } from "./sync";

/** Common response contracts used by desktop, web, and mobile transport adapters. */
export interface CloudAccountSnapshot {
  id: string;
  email: string;
  demo_quota: number;
  demo_reserved: number;
  demo_used: number;
}

export interface CloudProjectSnapshot {
  id: string;
  title: string;
  revision: number;
  document: CloudProjectDocument;
  resourceRevisions: SyncResourceRevision[];
}

export interface CloudRunSnapshot {
  runId: string;
  projectId: string;
  episodeId: string;
  sourceAssetId: string;
  input: string;
  durationSec: 5 | 10;
  state: string;
  planHash: string;
  plan: { steps: { prompt: string; durationSec: number }[]; planner: string };
  operation: { id: string; state: string } | null;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export function parseCloudProjectSnapshot(value: unknown): CloudProjectSnapshot {
  if (!record(value) || !text(value.id) || !text(value.title) || !Number.isSafeInteger(value.revision) || !record(value.document)) {
    throw new Error("云端项目响应格式无效");
  }
  const document = value.document;
  if (document.version !== 1 || !Array.isArray(document.assets) || !Array.isArray(document.characters) ||
      !Array.isArray(document.episodes) || !Array.isArray(value.resourceRevisions)) throw new Error("云端项目内容不完整");
  for (const episode of document.episodes) {
    if (!record(episode) || !text(episode.id) || typeof episode.title !== "string" ||
        !Array.isArray(episode.shots) || !Array.isArray(episode.timeline)) throw new Error("云端分集格式无效");
    const timeline = episode.timeline;
    if (episode.timelineClips !== undefined && (!Array.isArray(episode.timelineClips) ||
        episode.timelineClips.length !== timeline.length ||
        episode.timelineClips.some((clip, index) => !record(clip) || !text(clip.id) || clip.assetId !== timeline[index] ||
          !Number.isSafeInteger(clip.inMs) || !Number.isSafeInteger(clip.outMs) || typeof clip.volume !== "number"))) {
      throw new Error("云端时间线片段不一致");
    }
  }
  return value as unknown as CloudProjectSnapshot;
}

export function parseCloudRunSnapshot(value: unknown): CloudRunSnapshot {
  if (!record(value) || !text(value.runId) || !text(value.projectId) || !text(value.episodeId) ||
      !text(value.sourceAssetId) || typeof value.input !== "string" || ![5, 10].includes(value.durationSec as number) ||
      !text(value.state) || !text(value.planHash) || !record(value.plan) || !Array.isArray(value.plan.steps) ||
      !value.plan.steps.every(step => record(step) && typeof step.prompt === "string" && [5, 10].includes(step.durationSec as number))) {
    throw new Error("云端任务响应格式无效");
  }
  return value as unknown as CloudRunSnapshot;
}

export function parseCloudEnvelope<T>(payload: T): T {
  if (!record(payload)) return payload;
  if ("project" in payload) return { ...payload, project: parseCloudProjectSnapshot(payload.project) } as T;
  if ("run" in payload) return { ...payload, run: parseCloudRunSnapshot(payload.run) } as T;
  if (Array.isArray(payload.runs)) return { ...payload, runs: payload.runs.map(parseCloudRunSnapshot) } as T;
  return payload;
}
