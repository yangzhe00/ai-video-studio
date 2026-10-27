import type { FeaturePlugin } from "@ai-video/plugin-sdk";

export const publishingPlugin: FeaturePlugin = {
  id: "publishing",
  version: "1.0.0",
  supportedPlatforms: ["desktop"],
  contributes: { panels: ["publishing"] },
};
