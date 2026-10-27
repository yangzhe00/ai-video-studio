import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const mocks = vi.hoisted(() => ({ open: vi.fn(), chooseExisting: vi.fn(), audit: vi.fn() }));
vi.mock("./lib/ports", () => ({ desktopPorts: { projects: { open: mocks.open, chooseExisting: mocks.chooseExisting }, media: { audit: mocks.audit } } }));

const manifest = { version: 2 as const, id: "p", title: "上次项目", assets: [], clips: [], captions: [], publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null };

describe("direct editor entry", () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); mocks.audit.mockResolvedValue([]); });
  afterEach(cleanup);

  it("shows new and open actions inside an empty editor on first launch", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /新建项目/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开已有项目" })).toBeTruthy();
    expect(screen.getByText(/故事板\s+时间线/)).toBeTruthy();
    expect(screen.queryByText("让你的故事动起来。")).toBeNull();
  });

  it("restores the last project straight into the editor", async () => {
    localStorage.setItem("ai-video-studio:last-project-root", "/tmp/last-project");
    mocks.open.mockResolvedValue(manifest);
    render(<App />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "故事板" })).toBeTruthy());
    expect(screen.getAllByText("上次项目").length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: "项目入口" })).toBeNull();
  });

  it("remembers a project opened from the workspace", async () => {
    mocks.chooseExisting.mockResolvedValue("/tmp/story");
    mocks.open.mockResolvedValue(manifest);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "打开已有项目" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "故事板" })).toBeTruthy());
    expect(localStorage.getItem("ai-video-studio:last-project-root")).toBe("/tmp/story");
  });

  it("keeps the workspace usable when the last folder disappeared", async () => {
    localStorage.setItem("ai-video-studio:last-project-root", "/tmp/missing");
    mocks.open.mockRejectedValue(new Error("missing"));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/无法打开/));
    expect(screen.getByRole("button", { name: "打开已有项目" })).toBeTruthy();
    expect(localStorage.getItem("ai-video-studio:last-project-root")).toBeNull();
  });
});
