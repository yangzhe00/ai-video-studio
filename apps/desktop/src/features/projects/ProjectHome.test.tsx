import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectHome } from "./ProjectHome";

const mocks = vi.hoisted(() => ({ parent: vi.fn(), existing: vi.fn(), create: vi.fn(), load: vi.fn() }));
vi.mock("../../lib/ports", () => ({ desktopPorts: { projects: { chooseParent: mocks.parent, chooseExisting: mocks.existing, create: mocks.create, open: mocks.load } } }));

const manifest = { version: 2, id: "p", title: "故事", assets: [], clips: [], captions: [], publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null };

describe("ProjectHome", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(cleanup);

  it("creates a new independent project under the selected directory", async () => {
    mocks.parent.mockResolvedValue("/tmp/projects");
    mocks.create.mockResolvedValue(manifest);
    const onOpen = vi.fn();
    render(<ProjectHome onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /新建项目/ }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "故事" } });
    fireEvent.click(screen.getByRole("button", { name: /选择保存位置并创建/ }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith("/tmp/projects/故事", "故事"));
    expect(onOpen).toHaveBeenCalledWith({ root: "/tmp/projects/故事", manifest });
  });

  it("opens an existing project without changing it", async () => {
    mocks.existing.mockResolvedValue("/tmp/projects/故事");
    mocks.load.mockResolvedValue(manifest);
    const onOpen = vi.fn();
    render(<ProjectHome onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /打开项目/ }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ root: "/tmp/projects/故事", manifest }));
  });
});
