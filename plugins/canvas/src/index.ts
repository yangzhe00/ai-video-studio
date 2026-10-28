import type { FeaturePlugin } from "@ai-video/plugin-sdk";

export const canvasPlugin: FeaturePlugin = {
  id: "canvas",
  version: "0.1.0",
  supportedPlatforms: ["desktop", "web"],
  contributes: {
    panels: [],
    routes: ["canvas"],
    capabilities: ["graph.edit", "graph.run-node"],
    nodeTypes: ["text", "image", "video", "audio", "timeline", "subject"],
  },
};
