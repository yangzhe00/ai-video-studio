import { useEffect, useRef, useState } from "react";
import type { TtsEstimate, TtsTask, TtsVoice } from "@ai-video/api-contracts";

interface Props {
  accountId: string;
  projectId: string;
  episodeId: string;
  request: <T>(path: string, method?: string, data?: unknown) => Promise<T>;
  onAssetReady: (assetId: string) => Promise<void>;
}

interface Recovery { clientRequestId: string; taskId?: string }
function readRecovery(key: string): Recovery | null {
  try {
    const value = localStorage.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as Recovery;
    return /^[a-zA-Z0-9-]{8,80}$/.test(parsed.clientRequestId) ? parsed : null;
  } catch { return null; }
}

/** A cost-gated TTS asset creator. Completion only refreshes the asset library. */
export function TtsLibraryPanel({ accountId, projectId, episodeId, request, onAssetReady }: Props) {
  const key = `avs-episode-tts:${accountId}:${projectId}:${episodeId}`;
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [voicesError, setVoicesError] = useState("");
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [speed, setSpeed] = useState("1.0");
  const [estimate, setEstimate] = useState<TtsEstimate | null>(null);
  const [estimateFingerprint, setEstimateFingerprint] = useState("");
  const [task, setTask] = useState<TtsTask | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(() => readRecovery(key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fetchedAsset = useRef<string | null>(null);
  const pendingSubmit = useRef(false);
  const chosen = voices.find(item => item.id === voiceId);
  const fingerprint = `${text.trim()}\n${voiceId}\n${speed}`;
  const validEstimate = estimateFingerprint === fingerprint && estimate && estimate.expiresAt > Date.now() ? estimate : null;

  useEffect(() => {
    let live = true;
    void request<{ voices: TtsVoice[] }>("/tts/voices").then(result => {
      if (live) { setVoices(result.voices); setVoiceId(current => current || result.voices[0]?.id || ""); }
    }).catch(cause => { if (live) setVoicesError(String(cause)); });
    return () => { live = false; };
  }, [accountId]);
  useEffect(() => { setRecovery(readRecovery(key)); setTask(null); fetchedAsset.current = null; }, [key]);

  async function refresh(nextRecovery = recovery) {
    if (!nextRecovery) return;
    const path = nextRecovery.taskId ? `/tts/tasks/${nextRecovery.taskId}`
      : `/projects/${projectId}/tts/tasks/by-request/${nextRecovery.clientRequestId}`;
    const next = (await request<{ ttsTask: TtsTask }>(path)).ttsTask;
    const remembered = { clientRequestId: nextRecovery.clientRequestId, taskId: next.id };
    localStorage.setItem(key, JSON.stringify(remembered));
    setRecovery(remembered); setTask(next); setError("");
    if (next.state === "succeeded" && next.voiceAssetId && fetchedAsset.current !== next.voiceAssetId) {
      await onAssetReady(next.voiceAssetId);
      fetchedAsset.current = next.voiceAssetId;
    }
  }
  useEffect(() => {
    if (!recovery || pendingSubmit.current) return;
    let live = true;
    const poll = () => { void refresh(recovery).catch(cause => { if (live) setError(`查询原配音任务失败：${String(cause)}`); }); };
    poll();
    if (task && ["succeeded", "failed"].includes(task.state)) return () => { live = false; };
    const timer = window.setInterval(poll, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [key, recovery?.clientRequestId, recovery?.taskId, task?.state]);

  async function quote() {
    if (!chosen || !text.trim()) return;
    setBusy(true); setError("");
    try {
      const result = (await request<{ ttsEstimate: TtsEstimate }>(`/projects/${projectId}/tts/estimate`, "POST",
        { text: text.trim(), voiceId: chosen.id, voiceLanguage: chosen.language, speed: Number(speed) })).ttsEstimate;
      setEstimate(result); setEstimateFingerprint(fingerprint);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!validEstimate || !chosen || pendingSubmit.current || recovery && (!task || !["succeeded", "failed"].includes(task.state))) return;
    const clientRequestId = crypto.randomUUID();
    const nextRecovery = { clientRequestId };
    pendingSubmit.current = true;
    localStorage.setItem(key, JSON.stringify(nextRecovery));
    setRecovery(nextRecovery); setBusy(true); setError("");
    try {
      const next = (await request<{ ttsTask: TtsTask }>(`/projects/${projectId}/tts/tasks`, "POST", {
        text: text.trim(), voiceId: chosen.id, voiceLanguage: chosen.language, speed: Number(speed),
        estimateId: validEstimate.id, clientRequestId, confirmed: true,
      })).ttsTask;
      const saved = { clientRequestId, taskId: next.id };
      localStorage.setItem(key, JSON.stringify(saved)); setRecovery(saved); setTask(next);
      if (next.state === "succeeded" && next.voiceAssetId) {
        await onAssetReady(next.voiceAssetId); fetchedAsset.current = next.voiceAssetId;
      }
    } catch (cause) { setError(`提交结果待确认：${String(cause)}。请查询原任务，不要再次付费提交。`); }
    finally { pendingSubmit.current = false; setBusy(false); }
  }

  return <section className="episode-editor-tts" aria-label="文字生成配音"><h3>文字生成配音</h3>
    <label>配音文案<textarea aria-label="配音文案" maxLength={1000} value={text} onChange={event => setText(event.target.value)} /></label>
    <label>音色<select aria-label="配音音色" value={voiceId} onChange={event => setVoiceId(event.target.value)}>
      {voices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}</select></label>
    <label>语速<select aria-label="配音语速" value={speed} onChange={event => setSpeed(event.target.value)}>
      {["0.8", "0.9", "1.0", "1.1", "1.2", "1.5", "2.0"].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
    {!voices.length && <p role="status">当前没有可用配音音色。可上传自己的录音继续剪辑。{voicesError}</p>}
    <button type="button" disabled={busy || !chosen || !text.trim()} onClick={() => void quote()}>查看费用说明</button>
    {validEstimate && <div className="episode-editor-tts-quote" role="status"><p>预计费用：{validEstimate.estimatedCost
      ? `${validEstimate.estimatedCost.amount} ${validEstimate.estimatedCost.currency}` : "按供应商实际用量结算"}。实际费用以完成后记录为准。</p>
      <button type="button" className="primary" disabled={busy || Boolean(recovery && (!task || !["succeeded", "failed"].includes(task.state)))}
        onClick={() => void submit()}>确认费用并生成配音</button></div>}
    {recovery && <div role="status">任务 {task?.state ?? "待查询"} · ID {task?.id ?? recovery.clientRequestId}
      <button type="button" onClick={() => void refresh().catch(cause => setError(String(cause)))}>查询原任务</button>
      {task?.state === "succeeded" && <p>配音已进入素材库，请手动放入时间线。</p>}</div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
