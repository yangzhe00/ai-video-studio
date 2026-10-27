import type { FeaturePlugin } from "@ai-video/plugin-sdk";

export const timelinePlugin: FeaturePlugin = {
  id: "timeline",
  version: "1.0.0",
  supportedPlatforms: ["desktop"],
  requires: ["media"],
  contributes: { panels: ["timeline"] },
};
