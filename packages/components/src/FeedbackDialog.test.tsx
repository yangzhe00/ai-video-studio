import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FeedbackDialog, useFeedbackDialog } from "./FeedbackDialog";
import { feedbackMessages } from "./feedback";

afterEach(cleanup);

function Harness({ onResult }: { onResult: (value: boolean | string | null) => void }) {
  const feedback = useFeedbackDialog();
  return <>
    <button type="button" onClick={() => void feedback.confirm(feedbackMessages.warning.deleteNode).then(onResult)}>删除</button>
    <button type="button" onClick={() => void feedback.input(feedbackMessages.info.newEpisode, "第 2 集").then(onResult)}>新建</button>
    <button type="button" onClick={() => void feedback.show(feedbackMessages.failure.copyShareAddress)}>复制失败</button>
    {feedback.dialog}
  </>;
}

describe("shared feedback dialog", () => {
  it("replaces browser confirmation with an accessible warning and safe cancel", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    const dialog = screen.getByRole("alertdialog", { name: "删除这个节点？" });
    expect(dialog.textContent).toContain("断开相关连接");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "取消" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("requires a nonblank episode name and returns the trimmed value", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    const input = screen.getByRole("textbox", { name: "分集名称" });
    expect(input).toHaveProperty("value", "第 2 集");
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "创建分集" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(input, { target: { value: "  新一集  " } });
    fireEvent.click(screen.getByRole("button", { name: "创建分集" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("新一集"));
  });

  it("shows failure information with the shared dialog component", () => {
    render(<Harness onResult={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "复制失败" }));
    expect(screen.getByRole("alertdialog", { name: "复制失败" }).textContent).toContain("手动选择并复制");
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("renders the controlled component without a request", () => {
    render(<FeedbackDialog request={null} onResolve={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
