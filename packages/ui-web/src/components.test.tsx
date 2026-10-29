import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button, Panel, StatusBadge, ThemeProvider, ThemeToggle } from "./index";

afterEach(cleanup);

describe("shared editor controls", () => {
  it("keeps disabled actions unavailable to users", () => {
    render(<Button disabled>导出</Button>);
    expect((screen.getByRole("button", { name: "导出" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("exposes panel titles as headings", () => {
    render(<Panel title="素材库">内容</Panel>);
    expect(screen.getByRole("heading", { name: "素材库" })).toBeDefined();
  });

  it("preserves readable status text", () => {
    render(<StatusBadge tone="success">已保存</StatusBadge>);
    expect(screen.getByText("已保存")).toBeDefined();
  });

  it("switches the global skin without clearing form input", () => {
    window.localStorage.removeItem("ai-video-studio:skin");
    render(<ThemeProvider><ThemeToggle /><input aria-label="镜头描述" defaultValue="小狗在厨房洗菜" /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "切换深色" }));
    expect(document.documentElement.dataset.skin).toBe("cyan-night");
    expect((screen.getByRole("textbox", { name: "镜头描述" }) as HTMLInputElement).value).toBe("小狗在厨房洗菜");
    expect(window.localStorage.getItem("ai-video-studio:skin")).toBe("cyan-night");
  });
});
