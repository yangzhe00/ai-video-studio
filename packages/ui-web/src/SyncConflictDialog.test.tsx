import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncConflictDialog } from "./SyncConflictDialog";
import type { SyncConflictResource } from "./SyncConflictDialog";

const resources: SyncConflictResource[] = [
  { resourceType: "episode", resourceId: "episode-1", title: "第 1 集",
    local: { revision: 2, preview: "本地：两个片段，保留裁剪" },
    cloud: { revision: 3, preview: "云端：三个片段" } },
  { resourceType: "character", resourceId: "dog", title: "小狗",
    local: { revision: 1, preview: "本地：棕色柴犬" },
    cloud: { revision: 4, preview: "云端：白色柴犬" } },
];

afterEach(cleanup);

describe("SyncConflictDialog", () => {
  it("shows both versions and requires an explicit choice for every resource", () => {
    const onResolve = vi.fn();
    render(<SyncConflictDialog projectTitle="小狗做饭" resources={resources} onCancel={vi.fn()} onResolve={onResolve} />);
    expect(screen.getByText("本地：两个片段，保留裁剪")).toBeTruthy();
    expect(screen.getByText("云端：三个片段")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "按选择继续同步" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("radio", { name: /保留本地/ })[0]);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("radio", { name: /采用云端/ })[1]);
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onResolve).toHaveBeenCalledWith({ "episode:episode-1": "local", "character:dog": "cloud" });
  });

  it("can cancel without resolving or changing either version", () => {
    const onCancel = vi.fn(), onResolve = vi.fn();
    render(<SyncConflictDialog projectTitle="小狗做饭" resources={resources} onCancel={onCancel} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "取消，稍后处理" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onResolve).not.toHaveBeenCalled();
  });
});
