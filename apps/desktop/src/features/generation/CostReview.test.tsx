import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CostReview } from "./CostReview";
import type { ShotDraft } from "@ai-video/project-core";

const mocks = vi.hoisted(() => ({ quote: vi.fn() }));
vi.mock("../../lib/ports", () => ({ desktopPorts: { ai: { quote: mocks.quote, checkBudget: vi.fn() } } }));

const shot: ShotDraft = { id: "s", sourceAssetId: "a", prompt: "在雨中跳舞", durationSec: 10, speaking: false, script: null, acceptedAudioAssetId: null, modelId: "seedance-15-pro" };

describe("CostReview", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it("shows dated estimate and budget impact without submitting paid work", async () => {
    mocks.quote.mockResolvedValue({ modelId: "seedance-15-pro", durationSec: 10, microsUsd: 250000, asOf: "2026-10-27" });
    const onSaveBudget = vi.fn();
    render(<CostReview root="/tmp/story" shots={[shot]} budgetUsd={0.20} onSaveBudget={onSaveBudget} />);
    await waitFor(() => expect(screen.getByText(/超过当前预算/)).toBeTruthy());
    expect(screen.getAllByText(/\$0.2500/)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /提交|生成视频/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("项目预算上限"), { target: { value: "0.60" } });
    fireEvent.click(screen.getByRole("button", { name: "保存预算" }));
    expect(onSaveBudget).toHaveBeenCalledWith(0.60);
  });
});
