import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecipe } from "../core";
import { VideoEditor } from "./VideoEditor";

const recipe = createRecipe({ id: "edit-1", projectId: "project-1", episodeId: "episode-1",
  shotId: "shot-1", sourceAssetId: "original-1", sourceDurationMs: 5000 });
const base = { id: "edit-1", recipe, sourceAssetId: "original-1", currentCoverId: null };

afterEach(cleanup);

describe("VideoEditor version choice", () => {
  it("only sends the version explicitly selected for the timeline", () => {
    const onUseInTimeline = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<VideoEditor edit={{ ...base, currentOutputId: "edited-1" }}
      sourceUrl="/original.mp4" currentUrl="/edited.mp4" onCommand={vi.fn()}
      onRender={vi.fn()} onUseInTimeline={onUseInTimeline} onClose={vi.fn()} />);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/edited.mp4");
    expect(onUseInTimeline).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "原视频" }));
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/original.mp4");
    fireEvent.click(screen.getByRole("button", { name: "将原视频加入时间线" }));
    expect(onUseInTimeline).toHaveBeenCalledWith("original-1");
    fireEvent.click(screen.getByRole("button", { name: "编辑版" }));
    fireEvent.click(screen.getByRole("button", { name: "将编辑版加入时间线" }));
    expect(onUseInTimeline).toHaveBeenLastCalledWith("edited-1");
  });

  it("keeps the edited tab unavailable until an output exists", () => {
    render(<VideoEditor edit={{ ...base, currentOutputId: null }} sourceUrl="/original.mp4"
      onCommand={vi.fn()} onRender={vi.fn()} onUseInTimeline={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByRole("button", { name: "编辑版" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "将原视频加入时间线" })).toBeTruthy();
  });
});
