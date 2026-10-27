import type { FeaturePlugin } from "@ai-video/plugin-sdk";

export const storyboardPlugin: FeaturePlugin = {
  id: "storyboard",
  version: "1.0.0",
  supportedPlatforms: ["desktop"],
  requires: ["media"],
  contributes: { panels: ["shot-drafts"] },
};
