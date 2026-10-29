import type { FeaturePlugin } from "@ai-video/plugin-sdk";

export const generationPlugin: FeaturePlugin = {
  id: "generation",
  version: "1.0.0",
  supportedPlatforms: ["desktop"],
  requires: ["storyboard"],
  contributes: { panels: ["generation"] },
};
