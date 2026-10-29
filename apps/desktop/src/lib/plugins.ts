import { resolvePlugins } from "@ai-video/plugin-sdk";
import { mediaPlugin } from "@ai-video/plugin-media";
import { timelinePlugin } from "@ai-video/plugin-timeline";
import { captionsPlugin } from "@ai-video/plugin-captions";
import { storyboardPlugin } from "@ai-video/plugin-storyboard";
import { generationPlugin } from "@ai-video/plugin-generation";
import { exportPlugin } from "@ai-video/plugin-export";
import { coverPlugin } from "@ai-video/plugin-cover";
import { publishingPlugin } from "@ai-video/plugin-publishing";
import { canvasPlugin } from "@ai-video/plugin-canvas";
import { videoEditPlugin } from "@ai-video/plugin-video-edit";

export const desktopPlugins = resolvePlugins(
  "desktop",
  ["media", "timeline", "captions", "storyboard", "generation", "canvas", "video-edit", "cover", "publishing", "export"],
  [mediaPlugin, timelinePlugin, captionsPlugin, storyboardPlugin, generationPlugin, canvasPlugin, videoEditPlugin, coverPlugin, publishingPlugin, exportPlugin],
);

export const hasDesktopFeature = (id: string) => desktopPlugins.some(plugin => plugin.id === id);
