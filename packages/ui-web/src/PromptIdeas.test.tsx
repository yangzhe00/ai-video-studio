import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptIdeas } from "./PromptIdeas";
import type { PromptIdeaSet } from "./PromptIdeas";

afterEach(() => { cleanup(); window.sessionStorage.clear(); });

const ready: PromptIdeaSet = {
  id: "idea-1", input: "小狗做饭", state: "ready", variants: [
    { id: "a", title: "温暖", description: "温暖画面", prompt: "小狗端上晚餐" },
    { id: "b", title: "轻快", description: "活泼画面", prompt: "小狗跳着端菜" },
    { id: "c", title: "电影", description: "电影画面", prompt: "小狗在光影中端菜" },
  ],
};

describe("PromptIdeas", () => {
  it("requests one idea set, edits one of three variants, then continues with the saved snapshot", async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const onSelect = vi.fn().mockResolvedValue({ ...ready, selectedVariantId: "b", editedPrompt: "小狗轻快地端菜" });
    const onContinue = vi.fn();
    const props = { requestScope: "test-account", onRequest, onSelect, onContinue, onReload: vi.fn().mockResolvedValue(undefined) };
    const view = render(<PromptIdeas {...props} ideaSet={null} />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗做饭" } });
    fireEvent.click(screen.getByRole("button", { name: "让 Agent 给我 3 个方向" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith("小狗做饭", expect.any(String)));
    view.rerender(<PromptIdeas {...props} ideaSet={{ ...ready, clientRequestId: onRequest.mock.calls[0][1] }} />);
    expect(screen.getAllByRole("button", { name: /方向 [123]/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /方向 2/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "最终镜头提示词" }), { target: { value: "小狗轻快地端菜" } });
    fireEvent.click(screen.getByRole("button", { name: "用这条灵感开始" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("idea-1", "b", "小狗轻快地端菜"));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ selectedVariantId: "b", editedPrompt: "小狗轻快地端菜" }));
  });

  it("queries an uncertain request without creating a new round", () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const onReload = vi.fn().mockResolvedValue(undefined);
    render(<PromptIdeas requestScope="test-account" ideaSet={{ ...ready, state: "unknown", variants: [] }} onRequest={onRequest}
      onSelect={vi.fn()} onContinue={vi.fn()} onReload={onReload} />);
    fireEvent.click(screen.getByRole("button", { name: "查询原请求" }));
    expect(onReload).toHaveBeenCalledWith("idea-1");
    expect(onRequest).not.toHaveBeenCalled();
    expect(screen.getByText(/不会自动再次提交/)).toBeTruthy();
  });

  it("expires old choices after the original idea changes and shows a persisted model failure", () => {
    const props = { requestScope: "test-account", onRequest: vi.fn().mockResolvedValue(undefined), onSelect: vi.fn(), onContinue: vi.fn(), onReload: vi.fn() };
    const view = render(<PromptIdeas ideaSet={ready} {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小猫做饭" } });
    expect(screen.getByText(/旧的三版已过期/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /方向 1/ })).toBeNull();
    view.rerender(<PromptIdeas ideaSet={{ ...ready, id: "idea-2", state: "failed", error: "灵感服务未配置", variants: [] }} {...props} />);
    expect(screen.getByRole("alert").textContent).toContain("灵感服务未配置");
  });

  it("keeps the typed idea available for manual creation after a failed model request", async () => {
    const onManual = vi.fn();
    const onRequest = vi.fn().mockResolvedValue(undefined);
    render(<PromptIdeas requestScope="test-account" ideaSet={{ ...ready, state: "failed", error: "灵感服务未配置", variants: [] }}
      onRequest={onRequest} onSelect={vi.fn()} onContinue={vi.fn()} onReload={vi.fn()} onManual={onManual} />);
    fireEvent.click(screen.getByRole("button", { name: "用我的内容开始" }));
    expect(onManual).toHaveBeenCalledWith("小狗做饭");
    fireEvent.click(screen.getByRole("button", { name: "再给我 3 个方向" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith("小狗做饭", expect.any(String)));
  });

  it("reuses the same request ID after a lost response and after remount", async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const props = { requestScope: "test-account", ideaSet: null, onRequest,
      onSelect: vi.fn(), onContinue: vi.fn(), onReload: vi.fn() };
    const first = render(<PromptIdeas {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小狗做饭" } });
    fireEvent.click(screen.getByRole("button", { name: "让 Agent 给我 3 个方向" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(1));
    const firstId = onRequest.mock.calls[0][1];
    first.unmount();
    render(<PromptIdeas {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "查询原请求" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(2));
    expect(onRequest.mock.calls[1][1]).toBe(firstId);
    fireEvent.click(screen.getByRole("button", { name: "另起一轮" }));
    fireEvent.click(screen.getByRole("button", { name: "让 Agent 给我 3 个方向" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(3));
    expect(onRequest.mock.calls[2][1]).not.toBe(firstId);
  });

  it("keeps a lost-response input through reload when the server list still shows an older idea", async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const props = { requestScope: "test-account", onRequest,
      onSelect: vi.fn(), onContinue: vi.fn(), onReload: vi.fn() };
    const first = render(<PromptIdeas {...props} ideaSet={ready} />);
    fireEvent.change(screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }), { target: { value: "小猫做饭" } });
    fireEvent.click(screen.getByRole("button", { name: "让 Agent 给我 3 个方向" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(1));
    const requestId = onRequest.mock.calls[0][1];
    first.unmount();
    const second = render(<PromptIdeas {...props} ideaSet={null} />);
    expect((screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }) as HTMLTextAreaElement).value).toBe("小猫做饭");
    second.rerender(<PromptIdeas {...props} ideaSet={ready} />);
    expect((screen.getByRole("textbox", { name: "写下关键词、提示词或剧本" }) as HTMLTextAreaElement).value).toBe("小猫做饭");
    expect(screen.queryByRole("button", { name: /方向 1/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查询原请求" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(2));
    expect(onRequest.mock.calls[1][1]).toBe(requestId);
  });

  it("does not offer an older three-card set while another round with the same words is unresolved", async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const props = { requestScope: "test-account", onRequest, onSelect: vi.fn(), onContinue: vi.fn(), onReload: vi.fn() };
    const view = render(<PromptIdeas {...props} ideaSet={{ ...ready, clientRequestId: "older-request" }} />);
    fireEvent.click(screen.getByRole("button", { name: "再给我 3 个方向" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/旧的三版暂不可选/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /方向 1/ })).toBeNull();
    view.rerender(<PromptIdeas {...props} ideaSet={{ ...ready, id: "idea-2", clientRequestId: onRequest.mock.calls[0][1] }} />);
    expect(screen.getAllByRole("button", { name: /方向 [123]/ })).toHaveLength(3);
  });

  it("keeps an edited variant when switching to and back from a recent idea", () => {
    const other = { ...ready, id: "idea-2", input: "小猫喝汤" };
    const props = { requestScope: "test-account", recentSets: [ready, other], onRequest: vi.fn(), onSelect: vi.fn(), onContinue: vi.fn(), onReload: vi.fn() };
    const view = render(<PromptIdeas {...props} ideaSet={ready} />);
    fireEvent.click(screen.getByRole("button", { name: /方向 1/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "最终镜头提示词" }), { target: { value: "我修改过的镜头" } });
    fireEvent.click(screen.getByRole("button", { name: /小猫喝汤/ }));
    view.rerender(<PromptIdeas {...props} ideaSet={other} />);
    fireEvent.click(screen.getByRole("button", { name: /小狗做饭/ }));
    view.rerender(<PromptIdeas {...props} ideaSet={ready} />);
    expect((screen.getByRole("textbox", { name: "最终镜头提示词" }) as HTMLTextAreaElement).value).toBe("我修改过的镜头");
  });
});
