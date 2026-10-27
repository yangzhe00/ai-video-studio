import type { FeaturePlugin } from "@ai-video/plugin-sdk";

export const mediaPlugin: FeaturePlugin = {
  id: "media",
  version: "1.0.0",
  supportedPlatforms: ["desktop"],
  contributes: { panels: ["media"] },
};
