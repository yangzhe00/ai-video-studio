import { afterEach, describe, expect, it, vi } from "vitest";
import { api, uploadObject } from "../../../../apps/web/src/api.ts";
import { parseApiError } from "../../../../packages/api-contracts/src/index.ts";

afterEach(() => vi.unstubAllGlobals());

describe("A8 legacy error compatibility", () => {
  it("preserves an old JSON API error in the Web adapter", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "旧服务原始错误文案" }, { status: 401 })));
    await expect(api("/projects")).rejects.toThrow("旧服务原始错误文案");
  });

  it("keeps the old upload error text while adding recovery advice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "无法识别媒体内容，请选择有效的照片或视频" }, { status: 400 })));
    await expect(uploadObject(new File(["jpeg"], "photo.jpg", { type: "image/jpeg" })))
      .rejects.toThrow(/无法识别媒体内容.*联系管理员检查服务端媒体解析/);
  });

  it("maps a legacy body to the new status code without losing its message", () => {
    expect(parseApiError({ error: "请先登录" }, 401)).toMatchObject({ error: "请先登录", code: "unauthorized" });
  });
});
