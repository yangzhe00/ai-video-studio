import type { FeaturePlugin } from "@ai-video/plugin-sdk";

export const exportPlugin: FeaturePlugin = {
  id: "export",
  version: "1.0.0",
  supportedPlatforms: ["desktop"],
  requires: ["timeline"],
  contributes: { panels: ["export"] },
};
