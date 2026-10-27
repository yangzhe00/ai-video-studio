import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspace } from "./ProjectWorkspace";

const mocks = vi.hoisted(() => ({ open: vi.fn(), audit: vi.fn(), import: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../lib/native", () => ({ auditAssets: mocks.audit, importAsset: mocks.import, saveProject: mocks.save }));

const manifest = { version: 2 as const, id: "p", title: "故事", assets: [], clips: [], captions: [], publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null };

describe("ProjectWorkspace", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it("imports a selected file into the project and saves the manifest", async () => {
    mocks.audit.mockResolvedValue([]);
    mocks.open.mockResolvedValue(["/tmp/original.png"]);
    const asset = { id: "a", kind: "image", relativePath: "media/source/a.png", durationMs: null, width: 320, height: 240, missing: false };
    mocks.import.mockResolvedValue(asset);
    mocks.save.mockResolvedValue(undefined);
    render(<ProjectWorkspace project={{ root: "/tmp/story", manifest }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /导入素材/ }));
    await waitFor(() => expect(mocks.import).toHaveBeenCalledWith("/tmp/story", "/tmp/original.png"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("/tmp/story", expect.objectContaining({ assets: [asset] })));
    expect(screen.getByRole("button", { name: "加入时间线" })).toBeTruthy();
  });
});
