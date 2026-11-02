import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EpisodeTimelineEditor } from "./EpisodeTimelineEditor";
import type { TimelineAsset, TimelineSnapshot } from "./timeline-model";

const visuals = [1, 2, 3].map(index => ({ id: `shot-${index}`, assetId: `video-${index}`,
  title: `镜头 ${index}`, inMs: 0, outMs: 5000, volume: 1 }));
const assets: TimelineAsset[] = [
  ...[1, 2, 3].map(index => ({ id: `video-${index}`, kind: "video" as const,
    name: `画面 ${index}`, durationMs: 5000, url: `/video-${index}` })),
  { id: "voice-one", kind: "voice", name: "第一段旁白", durationMs: 3000, url: "/voice-one" },
  { id: "voice-two", kind: "voice", name: "第二段旁白", durationMs: 3000, url: "/voice-two" },
  { id: "music-one", kind: "music", name: "背景音乐", durationMs: 15000, url: "/music-one" },
];
const snapshot: TimelineSnapshot = { visuals, originalVolume: 0.7, audio: [
  { id: "voice-clip-one", kind: "voice", assetId: "voice-one", startMs: 1000, inMs: 0, outMs: 3000,
    volume: 1, anchor: { kind: "absolute" } },
  { id: "voice-clip-two", kind: "voice", assetId: "voice-two", startMs: 6000, inMs: 0, outMs: 3000,
    volume: 1, anchor: { kind: "absolute" } },
  { id: "music-clip-one", kind: "music", assetId: "music-one", startMs: 0, inMs: 0, outMs: 15000,
    volume: 0.35, anchor: { kind: "absolute" } },
] };
const props = { projectTitle: "小狗做饭", episodeTitle: "第 1 集", revision: 3,
  snapshot, assets, draftStorageKey: "episode-editor-test", onBack: vi.fn(),
  onSave: vi.fn(async () => {}), onPreview: vi.fn(async () => {}), onExport: vi.fn(async () => {}) };

beforeAll(() => { HTMLMediaElement.prototype.pause = vi.fn(); HTMLMediaElement.prototype.play = vi.fn(async () => {});
  HTMLElement.prototype.setPointerCapture = vi.fn(); });
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

describe("EpisodeTimelineEditor", () => {
  it("keeps narration creation with voice assets and music upload separate", () => {
    render(<EpisodeTimelineEditor {...props} onUploadAudio={vi.fn(async () => assets[3]!)} ttsSlot={<p>旁白生成任务</p>} />);
    const voiceSection = screen.getByRole("heading", { name: "配音" }).closest("section")!;
    const musicSection = screen.getByRole("heading", { name: "背景音乐" }).closest("section")!;
    expect(within(voiceSection).getByRole("button", { name: "上传录音" })).toBeTruthy();
    expect(within(voiceSection).getByRole("button", { name: "文字生成旁白" })).toBeTruthy();
    expect(within(musicSection).getByRole("button", { name: "上传背景音乐" })).toBeTruthy();
    expect(within(musicSection).queryByRole("button", { name: "文字生成旁白" })).toBeNull();
    expect(within(voiceSection).getAllByText("加入配音轨")).toHaveLength(2);
    expect(voiceSection.querySelector('audio[src="/voice-one"]')).toBeTruthy();
    fireEvent.click(within(voiceSection).getByRole("button", { name: "文字生成旁白" }));
    expect(within(screen.getByRole("dialog", { name: "文字生成旁白" })).getByText("旁白生成任务")).toBeTruthy();
  });

  it("shows every visual, voice and music clip on one time axis", () => {
    render(<EpisodeTimelineEditor {...props} />);
    expect(screen.getByText("3 个镜头 · 15.0 秒 · 对齐声音与画面")).toBeTruthy();
    expect(screen.getByRole("button", { name: /第一段旁白，1.0 秒开始/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /第二段旁白，6.0 秒开始/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /背景音乐，0.0 秒开始/ })).toBeTruthy();
    expect(document.querySelectorAll(".episode-editor-visual-clip")).toHaveLength(3);
    expect((screen.getByRole("button", { name: "导出成片" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("drags the ruler without saving and moves by 0.1 seconds with the keyboard", () => {
    const onSave = vi.fn(async () => {});
    render(<EpisodeTimelineEditor {...props} onSave={onSave} />);
    const ruler = screen.getByRole("slider", { name: "时间尺播放头" });
    ruler.getBoundingClientRect = () => ({ left: 300, right: 1800, top: 0, bottom: 30, width: 1500, height: 30, x: 300, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: 855 });
    expect(ruler.getAttribute("aria-valuetext")).toBe("00:07.3");
    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: 1273 });
    fireEvent.pointerUp(ruler, { pointerId: 1, clientX: 1273 });
    expect(ruler.getAttribute("aria-valuetext")).toBe("00:12.8");
    fireEvent.keyDown(ruler, { key: "ArrowLeft" });
    expect(ruler.getAttribute("aria-valuetext")).toBe("00:12.7");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("opens one selected shot for AI annotation and keeps its draft without fake submission", () => {
    render(<EpisodeTimelineEditor {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "选择镜头：镜头 2" }));
    fireEvent.click(screen.getByRole("button", { name: "✦ AI 编辑这个镜头" }));
    const dialog = screen.getByRole("dialog", { name: "AI 编辑 镜头 2" });
    expect(within(dialog).getByText(/当前未接入经验证的视频局部编辑服务/)).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "查看费用并提交" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByPlaceholderText(/把框选的小狗改成戴厨师帽/), { target: { value: "给小狗戴厨师帽" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭 AI 编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "✦ AI 编辑这个镜头" }));
    expect((screen.getByPlaceholderText(/把框选的小狗改成戴厨师帽/) as HTMLTextAreaElement).value).toBe("给小狗戴厨师帽");
  });

  it("applies a 0.1 second position, then undoes and redoes the edit", async () => {
    const onSave = vi.fn(async (_snapshot: TimelineSnapshot) => {});
    render(<EpisodeTimelineEditor {...props} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /第二段旁白，6.0 秒开始/ }));
    fireEvent.change(screen.getByLabelText("片段起点秒数"), { target: { value: "6.1" } });
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]![0].audio[1].startMs).toBe(6100);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1]![0].audio[1].startMs).toBe(6000);
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(3));
    expect(onSave.mock.calls[2]![0].audio[1].startMs).toBe(6100);
  });

  it("saves a pointer move once when released, not for every movement", async () => {
    const onSave = vi.fn(async (_snapshot: TimelineSnapshot) => {});
    render(<EpisodeTimelineEditor {...props} onSave={onSave} />);
    const clip = screen.getByRole("button", { name: /第一段旁白，1.0 秒开始/ });
    fireEvent.pointerDown(clip, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(clip, { pointerId: 1, clientX: 138 });
    fireEvent.pointerMove(clip, { pointerId: 1, clientX: 176 });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.pointerUp(clip, { pointerId: 1, clientX: 176 });
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]![0].audio[0].startMs).toBe(2000);
  });

  it("reorders visual clips from the picture track and writes the new order", async () => {
    const onSave = vi.fn(async (_snapshot: TimelineSnapshot) => {});
    render(<EpisodeTimelineEditor {...props} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "将镜头 2前移" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]![0].visuals.map(clip => clip.id)).toEqual(["shot-2", "shot-1", "shot-3"]);
  });

  it("keeps a failed save as a local draft and reports a revision conflict", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("409：分集版本已变化"));
    render(<EpisodeTimelineEditor {...props} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /第二段旁白，6.0 秒开始/ }));
    fireEvent.change(screen.getByLabelText("片段起点秒数"), { target: { value: "6.1" } });
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    await waitFor(() => expect(screen.getByText("版本冲突")).toBeTruthy());
    expect(localStorage.getItem(props.draftStorageKey)).toContain('"startMs":6100');
    expect((screen.getByRole("button", { name: "精准预览" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires a matching saved preview before export", () => {
    const view = render(<EpisodeTimelineEditor {...props} preview={{ state: "succeeded", revision: 2, url: "/old" }} />);
    expect((screen.getByRole("button", { name: "导出成片" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<EpisodeTimelineEditor {...props} preview={{ state: "succeeded", revision: 3, url: "/new" }} />);
    expect((screen.getByRole("button", { name: "导出成片" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("restores a local draft after a newer cloud revision without silently overwriting it", () => {
    const draft = structuredClone(snapshot);
    draft.audio[1].startMs = 6100;
    localStorage.setItem(props.draftStorageKey, JSON.stringify({ revision: 3, snapshot: draft }));
    render(<EpisodeTimelineEditor {...props} revision={4} onRefresh={async () => snapshot} />);
    expect(screen.getByText("版本冲突")).toBeTruthy();
    expect(screen.getByRole("button", { name: /第二段旁白，6.1 秒开始/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: "精准预览" }) as HTMLButtonElement).disabled).toBe(true);
    expect(localStorage.getItem(props.draftStorageKey)).toContain('"startMs":6100');
  });

  it("does not send conflicting edits until the user explicitly accepts the cloud version", async () => {
    const draft = structuredClone(snapshot);
    draft.audio[1].startMs = 6100;
    localStorage.setItem(props.draftStorageKey, JSON.stringify({ revision: 3, snapshot: draft }));
    const onSave = vi.fn(async (_snapshot: TimelineSnapshot) => {});
    render(<EpisodeTimelineEditor {...props} revision={4} onSave={onSave} onRefresh={async () => snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: /第二段旁白，6.1 秒开始/ }));
    fireEvent.change(screen.getByLabelText("片段起点秒数"), { target: { value: "6.2" } });
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(localStorage.getItem(props.draftStorageKey)).toContain('"startMs":6200');
    fireEvent.click(screen.getByRole("button", { name: "查看云端版本" }));
    fireEvent.click(await screen.findByRole("button", { name: "使用云端版本继续" }));
    expect(localStorage.getItem(`${props.draftStorageKey}:conflict-backup`)).toContain('"startMs":6200');
    expect(screen.getByRole("button", { name: /第二段旁白，6.0 秒开始/ })).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("classifies another-device update as conflict and shows exact cloud differences", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("项目已在另一端更新，请检查最新内容后重试"));
    const cloud = { ...snapshot, originalVolume: 0.8 };
    render(<EpisodeTimelineEditor {...props} onSave={onSave} onRefresh={async () => cloud} />);
    fireEvent.change(screen.getByLabelText("镜头原声音量百分比"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "保存原声音量" }));
    await waitFor(() => expect(screen.getByText("版本冲突")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "查看云端版本" }));
    expect(await screen.findByText("镜头原声音量：本地 90%；云端 80%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试合并本地草稿" }));
    expect(await screen.findByText(/自动合并需要人工决定/)).toBeTruthy();
  });

  it("rebases independent local and cloud changes before retrying the save", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("项目已在另一端更新"))
      .mockResolvedValueOnce(undefined);
    const cloud = { ...snapshot, originalVolume: 0.8 };
    render(<EpisodeTimelineEditor {...props} onSave={onSave} onRefresh={async () => cloud} />);
    fireEvent.click(screen.getByRole("button", { name: /背景音乐，0.0 秒开始/ }));
    fireEvent.change(screen.getByLabelText("片段音量百分比"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    await waitFor(() => expect(screen.getByText("版本冲突")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "查看云端版本" }));
    fireEvent.click(await screen.findByRole("button", { name: "重试合并本地草稿" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect((onSave.mock.calls[1]![0] as TimelineSnapshot).originalVolume).toBe(0.8);
    expect((onSave.mock.calls[1]![0] as TimelineSnapshot).audio[2].volume).toBe(0.4);
    await waitFor(() => expect(screen.getByText("已保存")).toBeTruthy());
  });

  it("keeps the draft and asks before leaving after an offline save failure", async () => {
    const onSave = vi.fn().mockRejectedValue(new SyntaxError("Unexpected end of JSON input"));
    const onBack = vi.fn();
    render(<EpisodeTimelineEditor {...props} onSave={onSave} onBack={onBack} />);
    fireEvent.change(screen.getByLabelText("镜头原声音量百分比"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "保存原声音量" }));
    await waitFor(() => expect(screen.getByText("保存失败")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/网络连接中断或服务端暂时不可用/);
    fireEvent.click(screen.getByRole("button", { name: "返回画布" }));
    expect(screen.getByRole("dialog", { name: "未保存的本地草稿" })).toBeTruthy();
    expect(onBack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保留本地草稿并返回" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(localStorage.getItem(props.draftStorageKey)).toContain('"originalVolume":0.9');
  });
});
