import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceSettings } from "./ServiceSettings";

const mocks = vi.hoisted(() => ({ status: vi.fn(), set: vi.fn(), remove: vi.fn() }));
vi.mock("../../lib/native", () => ({ providerKeyStatus: mocks.status, setProviderKey: mocks.set, removeProviderKey: mocks.remove }));

describe("ServiceSettings", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it("saves to native secure storage and never displays the key again", async () => {
    mocks.status.mockResolvedValueOnce([{ provider: "hedra", configured: false }]).mockResolvedValueOnce([{ provider: "hedra", configured: true }]);
    mocks.set.mockResolvedValue(undefined);
    render(<ServiceSettings />);
    await waitFor(() => expect(screen.getAllByText("未配置").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "test-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存密钥" }));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith("hedra", "test-secret"));
    await waitFor(() => expect(screen.getByText("已配置")).toBeTruthy());
    expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("test-secret")).toBeNull();
  });
});
