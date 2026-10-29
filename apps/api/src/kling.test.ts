import { describe, expect, it } from "vitest";
import { KlingGateway } from "./kling.ts";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const input = { externalTaskId: "operation-1", imageBase64: "aW1hZ2U=", prompt: "小狗洗菜", durationSec: 5 as const };

describe("backend Kling gateway", () => {
  it("sends the saved external task ID using the documented image-to-video contract", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetchMock: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ code: 0, data: { id: "remote-1", status: "submitted" } });
    };
    const gateway = new KlingGateway("server-secret", "https://api-beijing.klingai.com", fetchMock);
    expect(await gateway.submit(input)).toEqual({ kind: "accepted", remoteTaskId: "remote-1" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/image-to-video/kling-2.5-turbo");
    expect(JSON.parse(String(requests[0].init?.body)).options.external_task_id).toBe("operation-1");
  });

  it("treats lost submit responses as unknown and queries by the original external ID", async () => {
    const methods: string[] = [];
    const fetchMock: typeof fetch = async (url, init) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "POST") throw new Error("lost response");
      expect(String(url)).toContain("external_task_ids=operation-1");
      return Response.json({ code: 0, data: [{ id: "remote-1", status: "processing", outputs: [] }] });
    };
    const gateway = new KlingGateway("server-secret", "https://api-beijing.klingai.com", fetchMock);
    expect(await gateway.submit(input)).toEqual({ kind: "unknown" });
    expect(await gateway.query(null, input.externalTaskId)).toMatchObject({ status: "processing", remoteTaskId: "remote-1" });
    expect(methods).toEqual(["POST", "GET"]);
  });

  it("rejects unsafe download URLs", async () => {
    const gateway = new KlingGateway("server-secret", "https://api-beijing.klingai.com", async () => { throw new Error("unexpected request"); });
    await expect(gateway.download("http://127.0.0.1/private")).rejects.toThrow(/不可信/);
  });

  it("streams a bounded result to disk and removes an oversized partial file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-download-test-"));
    try {
      const path = join(dir, "result.mp4");
      const gateway = new KlingGateway("server-secret", "https://api-beijing.klingai.com",
        async () => new Response(Buffer.from("too-large")));
      await expect(gateway.downloadToFile("https://h1.inkwai.com/result.mp4", path, 3)).rejects.toThrow(/大小限制/);
      expect(existsSync(path)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
