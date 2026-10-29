import { VideoProjectSchema } from "./validate.ts";
import type { VideoProjectV1 } from "./foundation.ts";

/** Create the smallest valid one-episode project without platform storage details. */
export function createVideoProject(input: { projectId: string; title: string; initialEpisodeId: string }): VideoProjectV1 {
  return VideoProjectSchema.parse({
    schema: "ai-video/project", dslVersion: 1, projectId: input.projectId,
    metadata: { title: input.title },
    canvasConfig: { width: 1080, height: 1920 }, renderConfig: { fps: 30, format: "mp4" },
    characters: [],
    episodes: [{ id: input.initialEpisodeId, title: "第 1 集", scenes: [],
      tracks: [{ id: `track:visual:${input.initialEpisodeId}`, kind: "visual", clips: [] }],
      publishingCopy: "", cover: null }],
    assets: { items: [] },
  });
}
