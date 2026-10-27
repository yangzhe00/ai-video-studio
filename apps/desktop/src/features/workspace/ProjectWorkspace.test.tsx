import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspace } from "./ProjectWorkspace";

const mocks = vi.hoisted(() => ({ choose: vi.fn(), audit: vi.fn(), import: vi.fn(), save: vi.fn(), status: vi.fn() }));
vi.mock("../../lib/ports", () => ({ desktopPorts: { media: { chooseFiles: mocks.choose, audit: mocks.audit, import: mocks.import }, projects: { save: mocks.save }, ai: { keyStatus: mocks.status } } }));

const manifest = { version: 2 as const, id: "p", title: "故事", assets: [], clips: [], captions: [], publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null };

describe("ProjectWorkspace", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it("imports a selected file into the project and saves the manifest", async () => {
    mocks.audit.mockResolvedValue([]);
    mocks.choose.mockResolvedValue(["/tmp/original.png"]);
    mocks.status.mockResolvedValue([]);
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
