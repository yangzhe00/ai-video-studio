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
    fireEvent.change(screen.getByRole("textbox", { name: "配音文案" }), { target: { value: "妈妈要下班了" } });
    fireEvent.click(screen.getByRole("button", { name: "查看费用说明" }));
    await screen.findByText(/预计费用：0.1 CNY/);
    expect(request.mock.calls.filter(([path]) => path.endsWith("/tts/tasks"))).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "确认费用并生成配音" }));
    await waitFor(() => expect(onAssetReady).toHaveBeenCalledWith("asset-12345678"));
    expect(request.mock.calls.filter(([path]) => path.endsWith("/tts/tasks"))).toHaveLength(1);
    expect(screen.getByText("配音已进入素材库，请手动放入时间线。")).toBeTruthy();
  });
});
