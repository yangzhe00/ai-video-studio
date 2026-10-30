import { afterEach, describe, expect, it, vi } from "vitest";
import { api, uploadObject, uploadVoiceObject } from "./api";

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

  it("marks binary uploads as same-origin state changes", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ object: { id: "photo-1", mime: "image/jpeg", size: 4 } }));
    vi.stubGlobal("fetch", fetchMock);
    await uploadObject(new File(["jpeg"], "photo.jpg", { type: "image/jpeg" }));
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "X-AVS-Request": "1" });
  });
});

describe("state-changing API requests", () => {
  it("sends the security marker for a bodyless logout and leaves GET alone", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await api("/auth/logout", "POST");
    await api("/auth/me");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "X-AVS-Request": "1" });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).not.toHaveProperty("X-AVS-Request");
  });
});

describe("voice upload", () => {
  it("rejects an unsupported format before sending bytes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadVoiceObject(new File(["audio"], "voice.ogg", { type: "audio/ogg" }))).rejects.toThrow("MP3、WAV 或 M4A");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the shared binary object route with the same-origin mutation marker", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ object: { id: "voice-1", mime: "audio/mpeg", size: 5 } }));
    vi.stubGlobal("fetch", fetchMock);
    await uploadVoiceObject(new File(["voice"], "voice.mp3", { type: "audio/mpeg" }));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/objects");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "content-type": "audio/mpeg", "X-AVS-Request": "1" });
  });
});
