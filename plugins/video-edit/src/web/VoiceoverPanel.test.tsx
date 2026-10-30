import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceoverPanel } from "./VoiceoverPanel";

afterEach(cleanup);

const draft = { voiceAssetId: null, startMs: 0, trimStartMs: 0, trimEndMs: 0,
  voiceVolume: 1, sourceVolume: 0.5, musicVolume: 0.3 };
const asset = { id: "voice-1", name: "妈妈下班了.mp3", durationMs: 4000, url: "/voice-1.mp3" };
const callbacks = () => ({ onUpload: vi.fn().mockResolvedValue(asset),
  onQuoteTts: vi.fn().mockResolvedValue({ id: "quote-1", amount: 1.5, currency: "CNY" }),
  onStartTts: vi.fn().mockResolvedValue({ id: "tts-1", state: "pending" }),
  onSave: vi.fn().mockResolvedValue(undefined), onExport: vi.fn().mockResolvedValue(undefined) });

describe("VoiceoverPanel", () => {
  it("uploads, previews and requires saving before explicit export", async () => {
    const actions = callbacks();
    render(<VoiceoverPanel scope="shot" durationMs={5000} draft={draft} assets={[]} ttsVoices={[]} {...actions} />);
    fireEvent.change(screen.getByLabelText("上传录音"), { target: { files: [new File(["audio"], "voice.mp3", { type: "audio/mpeg" })] } });
    await waitFor(() => expect(actions.onUpload).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("试听配音素材")).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认导出" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "保存配音草稿" }));
    await waitFor(() => expect(actions.onSave).toHaveBeenCalledWith(expect.objectContaining({ voiceAssetId: "voice-1", trimEndMs: 4000 })));
    fireEvent.click(screen.getByRole("button", { name: "确认导出" }));
    await waitFor(() => expect(actions.onExport).toHaveBeenCalledOnce());
  });

  it("never starts paid TTS until a cost quote is shown and confirmed", async () => {
    const actions = callbacks();
    render(<VoiceoverPanel scope="episode" durationMs={10000} draft={draft} assets={[]} ttsVoices={[{ id: "voice-a", label: "温柔女声", language: "zh" }]} {...actions} />);
    fireEvent.change(screen.getByLabelText("配音文案"), { target: { value: "妈妈要下班了" } });
    expect(actions.onStartTts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查看费用说明" }));
    await waitFor(() => expect(screen.getByText(/预计费用 1.5 CNY/)).toBeTruthy());
    expect(actions.onStartTts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认付费生成配音" }));
    await waitFor(() => expect(actions.onStartTts).toHaveBeenCalledWith("妈妈要下班了", "voice-a", "zh", 1, "quote-1", expect.any(String)));
  });

  it("blocks repeat submission after an uncertain provider response", async () => {
    const actions = callbacks();
    actions.onStartTts.mockRejectedValueOnce(new Error("网络中断"));
    const onRefreshTts = vi.fn().mockResolvedValue(undefined);
    render(<VoiceoverPanel scope="shot" durationMs={5000} draft={draft} assets={[]} ttsVoices={[{ id: "voice-a", label: "温柔女声", language: "zh" }]}
      onRefreshTts={onRefreshTts} {...actions} />);
    fireEvent.change(screen.getByLabelText("配音文案"), { target: { value: "你好" } });
    fireEvent.click(screen.getByRole("button", { name: "查看费用说明" }));
    await screen.findByText(/预计费用 1.5 CNY/);
    fireEvent.click(screen.getByRole("button", { name: "确认付费生成配音" }));
    await screen.findByText(/提交结果尚不确定/);
    expect((screen.getByRole("button", { name: "确认付费生成配音" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "查询原配音任务" }));
    await waitFor(() => expect(onRefreshTts).toHaveBeenCalledWith(expect.any(String)));
  });

  it("refuses to save voice audio that extends beyond the retained shot", () => {
    const actions = callbacks();
    render(<VoiceoverPanel scope="shot" durationMs={5000} draft={{ ...draft, voiceAssetId: asset.id, trimEndMs: asset.durationMs }}
      assets={[asset]} ttsVoices={[]} {...actions} />);
    fireEvent.change(screen.getByLabelText("配音开始秒数"), { target: { value: "2.0" } });
    expect(screen.getByText(/请检查配音起点/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "保存配音草稿" }) as HTMLButtonElement).disabled).toBe(true);
    expect(actions.onSave).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation when TTS is charged by actual usage", async () => {
    const actions = callbacks();
    actions.onQuoteTts.mockResolvedValueOnce({ id: "quote-unknown", amount: null, currency: null });
    render(<VoiceoverPanel scope="episode" durationMs={10000} draft={draft} assets={[]} ttsVoices={[{ id: "voice-a", label: "示例音色", language: "zh" }]} {...actions} />);
    fireEvent.change(screen.getByLabelText("配音文案"), { target: { value: "你好" } });
    fireEvent.click(screen.getByRole("button", { name: "查看费用说明" }));
    await screen.findByText(/可灵按实际用量扣费；目前无法给出准确事前报价/);
    expect(actions.onStartTts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认按实际用量扣费并生成" }));
    await waitFor(() => expect(actions.onStartTts).toHaveBeenCalledOnce());
  });

  it("requires a playable mixed preview after saving before export", async () => {
    const actions = callbacks();
    const onPreview = vi.fn().mockResolvedValue(undefined);
    const props = { scope: "shot" as const, durationMs: 5000, draft, assets: [] as typeof asset[],
      ttsVoices: [] as { id: string; label: string; language: "zh" | "en" }[], onPreview, ...actions };
    const view = render(<VoiceoverPanel {...props} />);
    expect((screen.getByRole("button", { name: "确认导出" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "合成预览" }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledOnce());
    view.rerender(<VoiceoverPanel {...props} preview={{ state: "succeeded", url: "/mixed-preview.mp4" }} />);
    expect(screen.getByLabelText("配音混音预览")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认导出" }));
    await waitFor(() => expect(actions.onExport).toHaveBeenCalledOnce());
  });

  it("shows only validated voices for the selected language", async () => {
    const actions = callbacks();
    render(<VoiceoverPanel scope="shot" durationMs={5000} draft={draft} assets={[]}
      ttsVoices={[{ id: "zh-voice", label: "中文女声", language: "zh" },
        { id: "oversea_male1", label: "英文男声", language: "en" }]} {...actions} />);
    expect(screen.getByRole("option", { name: "中文女声" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "英文男声" })).toBeNull();
    fireEvent.change(screen.getByLabelText("配音语言"), { target: { value: "en" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "英文男声" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("配音文案"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "查看费用说明" }));
    await waitFor(() => expect(actions.onQuoteTts).toHaveBeenCalledWith("Hello", "oversea_male1", "en", 1));
  });
});
