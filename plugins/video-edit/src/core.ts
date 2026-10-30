export interface VideoCaption { id: string; startMs: number; endMs: number; text: string }
export interface VideoEditRecipeV1 {
  version: 1; id: string; projectId: string; episodeId: string; shotId: string; sourceAssetId: string;
  sourceDurationMs: number; trimStartMs: number; trimEndMs: number; captions: VideoCaption[];
  coverSourceMs: number; revision: number;
}
export interface AudioPlacement {
  assetId: string; startMs: number; inMs: number; outMs: number; volume: number;
}
export interface VideoEditRecipeV2 extends Omit<VideoEditRecipeV1, "version"> {
  version: 2;
  audioMix: { originalVolume: number; voiceClips: AudioPlacement[]; musicClips: AudioPlacement[] };
}
export type VideoEditRecipe = VideoEditRecipeV1 | VideoEditRecipeV2;
export type VideoEditCommand =
  | { type: "set-trim"; startMs: number; endMs: number }
  | { type: "upsert-caption"; caption: VideoCaption }
  | { type: "remove-caption"; captionId: string }
  | { type: "set-cover"; sourceMs: number }
  | { type: "set-audio-mix"; originalVolume: number; voiceClips: AudioPlacement[]; musicClips: AudioPlacement[] };
export interface VideoEditIssue { code: "caption-outside-trim" | "audio-outside-trim"; captionId?: string; assetId?: string }

function assertTime(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name}无效`);
}

function assertVolume(value: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) throw new Error("音量无效");
}

export function validateRecipe(recipe: VideoEditRecipe): VideoEditIssue[] {
  if (![1, 2].includes(recipe.version) || !recipe.id || !recipe.sourceAssetId || !Number.isSafeInteger(recipe.sourceDurationMs) || recipe.sourceDurationMs <= 0) throw new Error("视频配方无效");
  assertTime(recipe.trimStartMs, "起点"); assertTime(recipe.trimEndMs, "终点"); assertTime(recipe.coverSourceMs, "封面时间");
  if (recipe.trimStartMs >= recipe.trimEndMs || recipe.trimEndMs > recipe.sourceDurationMs) throw new Error("裁剪时间超出原视频");
  if (recipe.coverSourceMs < recipe.trimStartMs || recipe.coverSourceMs >= recipe.trimEndMs) throw new Error("封面时间必须位于保留片段内");
  const issues: VideoEditIssue[] = [];
  for (const caption of recipe.captions) {
    assertTime(caption.startMs, "字幕起点"); assertTime(caption.endMs, "字幕终点");
    if (!caption.id || !caption.text.trim() || caption.startMs >= caption.endMs || caption.endMs > recipe.sourceDurationMs) throw new Error("字幕内容或时间无效");
    if (caption.startMs < recipe.trimStartMs || caption.endMs > recipe.trimEndMs) issues.push({ code: "caption-outside-trim", captionId: caption.id });
  }
  if (recipe.version === 2) {
    if (!recipe.audioMix || !Array.isArray(recipe.audioMix.voiceClips) || !Array.isArray(recipe.audioMix.musicClips)) throw new Error("音频配方无效");
    assertVolume(recipe.audioMix.originalVolume);
    if (recipe.audioMix.voiceClips.length > 16 || recipe.audioMix.musicClips.length > 16) throw new Error("音频片段过多");
    for (const clip of [...recipe.audioMix.voiceClips, ...recipe.audioMix.musicClips]) {
      if (!clip.assetId || typeof clip.assetId !== "string") throw new Error("音频素材 ID 无效");
      assertTime(clip.startMs, "音频起点"); assertTime(clip.inMs, "音频入点"); assertTime(clip.outMs, "音频出点");
      assertVolume(clip.volume);
      if (clip.outMs <= clip.inMs) throw new Error("音频片段时长无效");
      if (clip.startMs >= recipe.trimEndMs - recipe.trimStartMs || clip.startMs + clip.outMs - clip.inMs > recipe.trimEndMs - recipe.trimStartMs) {
        issues.push({ code: "audio-outside-trim", assetId: clip.assetId });
      }
    }
  }
  return issues;
}

export function createRecipe(input: Omit<VideoEditRecipeV1, "version" | "revision" | "trimStartMs" | "trimEndMs" | "captions" | "coverSourceMs">): VideoEditRecipeV1 {
  const recipe: VideoEditRecipeV1 = { ...input, version: 1, revision: 1, trimStartMs: 0, trimEndMs: input.sourceDurationMs, captions: [], coverSourceMs: 0 };
  validateRecipe(recipe);
  return recipe;
}

export function applyVideoEdit(recipe: VideoEditRecipe, command: VideoEditCommand, expectedRevision: number): { recipe: VideoEditRecipe; issues: VideoEditIssue[] } {
  if (recipe.revision !== expectedRevision) throw new Error("视频配方版本冲突");
  let next: VideoEditRecipe;
  switch (command.type) {
    case "set-trim": next = { ...recipe, trimStartMs: command.startMs, trimEndMs: command.endMs }; break;
    case "set-cover": next = { ...recipe, coverSourceMs: command.sourceMs }; break;
    case "upsert-caption": next = { ...recipe, captions: recipe.captions.some(item => item.id === command.caption.id)
      ? recipe.captions.map(item => item.id === command.caption.id ? command.caption : item) : [...recipe.captions, command.caption] }; break;
    case "remove-caption": next = { ...recipe, captions: recipe.captions.filter(item => item.id !== command.captionId) }; break;
    case "set-audio-mix": next = { ...recipe, version: 2, audioMix: {
      originalVolume: command.originalVolume, voiceClips: command.voiceClips, musicClips: command.musicClips,
    } }; break;
    default: throw new Error("不支持的视频编辑命令");
  }
  const issues = validateRecipe(next);
  return { recipe: { ...next, revision: expectedRevision + 1 }, issues };
}
