import { useEffect, useRef, useState } from "react";
import type { AgentEditAction, AgentEditSet } from "@ai-video/api-contracts";
import { AgentSuggestionPanel } from "./AgentSuggestionPanel";
import type { EditSuggestionSetView, EditSuggestionView } from "./AgentSuggestionPanel";

export interface AgentEditContext {
  trim?: { startMs: number; endMs: number };
  captions?: { id: string; text: string }[];
  voiceAssetId?: string | null;
  shotIds?: string[];
  shotTitles?: Record<string, string>;
}

interface Props {
  accountId: string;
  projectId: string;
  episodeId: string;
  targetRevision: number;
  context: AgentEditContext;
  request: <T>(path: string, method?: string, data?: unknown) => Promise<T>;
  onApplied: () => Promise<void>;
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;
function describe(action: AgentEditAction, context: AgentEditContext, snapshot?: AgentEditSet["context"]): EditSuggestionView {
  const names = (ids: string[]) => ids.map(id => context.shotTitles?.[id] ?? id).join(" → ");
  const savedEdit = "editId" in action ? snapshot?.edits.find(edit => edit.id === action.editId) : undefined;
  switch (action.type) {
    case "set-trim": return { id: action.id, title: "裁剪镜头", reason: action.reason,
      before: savedEdit ? `${sec(savedEdit.trimStartMs)}–${sec(savedEdit.trimEndMs)}`
        : context.trim ? `${sec(context.trim.startMs)}–${sec(context.trim.endMs)}` : "当前裁剪范围",
      after: `${sec(action.startMs)}–${sec(action.endMs)}` };
    case "reorder-shots": return { id: action.id, title: "调整镜头顺序", reason: action.reason,
      before: names(snapshot?.episode.shotIds ?? context.shotIds ?? []), after: names(action.shotIds) };
    case "upsert-caption": return { id: action.id, title: "修改字幕", reason: action.reason,
      before: (savedEdit ? savedEdit.captions : context.captions)?.find(item => item.id === action.caption.id)?.text ?? "未添加字幕",
      after: `${sec(action.caption.startMs)}–${sec(action.caption.endMs)} · ${action.caption.text}` };
    case "set-voice": return { id: action.id, title: "设置配音", reason: action.reason,
      before: savedEdit ? (savedEdit.voiceClips[0] ? `配音素材 ${savedEdit.voiceClips[0].assetId}` : "无配音")
        : context.voiceAssetId ? `配音素材 ${context.voiceAssetId}` : "无配音",
      after: `素材 ${action.assetId} · ${sec(action.startMs)} 开始 · 音量 ${Math.round(action.volume * 100)}%` };
  }
}

function recoveryKey(accountId: string, projectId: string, episodeId: string) {
  return `avs-agent-edit:${accountId}:${projectId}:${episodeId}`;
}
function readOriginalContext(key: string): AgentEditContext | null {
  try {
    const value = localStorage.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as AgentEditContext : null;
  } catch { return null; }
}

export function AgentEditWorkflow({ accountId, projectId, episodeId, context, request, onApplied }: Props) {
  const key = recoveryKey(accountId, projectId, episodeId);
  const contextKey = `${key}:original-context`;
  const [set, setSet] = useState<AgentEditSet | null>(null);
  const [originalContext, setOriginalContext] = useState(() => readOriginalContext(contextKey));
  const [localState, setLocalState] = useState<"applied" | "conflict" | null>(null);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState(() => localStorage.getItem(key));
  const confirmRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const submissionInFlight = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    setSet(null); setLocalState(null); setError("");
    setPendingId(localStorage.getItem(key));
    setOriginalContext(readOriginalContext(contextKey));
    return () => { live.current = false; };
  }, [key]);

  async function refresh(id = set?.id ?? pendingId) {
    if (!id) return;
    const path = id.startsWith("request:")
      ? `/projects/${projectId}/agent-edits/by-request/${id.slice("request:".length)}`
      : `/agent-edits/${id}`;
    const next = (await request<{ agentEdit: AgentEditSet }>(path)).agentEdit;
    if (live.current) {
      setSet(next); setPendingId(next.id); localStorage.setItem(key, next.id); setError("");
      if (next.confirmedActionIds.length) setLocalState("applied");
    }
  }

  useEffect(() => {
    if (!pendingId || set || submissionInFlight.current) return;
    void refresh(pendingId).catch(cause => { if (live.current) setError(String(cause)); });
  }, [key, pendingId, set?.id]);
  useEffect(() => {
    if (!set || !["pending", "generating"].includes(set.state)) return;
    const timer = window.setInterval(() => { void refresh().catch(cause => { if (live.current) setError(String(cause)); }); }, 3000);
    return () => window.clearInterval(timer);
  }, [set?.id, set?.state]);

  const view: EditSuggestionSetView | null = set && set.state === "ready" ? { id: set.id, targetRevision: set.revision,
    state: localState ?? (set.state === "ready" ? "ready" : "conflict"),
    suggestions: set.actions.map(action => describe(action, originalContext ?? context, set.context)) } : null;

  return <AgentSuggestionPanel set={view} loading={set?.state === "pending" || set?.state === "generating"}
    error={error || (set?.state === "failed" ? set.error ?? "建议生成失败" : undefined)}
    onGenerate={async instruction => {
      const clientRequestId = crypto.randomUUID();
      submissionInFlight.current = true;
      const frozenContext = structuredClone(context);
      localStorage.setItem(contextKey, JSON.stringify(frozenContext));
      setOriginalContext(frozenContext);
      localStorage.setItem(key, `request:${clientRequestId}`);
      setPendingId(`request:${clientRequestId}`); setSet(null); setError(""); setLocalState(null);
      try {
        const next = (await request<{ agentEdit: AgentEditSet }>(`/projects/${projectId}/agent-edits`, "POST",
          { clientRequestId, episodeId, instruction })).agentEdit;
        if (live.current) { setSet(next); setPendingId(next.id); localStorage.setItem(key, next.id); }
      } finally { submissionInFlight.current = false; }
    }}
    onRefresh={() => refresh()}
    onConfirm={async (setId, acceptedActionIds, expectedRevision) => {
      const fingerprint = `${setId}:${acceptedActionIds.join(",")}:${expectedRevision}`;
      if (confirmRequest.current?.fingerprint !== fingerprint) confirmRequest.current = { fingerprint, id: crypto.randomUUID() };
      try {
        await request<{ agentEdit: AgentEditSet }>(`/agent-edits/${setId}/confirm`, "POST",
          { clientRequestId: confirmRequest.current.id, acceptedActionIds, expectedRevision });
        await onApplied();
        if (live.current) setLocalState("applied");
      } catch (cause) {
        if (/冲突|版本|revision/i.test(String(cause)) && live.current) setLocalState("conflict");
        throw cause;
      }
    }} />;
}
