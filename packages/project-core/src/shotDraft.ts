import type { ShotDraft } from "./ai";

export const DOG_CHEF_PRESET = {
  prompt: "保持照片中狗的可辨认外貌，让它穿厨师服在厨房洗菜做饭。说话时切换为厨房内正面镜头。",
  script: "妈妈要下班了，我在家做饭给她吃",
};

export function createShotDraft(sourceAssetId: string, prompt: string, durationSec = 5, script?: string): ShotDraft {
  const cleanPrompt = prompt.trim();
  const cleanScript = script?.trim() || null;
  if (!sourceAssetId) throw new Error("请先选择人物或动物照片");
  if (!cleanPrompt) throw new Error("请输入场景和动作提示词");
  if (!Number.isInteger(durationSec) || durationSec < 4 || durationSec > 12) throw new Error("镜头时长必须为 4 到 12 秒");
  return {
    id: crypto.randomUUID(), sourceAssetId, prompt: cleanPrompt, durationSec,
    speaking: cleanScript !== null, script: cleanScript, acceptedAudioAssetId: null,
    modelId: cleanScript ? "kling-ai-avatar-v2-standard" : "seedance-15-pro",
  };
}
