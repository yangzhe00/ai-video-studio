import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSuggestionPanel } from "./AgentSuggestionPanel";

afterEach(cleanup);

const example = { id: "suggestions-1", targetRevision: 3, state: "ready" as const, suggestions: [
  { id: "trim-1", title: "缩短开头", reason: "第一秒没有动作", before: "0–5 秒", after: "1–5 秒" },
  { id: "invalid-1", title: "无效建议", reason: "素材缺失", before: "镜头 A", after: "镜头 B", invalidReason: "素材不属于本项目" },
] };

describe("AgentSuggestionPanel", () => {
  it("does not apply before explicit confirmation, and excludes invalid suggestions", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<AgentSuggestionPanel set={example} onGenerate={vi.fn()} onConfirm={onConfirm} />);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "预览所选 1 条" }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认应用所选建议" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("suggestions-1", ["trim-1"], 3));
  });

  it("keeps manual editing available on conflict or failed generation", () => {
    render(<AgentSuggestionPanel set={{ ...example, state: "conflict" }} error="模型暂不可用"
      onGenerate={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText(/仍可继续手工编辑/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /预览所选/ })).toBeNull();
    expect(screen.getByText(/这组建议不能直接应用/)).toBeTruthy();
  });

  it("selects valid actions when a pending set becomes ready", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<AgentSuggestionPanel set={{ ...example, suggestions: [] }} onGenerate={vi.fn()} onConfirm={onConfirm} />);
    rerender(<AgentSuggestionPanel set={example} onGenerate={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByRole("button", { name: "预览所选 1 条" })).toBeTruthy();
  });
});
