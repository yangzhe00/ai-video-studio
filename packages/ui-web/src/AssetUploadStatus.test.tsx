import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AssetUploadStatus } from "./AssetUploadStatus";

afterEach(cleanup);

describe("AssetUploadStatus", () => {
  it("shows each asset state and retries only the failed asset", () => {
    const retry = vi.fn();
    render(<AssetUploadStatus items={[
      { id: "photo", name: "参考照片.jpg", state: "synced" },
      { id: "video", name: "旧视频.mp4", state: "failed", error: "文件超过上传上限" },
    ]} onRetry={retry} />);
    expect(screen.getByText("已同步")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain("文件超过上传上限");
    fireEvent.click(screen.getByRole("button", { name: "重试上传 旧视频.mp4" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledWith("video");
  });
});
