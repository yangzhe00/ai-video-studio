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
    expect(onAdd.mock.calls[0][0]).toMatchObject({ sourceAssetId: "human", prompt: "在雨中跳舞", speaking: false });
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
});
