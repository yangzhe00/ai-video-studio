import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ResultsPage } from "./ResultsPage";
import { StudioShell } from "./StudioChrome";

afterEach(cleanup);

describe("shared C4 components", () => {
  it("shows an honest empty result and routes to generation", () => {
    const generate = vi.fn();
    render(<ResultsPage results={[]} onGenerate={generate} />);
    expect(screen.getByText("还没有视频结果")).toBeTruthy();
    expect(screen.queryByRole("video")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /去生成第一个镜头/ }));
    expect(generate).toHaveBeenCalledOnce();
  });

  it("keeps the task identity visible and refreshes the same unknown task", () => {
    const refresh = vi.fn();
    const result = { id: "run-1", title: "镜头", durationSec: 5, taskId: "run-1", status: "unknown" as const };
    render(<ResultsPage results={[result]} onGenerate={() => {}} onRefresh={refresh} />);
    expect(screen.getByText(/任务 ID：run-1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /查询原任务/ }));
    expect(refresh).toHaveBeenCalledWith(result);
  });

  it("uses the same sidebar navigation contract on web and desktop", () => {
    const navigate = vi.fn();
    render(<StudioShell active="generate" onNavigate={navigate}><div>页面</div></StudioShell>);
    expect(screen.getByRole("button", { name: "创作" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "画布" }));
    expect(navigate).toHaveBeenCalledWith("canvas");
  });

  it("offers a phone navigation and closes the account drawer after selection", () => {
    const navigate = vi.fn();
    render(<StudioShell mobileNavigation active="generate" onNavigate={navigate} footer={<button type="button">退出登录</button>}>
      <div>页面</div>
    </StudioShell>);
    const phoneNav = within(screen.getByRole("navigation", { name: "手机主导航" }));
    expect(phoneNav.getByRole("button", { name: "创作" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(phoneNav.getByRole("button", { name: "结果" }));
    expect(navigate).toHaveBeenCalledWith("results");
    fireEvent.click(screen.getByRole("button", { name: "打开账号与项目菜单" }));
    expect(screen.getByRole("button", { name: "打开账号与项目菜单" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("complementary", { name: "主导航" })).getByRole("button", { name: "画布" }));
    expect(navigate).toHaveBeenCalledWith("canvas");
    expect(screen.getByRole("button", { name: "打开账号与项目菜单" }).getAttribute("aria-expanded")).toBe("false");
  });
});
