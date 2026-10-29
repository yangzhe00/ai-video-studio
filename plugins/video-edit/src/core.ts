export interface VideoCaption { id: string; startMs: number; endMs: number; text: string }
export interface VideoEditRecipeV1 {
  version: 1; id: string; projectId: string; episodeId: string; shotId: string; sourceAssetId: string;
  sourceDurationMs: number; trimStartMs: number; trimEndMs: number; captions: VideoCaption[];
  coverSourceMs: number; revision: number;
}
export type VideoEditCommand =
  | { type: "set-trim"; startMs: number; endMs: number }
  | { type: "upsert-caption"; caption: VideoCaption }
  | { type: "remove-caption"; captionId: string }
  | { type: "set-cover"; sourceMs: number };
export interface VideoEditIssue { code: "caption-outside-trim"; captionId: string }

function assertTime(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name}无效`);
}

export function validateRecipe(recipe: VideoEditRecipeV1): VideoEditIssue[] {
  if (recipe.version !== 1 || !recipe.id || !recipe.sourceAssetId || !Number.isSafeInteger(recipe.sourceDurationMs) || recipe.sourceDurationMs <= 0) throw new Error("视频配方无效");
  assertTime(recipe.trimStartMs, "起点"); assertTime(recipe.trimEndMs, "终点"); assertTime(recipe.coverSourceMs, "封面时间");
  if (recipe.trimStartMs >= recipe.trimEndMs || recipe.trimEndMs > recipe.sourceDurationMs) throw new Error("裁剪时间超出原视频");
  if (recipe.coverSourceMs < recipe.trimStartMs || recipe.coverSourceMs >= recipe.trimEndMs) throw new Error("封面时间必须位于保留片段内");
  const issues: VideoEditIssue[] = [];
  for (const caption of recipe.captions) {
    assertTime(caption.startMs, "字幕起点"); assertTime(caption.endMs, "字幕终点");
    if (!caption.id || !caption.text.trim() || caption.startMs >= caption.endMs || caption.endMs > recipe.sourceDurationMs) throw new Error("字幕内容或时间无效");
    if (caption.startMs < recipe.trimStartMs || caption.endMs > recipe.trimEndMs) issues.push({ code: "caption-outside-trim", captionId: caption.id });
  }
  return issues;
}

export function createRecipe(input: Omit<VideoEditRecipeV1, "version" | "revision" | "trimStartMs" | "trimEndMs" | "captions" | "coverSourceMs">): VideoEditRecipeV1 {
  const recipe: VideoEditRecipeV1 = { ...input, version: 1, revision: 1, trimStartMs: 0, trimEndMs: input.sourceDurationMs, captions: [], coverSourceMs: 0 };
  validateRecipe(recipe);
  return recipe;
}

export function applyVideoEdit(recipe: VideoEditRecipeV1, command: VideoEditCommand, expectedRevision: number): { recipe: VideoEditRecipeV1; issues: VideoEditIssue[] } {
  if (recipe.revision !== expectedRevision) throw new Error("视频配方版本冲突");
  let next: VideoEditRecipeV1;
  switch (command.type) {
    case "set-trim": next = { ...recipe, trimStartMs: command.startMs, trimEndMs: command.endMs }; break;
    case "set-cover": next = { ...recipe, coverSourceMs: command.sourceMs }; break;
    case "upsert-caption": next = { ...recipe, captions: recipe.captions.some(item => item.id === command.caption.id)
      ? recipe.captions.map(item => item.id === command.caption.id ? command.caption : item) : [...recipe.captions, command.caption] }; break;
    case "remove-caption": next = { ...recipe, captions: recipe.captions.filter(item => item.id !== command.captionId) }; break;
    default: throw new Error("不支持的视频编辑命令");
  }
  const issues = validateRecipe(next);
  return { recipe: { ...next, revision: expectedRevision + 1 }, issues };
}
