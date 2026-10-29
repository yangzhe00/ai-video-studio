import { z } from "zod";
import type { AssetV1 } from "./assets.ts";
import type { TimelineClipV1, TimelineTrackV1 } from "./clips.ts";
import { VideoProjectShapeSchema } from "./foundation.ts";
import type { VideoProjectV1 } from "./foundation.ts";

type Path = (string | number)[];

const clipDuration = (clip: TimelineClipV1): number =>
  clip.kind === "image" || clip.kind === "subtitle" ? clip.durationMs : clip.outMs - clip.inMs;

const trackAllows = (track: TimelineTrackV1, clip: TimelineClipV1): boolean =>
  track.kind === "visual" ? clip.kind === "video" || clip.kind === "image" : track.kind === clip.kind;

/** The public schema checks shape and project-wide invariants in one safeParse call. */
export const VideoProjectSchema = VideoProjectShapeSchema.superRefine((project, context) => {
  const add = (path: Path, code: string, message: string) =>
    context.addIssue({ code: z.ZodIssueCode.custom, path, message, params: { dslCode: code } });
  const seenIds = new Map<string, Path>();
  const unique = (id: string, path: Path) => {
    const previous = seenIds.get(id);
    if (previous) add(path, "duplicate_id", `ID ${id} 已在 ${formatPath(previous)} 使用`);
    else seenIds.set(id, path);
  };

  unique(project.projectId, ["projectId"]);
  const assets = new Map<string, AssetV1>();
  project.assets.items.forEach((asset, index) => {
    unique(asset.id, ["assets", "items", index, "id"]);
    assets.set(asset.id, asset);
  });
  const requireAsset = (id: string, kinds: AssetV1["kind"][], path: Path): AssetV1 | undefined => {
    const asset = assets.get(id);
    if (!asset) add(path, "missing_asset", `资产 ${id} 不存在`);
    else if (!kinds.includes(asset.kind)) add(path, "wrong_asset_kind", `资产 ${id} 的类型 ${asset.kind} 不适用`);
    return asset;
  };

  project.characters.forEach((character, index) => {
    unique(character.id, ["characters", index, "id"]);
    requireAsset(character.referenceAssetId, ["image"], ["characters", index, "referenceAssetId"]);
  });

  project.episodes.forEach((episode, episodeIndex) => {
    const root: Path = ["episodes", episodeIndex];
    unique(episode.id, [...root, "id"]);
    episode.scenes.forEach((scene, sceneIndex) => {
      const scenePath: Path = [...root, "scenes", sceneIndex];
      unique(scene.id, [...scenePath, "id"]);
      requireAsset(scene.sourceAssetId, ["image"], [...scenePath, "sourceAssetId"]);
      const outputs = new Set<string>();
      scene.outputAssetIds.forEach((id, outputIndex) => {
        if (outputs.has(id)) add([...scenePath, "outputAssetIds", outputIndex], "duplicate_output", `视频版本 ${id} 重复`);
        outputs.add(id);
        requireAsset(id, ["video"], [...scenePath, "outputAssetIds", outputIndex]);
      });
      if (scene.selectedAssetId !== null && !outputs.has(scene.selectedAssetId)) {
        add([...scenePath, "selectedAssetId"], "unlisted_selection", "当前预览版本不在场景输出列表中");
      }
      if (new Set(scene.runIds).size !== scene.runIds.length) {
        add([...scenePath, "runIds"], "duplicate_run", "场景运行 ID 重复");
      }
    });

    episode.tracks.forEach((track, trackIndex) => {
      const trackPath: Path = [...root, "tracks", trackIndex];
      unique(track.id, [...trackPath, "id"]);
      const visualIntervals: { start: number; end: number; index: number }[] = [];
      track.clips.forEach((clip, clipIndex) => {
        const clipPath: Path = [...trackPath, "clips", clipIndex];
        unique(clip.id, [...clipPath, "id"]);
        if (!trackAllows(track, clip)) add([...clipPath, "kind"], "wrong_track_kind", "片段类型与轨道不匹配");
        requireAsset(clip.assetId, [clip.kind], [...clipPath, "assetId"]);
        const duration = clipDuration(clip);
        if ("inMs" in clip && clip.outMs <= clip.inMs) {
          add([...clipPath, "outMs"], "invalid_trim", "结束时间必须大于开始时间");
        }
        const asset = assets.get(clip.assetId);
        if ("outMs" in clip && asset && "durationMs" in asset && asset.durationMs !== null && clip.outMs > asset.durationMs) {
          add([...clipPath, "outMs"], "outside_asset", "片段结束时间超过资产时长");
        }
        if (!Number.isSafeInteger(clip.startMs + duration) || duration <= 0) {
          add([...clipPath, "startMs"], "invalid_timeline_range", "时间线位置或时长无效");
        } else if (track.kind === "visual") {
          visualIntervals.push({ start: clip.startMs, end: clip.startMs + duration, index: clipIndex });
        }
      });
      visualIntervals.sort((a, b) => a.start - b.start || a.index - b.index);
      for (let index = 1; index < visualIntervals.length; index++) {
        if (visualIntervals[index].start < visualIntervals[index - 1].end) {
          add([...trackPath, "clips", visualIntervals[index].index, "startMs"], "visual_overlap", "同一视觉轨的片段不能重叠");
        }
      }
    });

    if (episode.cover) {
      const asset = requireAsset(episode.cover.assetId, ["image", "thumbnail", "video"], [...root, "cover", "assetId"]);
      if (asset?.kind === "image" || asset?.kind === "thumbnail") {
        if (episode.cover.sourceTimeMs !== 0) add([...root, "cover", "sourceTimeMs"], "invalid_cover_time", "静态图片的封面时间必须为 0");
      } else if (asset?.kind === "video" && asset.durationMs !== null && episode.cover.sourceTimeMs >= asset.durationMs) {
        add([...root, "cover", "sourceTimeMs"], "invalid_cover_time", "封面时间超过视频时长");
      }
    }
  });

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const walk = (id: string, path: Path): void => {
    if (visiting.has(id)) { add(path, "provenance_cycle", `资产 ${id} 的来源形成循环`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const [index, sourceId] of (assets.get(id)?.provenance?.sourceAssetIds ?? []).entries()) {
      const sourcePath = [...path, "provenance", "sourceAssetIds", index];
      if (!assets.has(sourceId)) add(sourcePath, "missing_asset", `来源资产 ${sourceId} 不存在`);
      else walk(sourceId, sourcePath);
    }
    visiting.delete(id);
    visited.add(id);
  };
  project.assets.items.forEach((asset, index) => walk(asset.id, ["assets", "items", index]));
});

export interface DslIssue {
  path: string;
  code: string;
  message: string;
  severity: "error" | "warning";
}

function formatPath(path: Path): string {
  return "$" + path.map(segment => typeof segment === "number" ? `[${segment}]` : `.${segment}`).join("");
}

function issuesOf(error: z.ZodError): DslIssue[] {
  return error.issues.map(issue => ({
    path: formatPath(issue.path),
    code: issue.code === "custom" && typeof issue.params?.dslCode === "string" ? issue.params.dslCode : issue.code,
    message: issue.message,
    severity: "error",
  }));
}

export function parseProjectDsl(raw: unknown):
  | { ok: true; project: VideoProjectV1 }
  | { ok: false; issues: DslIssue[] } {
  if (raw && typeof raw === "object" && "dslVersion" in raw && (raw as { dslVersion: unknown }).dslVersion !== 1) {
    return { ok: false, issues: [{ path: "$.dslVersion", code: "unsupported_version", message: "项目 DSL 版本需要更新客户端", severity: "error" }] };
  }
  const result = VideoProjectSchema.safeParse(raw);
  return result.success ? { ok: true, project: result.data } : { ok: false, issues: issuesOf(result.error) };
}

export function validateProjectDsl(raw: unknown): DslIssue[] {
  const result = parseProjectDsl(raw);
  return result.ok ? [] : result.issues;
}
