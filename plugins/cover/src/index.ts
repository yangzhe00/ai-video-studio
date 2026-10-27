import type { FeaturePlugin } from "@ai-video/plugin-sdk";

export const coverPlugin: FeaturePlugin = {
  id: "cover",
  version: "1.0.0",
  supportedPlatforms: ["desktop"],
  requires: ["timeline"],
  contributes: { panels: ["cover"] },
};
