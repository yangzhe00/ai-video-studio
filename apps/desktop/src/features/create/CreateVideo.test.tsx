import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateVideo } from "./CreateVideo";

const images = [{ id: "human", kind: "image" as const, relativePath: "media/source/human.jpg", durationMs: null, width: 500, height: 500, missing: false }];

describe("CreateVideo", () => {
  afterEach(cleanup);
  it("saves a human photo shot from a freeform prompt", () => {
    const onAdd = vi.fn();
    render(<CreateVideo assets={images} shots={[]} onAdd={onAdd} />);
    fireEvent.change(screen.getByLabelText("参考照片"), { target: { value: "human" } });
    fireEvent.change(screen.getByLabelText("场景和动作提示词"), { target: { value: "在雨中跳舞" } });
    fireEvent.click(screen.getByRole("button", { name: "保存分镜草稿" }));
    expect(onAdd.mock.calls[0][0]).toMatchObject({ sourceAssetId: "human", prompt: "在雨中跳舞", speaking: false, modelId: "kling-v2-5-turbo" });
  });
  it("allows replacing the optional chef preset", () => {
    const onAdd = vi.fn();
    render(<CreateVideo assets={images} shots={[]} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "使用宠物小厨师示例" }));
    fireEvent.change(screen.getByLabelText("参考照片"), { target: { value: "human" } });
    fireEvent.change(screen.getByLabelText("场景和动作提示词"), { target: { value: "在海边散步" } });
    fireEvent.change(screen.getByLabelText("可选台词"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存分镜草稿" }));
    expect(onAdd.mock.calls[0][0]).toMatchObject({ prompt: "在海边散步", speaking: false });
  });
  it("queries an unresolved task instead of offering another paid submit", () => {
    const onGenerate = vi.fn();
    const onRefresh = vi.fn();
    const shot = { id: "shot-1", sourceAssetId: "human", prompt: "在雨中跳舞", durationSec: 5, speaking: false, script: null, acceptedAudioAssetId: null, modelId: "kling-v2-5-turbo" };
    const job = { id: "job-1", shotId: shot.id, provider: "kling", modelId: shot.modelId, state: "unknown" as const, remoteId: null, estimatedUsd: 0, actualUsd: null, outputAssetId: null };
    render(<CreateVideo assets={images} shots={[shot]} jobs={[job]} onAdd={vi.fn()} onGenerate={onGenerate} onRefresh={onRefresh} />);
    expect(screen.queryByRole("button", { name: "生成视频（付费）" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查询原任务状态" }));
    expect(onRefresh).toHaveBeenCalledWith("job-1");
    expect(onGenerate).not.toHaveBeenCalled();
  });
});
