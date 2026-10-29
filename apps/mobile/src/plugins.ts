import { resolvePlugins } from "@ai-video/plugin-sdk";
import { videoEditPlugin } from "@ai-video/plugin-video-edit";

export const mobilePlugins = resolvePlugins("mobile", ["video-edit"], [videoEditPlugin]);
