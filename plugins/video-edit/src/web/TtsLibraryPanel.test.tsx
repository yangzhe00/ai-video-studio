import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TtsLibraryPanel } from "./TtsLibraryPanel";

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

describe("TtsLibraryPanel", () => {
  it("requires a cost quote and a separate confirmation before creating an asset", async () => {
    const request = vi.fn(async (path: string, method?: string) => {
      if (path === "/tts/voices") return { voices: [{ id: "voice-zh-01", label: "中文女声", language: "zh" }] };
      if (path.endsWith("/tts/estimate") && method === "POST") return { ttsEstimate: {
        id: "estimate-123", projectId: "project-123", textHash: "hash-123", voiceId: "voice-zh-01",
        voiceLanguage: "zh", speed: 1, estimatedCost: { amount: 0.1, currency: "CNY" },
        billingPolicy: "actual-usage", expiresAt: Date.now() + 60_000,
      } };
      if (path.endsWith("/tts/tasks") && method === "POST") return { ttsTask: {
        id: "task-12345678", projectId: "project-123", clientRequestId: "request-123",
        state: "succeeded", voiceAssetId: "asset-12345678", providerTaskId: "provider-123",
        costStatus: "billed", error: null, createdAt: Date.now(), updatedAt: Date.now(),
      } };
      if (path === "/tts/tasks/task-12345678") return { ttsTask: {
        id: "task-12345678", projectId: "project-123", clientRequestId: "request-123",
        state: "succeeded", voiceAssetId: "asset-12345678", providerTaskId: "provider-123",
        costStatus: "billed", error: null, createdAt: Date.now(), updatedAt: Date.now(),
      } };
      throw new Error(`unexpected: ${path}`);
    });
    const onAssetReady = vi.fn(async () => {});
    render(<TtsLibraryPanel accountId="account-123" projectId="project-123" episodeId="episode-123"
      request={async <T,>(path: string, method?: string) => await request(path, method) as T}
      onAssetReady={onAssetReady} />);
    await screen.findByRole("option", { name: "中文女声" });
    fireEvent.change(screen.getByRole("textbox", { name: "旁白文案" }), { target: { value: "妈妈要下班了" } });
    fireEvent.click(screen.getByRole("button", { name: "查看费用说明" }));
    await screen.findByText(/预计费用：0.1 CNY/);
    expect(request.mock.calls.filter(([path]) => path.endsWith("/tts/tasks"))).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "确认费用并生成旁白" }));
    await waitFor(() => expect(onAssetReady).toHaveBeenCalledWith("asset-12345678"));
    expect(request.mock.calls.filter(([path]) => path.endsWith("/tts/tasks"))).toHaveLength(1);
    expect(screen.getByText("旁白已进入配音素材库，请点击“加入配音轨”选择落点。")).toBeTruthy();
  });

  it("disables paid quoting when the service has only an English voice", async () => {
    const request = vi.fn(async (_path: string) => ({ voices: [{ id: "oversea_male1", label: "英文男声", language: "en" }] }));
    render(<TtsLibraryPanel accountId="account-123" projectId="project-123" episodeId="episode-123"
      request={async <T,>(path: string) => await request(path) as T} onAssetReady={vi.fn(async () => {})} />);
    expect(await screen.findByText(/没有可用中文音色/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "旁白文案" }), { target: { value: "晚餐做好啦" } });
    expect((screen.getByRole("button", { name: "查看费用说明" }) as HTMLButtonElement).disabled).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("shows the server availability reason and blocks an unauthenticated TTS account", async () => {
    const request = vi.fn(async (_path: string) => ({ voices: [{ id: "voice-zh-01", label: "中文女声", language: "zh" }],
      availability: "auth_failed", message: "旁白账号认证失败，请检查密钥和接口区域" }));
    render(<TtsLibraryPanel accountId="account-123" projectId="project-123" episodeId="episode-123"
      request={async <T,>(path: string) => await request(path) as T} onAssetReady={vi.fn(async () => {})} />);
    expect(await screen.findByText(/旁白账号认证失败/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "旁白文案" }), { target: { value: "晚餐做好啦" } });
    expect((screen.getByRole("button", { name: "查看费用说明" }) as HTMLButtonElement).disabled).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
