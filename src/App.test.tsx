import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App shell", () => {
  it("offers creating and opening a project without claiming an export", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /新建项目/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /打开项目/ })).toBeTruthy();
    expect(screen.queryByText(/导出完成/)).toBeNull();
  });
});
