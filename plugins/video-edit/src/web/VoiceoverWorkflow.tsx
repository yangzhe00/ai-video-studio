import { useEffect, useMemo, useRef, useState } from "react";
import type { PreviewView, TtsEstimate, TtsTask, TtsVoice } from "@ai-video/api-contracts";
import { VoiceoverPanel } from "./VoiceoverPanel";
import type { TtsJobView, VoiceAssetView } from "./VoiceoverPanel";
import { audioMixFromDraft, draftFromAudioMix } from "./voice-adapter";
import type { AudioMixView } from "./voice-adapter";

interface Props {
  accountId: string;
  projectId: string;
  scope: "shot" | "episode";
  targetId: string;
  targetRevision: number;
  durationMs: number;
  audioMix: AudioMixView;
  voiceAssets: VoiceAssetView[];
  request: <T>(path: string, method?: string, data?: unknown) => Promise<T>;
  onUpload: (file: File) => Promise<VoiceAssetView>;
  onPickNativeAudio?: () => Promise<VoiceAssetView | null>;
  onTtsAssetReady: (id: string) => Promise<VoiceAssetView>;
  onPreviewAssetReady: (id: string) => Promise<string>;
  onSave: (mix: AudioMixView) => Promise<void>;
  onExport: () => Promise<void>;
  exportBusy?: boolean;
}

function taskKey(accountId: string, projectId: string, scope: "shot" | "episode", targetId: string) {
  return `avs-tts:${accountId}:${projectId}:${scope}:${targetId}`;
}
function readRecovery(key: string): { clientRequestId: string; taskId?: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { clientRequestId?: unknown; taskId?: unknown };
    return typeof parsed.clientRequestId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(parsed.clientRequestId)
      ? { clientRequestId: parsed.clientRequestId, taskId: typeof parsed.taskId === "string" ? parsed.taskId : undefined } : null;
  } catch { return null; }
}

export function VoiceoverWorkflow({ accountId, projectId, scope, targetId, targetRevision, durationMs, audioMix, voiceAssets,
  request, onUpload, onPickNativeAudio, onTtsAssetReady, onPreviewAssetReady, onSave, onExport, exportBusy }: Props) {
  const recoveryKey = taskKey(accountId, projectId, scope, targetId);
  const previewKey = `avs-mix-preview:${accountId}:${projectId}:${scope}:${targetId}:${targetRevision}`;
  const [ttsTask, setTtsTask] = useState<TtsTask | null>(null);
  const [ttsAsset, setTtsAsset] = useState<VoiceAssetView | null>(null);
  const [recovery, setRecovery] = useState(() => readRecovery(recoveryKey));
  const [recoverError, setRecoverError] = useState("");
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [ttsVoices, setTtsVoices] = useState<TtsVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesError, setVoicesError] = useState("");
  const active = useRef(true);
  const submissionInFlight = useRef(false);
  const draft = useMemo(() => draftFromAudioMix(audioMix), [audioMix]);
  const assets = ttsAsset && !voiceAssets.some(item => item.id === ttsAsset.id) ? [...voiceAssets, ttsAsset] : voiceAssets;

  useEffect(() => {
    active.current = true;
    setRecovery(readRecovery(recoveryKey));
    setTtsTask(null); setTtsAsset(null); setRecoverError("");
    return () => { active.current = false; };
  }, [recoveryKey]);

  useEffect(() => {
    let live = true;
    setVoicesLoading(true); setVoicesError("");
    void request<{ voices: TtsVoice[] }>("/tts/voices").then(result => {
      if (live) setTtsVoices(result.voices);
    }).catch(cause => {
      if (live) { setTtsVoices([]); setVoicesError(String(cause)); }
    }).finally(() => { if (live) setVoicesLoading(false); });
    return () => { live = false; };
  }, [accountId]);

  useEffect(() => {
    setPreview(null); setPreviewUrl(""); setPreviewError("");
    const id = localStorage.getItem(previewKey);
    if (!id || !/^[a-zA-Z0-9-]{8,80}$/.test(id)) return;
    let live = true;
    void request<{ preview: PreviewView }>(`/previews/${id}`).then(result => {
      if (live) setPreview(result.preview);
    }).catch(cause => { if (live) setPreviewError(String(cause)); });
    return () => { live = false; };
  }, [previewKey]);

  useEffect(() => {
    if (!preview || !["pending", "running"].includes(preview.state)) return;
    let live = true;
    const timer = window.setInterval(() => {
      void request<{ preview: PreviewView }>(`/previews/${preview.id}`).then(result => {
        if (live) { setPreview(result.preview); setPreviewError(""); }
      }).catch(cause => { if (live) setPreviewError(String(cause)); });
    }, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [preview?.id, preview?.state, previewKey]);

  useEffect(() => {
    if (preview?.state !== "succeeded" || !preview.outputAssetId || previewUrl || preview.revision !== targetRevision) return;
    let live = true;
    void onPreviewAssetReady(preview.outputAssetId).then(url => {
      if (live) { setPreviewUrl(url); setPreviewError(""); }
    }).catch(cause => { if (live) setPreviewError(String(cause)); });
    return () => { live = false; };
  }, [preview?.id, preview?.state, preview?.outputAssetId, preview?.revision, previewUrl, targetRevision]);

  async function refreshTask(clientRequestId?: string | null) {
    const pending = readRecovery(recoveryKey);
    const taskId = ttsTask?.id ?? pending?.taskId;
    const identifier = taskId ?? clientRequestId ?? pending?.clientRequestId;
    if (!identifier) throw new Error("没有可恢复的配音任务");
    const path = taskId ? `/tts/tasks/${taskId}` : `/projects/${projectId}/tts/tasks/by-request/${identifier}`;
    const next = (await request<{ ttsTask: TtsTask }>(path)).ttsTask;
    if (!active.current) return;
    setTtsTask(next); setRecoverError("");
    const remembered = { clientRequestId: pending?.clientRequestId ?? next.clientRequestId, taskId: next.id };
    localStorage.setItem(recoveryKey, JSON.stringify(remembered));
    setRecovery(remembered);
    if (next.state === "succeeded" && next.voiceAssetId) {
      const asset = await onTtsAssetReady(next.voiceAssetId);
      if (active.current) setTtsAsset(asset);
    }
  }

  useEffect(() => {
    if (!recovery || ttsTask || submissionInFlight.current) return;
    void refreshTask(recovery.clientRequestId).catch(cause => { if (active.current) setRecoverError(String(cause)); });
  }, [recoveryKey, recovery?.clientRequestId, ttsTask?.id]);
  useEffect(() => {
    if (!ttsTask || ["succeeded", "failed"].includes(ttsTask.state)) return;
    const timer = window.setInterval(() => { void refreshTask().catch(cause => { if (active.current) setRecoverError(String(cause)); }); }, 3000);
    return () => window.clearInterval(timer);
  }, [ttsTask?.id, ttsTask?.state, recoveryKey]);

  const job: TtsJobView | null = ttsTask ? { id: ttsTask.id,
    state: ttsTask.state === "submitting" ? "running" : ttsTask.state,
    asset: ttsAsset ?? undefined, error: ttsTask.error ?? undefined } : null;
  const currentPreview = preview?.revision === targetRevision ? preview : null;
  const previewView = currentPreview ? { state: currentPreview.state, url: previewUrl || undefined,
    error: (currentPreview.error ?? previewError) || undefined } : null;

  return <><VoiceoverPanel key={`${scope}:${targetId}`} scope={scope} durationMs={durationMs} draft={draft}
    assets={assets} ttsVoices={ttsVoices} voicesLoading={voicesLoading} voicesError={voicesError}
    ttsJob={job} onUpload={onUpload} onPickNativeAudio={onPickNativeAudio}
    onQuoteTts={async (text, voiceId, voiceLanguage, speed) => {
      const estimate = (await request<{ ttsEstimate: TtsEstimate }>(`/projects/${projectId}/tts/estimate`, "POST",
        { text, voiceId, voiceLanguage, speed })).ttsEstimate;
      return { id: estimate.id, amount: estimate.estimatedCost?.amount ?? null,
        currency: estimate.estimatedCost?.currency ?? null };
    }}
    onStartTts={async (text, voiceId, voiceLanguage, speed, estimateId, clientRequestId) => {
      const pending = { clientRequestId };
      submissionInFlight.current = true;
      localStorage.setItem(recoveryKey, JSON.stringify(pending));
      setRecovery(pending);
      try {
        const next = (await request<{ ttsTask: TtsTask }>(`/projects/${projectId}/tts/tasks`, "POST",
          { text, voiceId, voiceLanguage, speed, estimateId, clientRequestId, confirmed: true })).ttsTask;
        localStorage.setItem(recoveryKey, JSON.stringify({ clientRequestId, taskId: next.id }));
        setRecovery({ clientRequestId, taskId: next.id });
        setTtsTask(next);
        return { id: next.id, state: next.state === "submitting" ? "running" : next.state };
      } finally { submissionInFlight.current = false; }
    }}
    onRefreshTts={refreshTask}
    onSave={async value => {
      setPreview(null); setPreviewUrl(""); setPreviewError("");
      await onSave(audioMixFromDraft(value, audioMix));
    }}
    onPreview={async () => {
      const operationId = localStorage.getItem(previewKey) ?? crypto.randomUUID();
      localStorage.setItem(previewKey, operationId);
      const path = scope === "shot" ? `/video-edits/${targetId}/previews`
        : `/projects/${projectId}/episodes/${targetId}/previews`;
      const body = scope === "shot" ? { previewOperationId: operationId, expectedRevision: targetRevision }
        : { previewOperationId: operationId, expectedEpisodeRevision: targetRevision };
      const next = (await request<{ preview: PreviewView }>(path, "POST", body)).preview;
      setPreview(next); setPreviewError(""); setPreviewUrl("");
    }}
    preview={previewView}
    onExport={onExport} exportBusy={exportBusy} />
    {recoverError && <p role="alert" className="video-edit-recovery-error">查询配音任务失败：{recoverError}。请稍后再查，勿重新付费提交。</p>}
    {previewError && <p role="alert" className="video-edit-recovery-error">读取混音预览失败：{previewError}</p>}
  </>;
}
