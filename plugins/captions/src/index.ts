import type { FeaturePlugin } from "@ai-video/plugin-sdk";

export const captionsPlugin: FeaturePlugin = {
  id: "captions",
  version: "1.0.0",
  supportedPlatforms: ["desktop"],
  requires: ["timeline"],
  contributes: { panels: ["captions"] },
};
