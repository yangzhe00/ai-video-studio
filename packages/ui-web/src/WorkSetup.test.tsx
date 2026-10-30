import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreationBrief } from "@ai-video/project-core";
import { WorkSetup, suggestedProjectTitle } from "./WorkSetup";
import type { WorkSetupSelection } from "./WorkSetup";

afterEach(cleanup);
const brief: CreationBrief = { id: "brief-123", source: "manual", originalText: "小狗做饭", finalText: "小狗做饭", createdAt: 1, updatedAt: 1 };
const base: WorkSetupSelection = { target: "new", title: "小狗做饭", projectId: "", episodeId: "", mode: null, manualSingleShotConfirmed: false };
const noop = vi.fn();

describe("WorkSetup", () => {
  it("keeps both production modes unselected and requires manual one-shot confirmation", () => {
    const onChange = vi.fn();
    const view = render(<WorkSetup brief={brief} projects={[]} selection={base} onChange={onChange} onFinalTextChange={noop} onSubmit={noop} onBack={noop} />);
    expect(screen.getByRole("button", { name: "创建项目并继续" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "直接生成一个镜头" }));
    const direct = onChange.mock.lastCall![0] as WorkSetupSelection;
    view.rerender(<WorkSetup brief={brief} projects={[]} selection={direct} onChange={onChange} onFinalTextChange={noop} onSubmit={noop} onBack={noop} />);
    expect(screen.getByRole("button", { name: "创建项目并继续" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "我确认这是一段单镜头描述" }));
    const confirmed = onChange.mock.lastCall![0] as WorkSetupSelection;
    view.rerender(<WorkSetup brief={brief} projects={[]} selection={confirmed} onChange={onChange} onFinalTextChange={noop} onSubmit={noop} onBack={noop} />);
    expect(screen.getByRole("button", { name: "创建项目并继续" }).hasAttribute("disabled")).toBe(false);
  });

  it("routes a long script only to canvas without clipping the original", () => {
    const long = { ...brief, originalText: "镜".repeat(2001), finalText: "镜".repeat(2001) };
    const onChange = vi.fn();
    const view = render(<WorkSetup brief={long} projects={[]} selection={base} onChange={onChange} onFinalTextChange={noop} onSubmit={noop} onBack={noop} />);
    expect(screen.getByRole("button", { name: "直接生成一个镜头" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/超过 2000 字不能直接/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "进入画布编排" }));
    view.rerender(<WorkSetup brief={long} projects={[]} selection={onChange.mock.lastCall![0]} onChange={onChange} onFinalTextChange={noop} onSubmit={noop} onBack={noop} />);
    expect(screen.getByRole("button", { name: "创建项目并继续" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("textbox", { name: "最终创作内容" }).textContent).toBe(long.originalText);
  });

  it("does not offer node canvas production on a phone", () => {
    render(<WorkSetup brief={brief} projects={[]} selection={{ ...base, mode: "canvas" }} canvasAvailable={false}
      onChange={noop} onFinalTextChange={noop} onSubmit={noop} onBack={noop} />);
    expect(screen.queryByRole("button", { name: "进入画布编排" })).toBeNull();
    expect(screen.getByText(/手机端可直接生成镜头/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建项目并继续" }).hasAttribute("disabled")).toBe(true);
  });

  it("requires a target episode for an existing project", () => {
    const onChange = vi.fn();
    const choice = { id: "project-123", title: "旧项目", episodes: [{ id: "episode-1", title: "第一集" }] };
    const view = render(<WorkSetup brief={brief} projects={[choice]} selection={base} onChange={onChange} onFinalTextChange={noop} onSubmit={noop} onBack={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "加入已有项目" }));
    view.rerender(<WorkSetup brief={brief} projects={[choice]} selection={onChange.mock.lastCall![0]} onChange={onChange} onFinalTextChange={noop} onSubmit={noop} onBack={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /旧项目/ }));
    expect(onChange.mock.lastCall![0]).toMatchObject({ projectId: "project-123", episodeId: "episode-1" });
  });

  it("suggests a safe twenty-character project title", () => {
    expect(suggestedProjectTitle("  小狗/做饭\\上菜   ")).toBe("小狗-做饭-上菜");
    expect(Array.from(suggestedProjectTitle("🐶".repeat(30)))).toHaveLength(20);
  });
});
