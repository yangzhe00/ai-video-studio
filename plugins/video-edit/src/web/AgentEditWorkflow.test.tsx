import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentEditWorkflow } from "./AgentEditWorkflow";

afterEach(() => { cleanup(); localStorage.clear(); });

const set = { id: "suggestion-set-1", projectId: "project-1", episodeId: "episode-1",
  clientRequestId: "request-1", revision: 1 as const, state: "ready", confirmedActionIds: [], error: null, createdAt: 1, updatedAt: 1,
  context: { episode: { revision: 1, shotIds: ["shot-1"] }, edits: [{ id: "edit-1", shotId: "shot-1", revision: 4,
    trimStartMs: 0, trimEndMs: 5000, captions: [], voiceClips: [] }] },
  actions: [{ id: "action-1", type: "set-trim", editId: "edit-1", expectedRevision: 4,
    startMs: 1000, endMs: 5000, reason: "开头有停顿" }] };

describe("AgentEditWorkflow", () => {
  it("shows a concrete diff and only sends accepted actions after confirmation", async () => {
    const call = vi.fn(async (path: string, _method?: string, _data?: unknown) => path.endsWith("/confirm") ? { agentEdit: set } : { agentEdit: set });
    const applied = vi.fn().mockResolvedValue(undefined);
    const view = render(<AgentEditWorkflow accountId="account-1" projectId="project-1" episodeId="episode-1" targetRevision={4}
      context={{ trim: { startMs: 0, endMs: 5000 } }} request={async <T,>(path: string, method?: string, data?: unknown) =>
        await call(path, method, data) as T} onApplied={applied} />);
    fireEvent.change(screen.getByLabelText("剪辑建议要求"), { target: { value: "剪掉停顿" } });
    fireEvent.click(screen.getByRole("button", { name: "生成建议" }));
    await screen.findByText("0.0 秒–5.0 秒");
    expect(applied).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "预览所选 1 条" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "预览所选 1 条" }));
    expect(applied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认应用所选建议" }));
    await waitFor(() => expect(applied).toHaveBeenCalledOnce());
    expect(call).toHaveBeenCalledWith("/agent-edits/suggestion-set-1/confirm", "POST",
      expect.objectContaining({ acceptedActionIds: ["action-1"], expectedRevision: 1 }));
    view.rerender(<AgentEditWorkflow accountId="account-1" projectId="project-1" episodeId="episode-1" targetRevision={5}
      context={{ trim: { startMs: 1000, endMs: 5000 } }} request={async <T,>(path: string, method?: string, data?: unknown) =>
        await call(path, method, data) as T} onApplied={applied} />);
    expect(screen.getByText("0.0 秒–5.0 秒")).toBeTruthy();
  });

  it("recovers a lost create response by client request ID", async () => {
    localStorage.setItem("avs-agent-edit:account-1:project-1:episode-1", "request:request-12345678");
    const call = vi.fn(async (_path: string, _method?: string, _data?: unknown) => ({ agentEdit: set }));
    render(<AgentEditWorkflow accountId="account-1" projectId="project-1" episodeId="episode-1" targetRevision={4}
      context={{ trim: { startMs: 1000, endMs: 5000 } }} request={async <T,>(path: string, method?: string, data?: unknown) =>
        await call(path, method, data) as T} onApplied={vi.fn()} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith(
      "/projects/project-1/agent-edits/by-request/request-12345678", undefined, undefined));
    expect(await screen.findByText("开头有停顿")).toBeTruthy();
    expect(screen.getByText("0.0 秒–5.0 秒")).toBeTruthy();
  });
});
