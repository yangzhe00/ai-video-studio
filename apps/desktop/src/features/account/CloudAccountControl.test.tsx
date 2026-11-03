import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudAccountControl } from "./CloudAccountControl";
import { cloudRequest } from "../../lib/cloud";

vi.mock("../../lib/cloud", () => ({ cloudRequest: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("desktop cloud account entry", () => {
  it("keeps a long email in the account card without stretching the titlebar", async () => {
    const email = "qa.timeline.20261102.0955@example.test";
    const onChange = vi.fn();
    render(<CloudAccountControl account={{ id: "qa", email, demo_quota: 6, demo_reserved: 1, demo_used: 2 }} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: `云端账号，已登录 ${email}` });
    expect(trigger.querySelector(".cloud-account-avatar")?.textContent).toContain("Q");
    expect(trigger.textContent).not.toContain("云端账号");
    expect(trigger.textContent).not.toContain(email);
    fireEvent.click(trigger);
    const card = screen.getByRole("dialog", { name: "云端账号" });
    expect(within(card).getByText(email)).toBeTruthy();
    expect(within(card).getByText("3 次")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "云端账号" })).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("dialog", { name: "云端账号" })).getByRole("button", { name: "退出登录" }));
    await waitFor(() => expect(cloudRequest).toHaveBeenCalledWith("/auth/logout", "POST"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("preserves the login entry and closes the form with Escape", () => {
    render(<CloudAccountControl account={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "登录云端" }));
    expect(screen.getByRole("dialog", { name: "云端账号" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "云端邮箱" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "云端账号" })).toBeNull();
  });
});
