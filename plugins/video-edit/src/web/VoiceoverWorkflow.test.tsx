import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceoverWorkflow } from "./VoiceoverWorkflow";

afterEach(() => { cleanup(); localStorage.clear(); });

describe("VoiceoverWorkflow mixed preview", () => {
  it("previews the saved shot revision and makes a new preview necessary after revision changes", async () => {
    const request = vi.fn(async (path: string, method?: string, _data?: unknown) => {
      if (path === "/tts/voices") return { voices: [{ id: "oversea_male1", label: "英文男声", language: "en" }] };
      if (path === "/video-edits/edit-1/previews" && method === "POST") return { preview: {
        id: "preview-12345678", scope: "shot", targetId: "edit-1", revision: 3,
        state: "succeeded", outputAssetId: "object-12345678", error: null,
      } };
      throw new Error(`Unexpected request: ${method ?? "GET"} ${path}`);
    });
    const onExport = vi.fn().mockResolvedValue(undefined);
    const props = { accountId: "account-1", projectId: "project-1", scope: "shot" as const,
      targetId: "edit-1", durationMs: 5000, audioMix: { originalVolume: 1, voiceClips: [], musicClips: [] },
      voiceAssets: [], request: async <T,>(path: string, method?: string, data?: unknown) => await request(path, method, data) as T,
      onUpload: vi.fn(), onTtsAssetReady: vi.fn(), onPreviewAssetReady: vi.fn(async (id: string) => `/api/objects/${id}`),
      onSave: vi.fn(), onExport };
    const view = render(<VoiceoverWorkflow {...props} targetRevision={3} />);
    expect(await screen.findByRole("option", { name: "英文男声" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认导出" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "合成预览" }));
    await waitFor(() => expect(screen.getByLabelText("配音混音预览").getAttribute("src")).toBe("/api/objects/object-12345678"));
    expect(request).toHaveBeenCalledWith("/video-edits/edit-1/previews", "POST",
      expect.objectContaining({ expectedRevision: 3, previewOperationId: expect.any(String) }));
    fireEvent.click(screen.getByRole("button", { name: "确认导出" }));
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());
    view.rerender(<VoiceoverWorkflow {...props} targetRevision={4} />);
    await waitFor(() => expect((screen.getByRole("button", { name: "确认导出" }) as HTMLButtonElement).disabled).toBe(true));
  });
});
