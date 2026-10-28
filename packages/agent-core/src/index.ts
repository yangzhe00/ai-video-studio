export type RunState = "waiting_approval" | "pending_submit" | "provider_queued" | "running" | "downloading" | "saved" | "failed" | "unknown";

export interface ImageVideoIntent {
  clientRequestId: string;
  episodeId: string;
  sourceAssetId: string;
  input: string;
  durationSec: 5 | 10;
}

export interface AgentPlan {
  version: 1;
  planner: "validated-input";
  steps: [{ id: "generate-video"; tool: "image-video"; sourceAssetId: string; episodeId: string; prompt: string; durationSec: 5 | 10; demoCredits: 1 }];
  requiresApproval: true;
}

export interface RunEvent {
  runId: string;
  seq: number;
  state: RunState;
  message: string;
  createdAt: number;
  result?: { assetId?: string; shotId?: string };
}

export function planImageVideo(intent: ImageVideoIntent): AgentPlan {
  const prompt = intent.input.trim();
  if (!prompt || prompt.length > 2000) throw new Error("请输入 1 到 2000 字的镜头需求");
  if (intent.durationSec !== 5 && intent.durationSec !== 10) throw new Error("镜头时长只支持 5 或 10 秒");
  if (!intent.episodeId || !intent.sourceAssetId) throw new Error("请选择分集和参考照片");
  return { version: 1, planner: "validated-input", steps: [{
    id: "generate-video", tool: "image-video", sourceAssetId: intent.sourceAssetId,
    episodeId: intent.episodeId, prompt, durationSec: intent.durationSec, demoCredits: 1,
  }], requiresApproval: true };
}
