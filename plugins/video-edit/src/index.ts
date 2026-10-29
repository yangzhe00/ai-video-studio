import type { FeaturePlugin } from "@ai-video/plugin-sdk";

export const videoEditPlugin: FeaturePlugin = {
  id: "video-edit", version: "0.1.0", supportedPlatforms: ["desktop", "web", "mobile"],
  contributes: { panels: [], routes: ["video-edit"], capabilities: ["video.trim-time", "video.caption-manual", "video.cover-frame", "video.render-cloud"] },
};
