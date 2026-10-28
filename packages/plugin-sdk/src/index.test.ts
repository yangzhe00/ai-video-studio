import { describe, expect, it } from "vitest";
import { PluginRegistrationError, resolvePlugins } from "./index";
import type { FeaturePlugin } from "./index";

const media: FeaturePlugin = { id: "media", version: "1.0.0", supportedPlatforms: ["desktop", "web"], contributes: { panels: ["media"] } };
const timeline: FeaturePlugin = { id: "timeline", version: "1.0.0", supportedPlatforms: ["desktop"], requires: ["media"], contributes: { panels: ["timeline"] } };

describe("static plugin registry", () => {
  it("omits disabled and unsupported features", () => {
    expect(resolvePlugins("web", ["media", "timeline"], [media, timeline]).map(item => item.id)).toEqual(["media"]);
    expect(resolvePlugins("desktop", ["media"], [media, timeline]).map(item => item.id)).toEqual(["media"]);
  });
  it("orders dependencies before consumers", () => {
    expect(resolvePlugins("desktop", ["timeline", "media"], [timeline, media]).map(item => item.id)).toEqual(["media", "timeline"]);
  });
  it("rejects duplicate IDs and missing dependencies", () => {
    expect(() => resolvePlugins("desktop", ["media"], [media, media])).toThrow(PluginRegistrationError);
    expect(() => resolvePlugins("desktop", ["timeline"], [media, timeline])).toThrow("缺少依赖");
  });
  it("rejects unknown and cyclic registrations", () => {
    expect(() => resolvePlugins("desktop", ["unknown"], [media])).toThrow("未注册");
    const cyclic: FeaturePlugin = { ...media, requires: ["timeline"] };
    expect(() => resolvePlugins("desktop", ["media", "timeline"], [cyclic, timeline])).toThrow("依赖循环");
  });
  it("keeps canvas out of mobile while exposing video editing on every platform", () => {
    const canvas: FeaturePlugin = {
      id: "canvas", version: "1.0.0", supportedPlatforms: ["desktop", "web"],
      contributes: { panels: [], routes: ["canvas"], capabilities: ["graph.edit"], nodeTypes: ["video", "timeline"] },
    };
    const videoEdit: FeaturePlugin = {
      id: "video-edit", version: "1.0.0", supportedPlatforms: ["desktop", "web", "mobile"],
      contributes: { panels: [], routes: ["video-edit"], capabilities: ["video-edit.render"] },
    };
    expect(resolvePlugins("web", ["canvas", "video-edit"], [canvas, videoEdit]).flatMap(item => item.contributes.routes ?? [])).toEqual(["canvas", "video-edit"]);
    expect(resolvePlugins("mobile", ["canvas", "video-edit"], [canvas, videoEdit]).flatMap(item => item.contributes.routes ?? [])).toEqual(["video-edit"]);
  });
});
