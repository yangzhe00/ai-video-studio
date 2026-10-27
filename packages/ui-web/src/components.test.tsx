import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button, Panel, StatusBadge } from "./index";

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
});
