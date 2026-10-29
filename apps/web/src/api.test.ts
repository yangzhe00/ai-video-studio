import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadObject } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("photo upload", () => {
  it("rejects an unsupported image before sending its bytes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadObject(new File(["heic"], "photo.heic", { type: "image/heic" }))).rejects.toThrow("JPG 或 PNG");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains a server media-inspection failure without hiding its cause", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "无法识别媒体内容，请选择有效的照片或视频" }, { status: 400 })));
    await expect(uploadObject(new File(["jpeg"], "photo.jpg", { type: "image/jpeg" }))).rejects.toThrow(/联系管理员检查服务端媒体解析/);
  });
});
