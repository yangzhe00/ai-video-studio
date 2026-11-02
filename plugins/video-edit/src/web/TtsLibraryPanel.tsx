import { useEffect, useRef, useState } from "react";
import type { TtsEstimate, TtsTask, TtsVoice, TtsVoicesResponse } from "@ai-video/api-contracts";

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

/** A cost-gated narration asset creator. Completion only refreshes the voice library. */
export function TtsLibraryPanel({ accountId, projectId, episodeId, request, onAssetReady }: Props) {
  const key = `avs-episode-tts:${accountId}:${projectId}:${episodeId}`;
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [voicesError, setVoicesError] = useState("");
  const [availability, setAvailability] = useState("");
  const [availabilityMessage, setAvailabilityMessage] = useState("");
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
  const chineseVoices = voices.filter(item => item.language === "zh");
  const chosen = chineseVoices.find(item => item.id === voiceId);
  const fingerprint = `${text.trim()}\n${voiceId}\n${speed}`;
  const validEstimate = estimateFingerprint === fingerprint && estimate && estimate.expiresAt > Date.now() ? estimate : null;

  useEffect(() => {
    let live = true;
    setLoadingVoices(true); setVoicesError("");
    void request<TtsVoicesResponse>("/tts/voices").then(result => {
      if (live) {
        const available = result.voices.filter(voice => voice.language === "zh");
        setVoices(result.voices);
        setAvailability(result.availability ?? ""); setAvailabilityMessage(result.message ?? "");
        setVoiceId(current => available.some(voice => voice.id === current) ? current : available[0]?.id || "");
      }
    }).catch(cause => { if (live) setVoicesError(String(cause)); })
      .finally(() => { if (live) setLoadingVoices(false); });
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

  return <section className="episode-editor-tts" aria-label="文字生成旁白"><p>生成后进入配音素材库，由你决定放到时间线哪里。</p>
    <label>旁白文案<textarea aria-label="旁白文案" maxLength={1000} value={text} onChange={event => setText(event.target.value)} placeholder="输入 1–1000 字中文旁白" /></label>
    <label>中文音色<select aria-label="旁白音色" value={voiceId} disabled={!chineseVoices.length || Boolean(availability && availability !== "account_verified")} onChange={event => setVoiceId(event.target.value)}>
      {chineseVoices.length ? chineseVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>) : <option value="">暂无可用中文音色</option>}</select></label>
    <label>语速<select aria-label="旁白语速" value={speed} onChange={event => setSpeed(event.target.value)}>
      {["0.8", "0.9", "1.0", "1.1", "1.2", "1.5", "2.0"].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
    {loadingVoices ? <p role="status">正在读取中文音色…</p> : (!chineseVoices.length || availability && availability !== "account_verified") && <p role="status">{voicesError
      ? /401|403|权限|auth|credential|region/i.test(voicesError) ? "当前账号或地区没有旁白服务权限，请联系管理员；也可上传录音继续剪辑。"
        : `读取旁白服务失败：${voicesError}。可上传录音继续剪辑。`
      : availabilityMessage ? `${availabilityMessage}。可上传录音继续剪辑。`
      : voices.length ? "当前服务没有可用中文音色，请联系管理员配置已验证的中文音色；也可上传录音继续剪辑。"
        : "文字生成旁白服务未配置或暂无可用中文音色，请联系管理员；也可上传录音继续剪辑。"}</p>}
    <button type="button" disabled={busy || !chosen || !text.trim() || Boolean(availability && availability !== "account_verified")} onClick={() => void quote()}>查看费用说明</button>
    {validEstimate && <div className="episode-editor-tts-quote" role="status"><p>预计费用：{validEstimate.estimatedCost
      ? `${validEstimate.estimatedCost.amount} ${validEstimate.estimatedCost.currency}` : "按供应商实际用量结算"}。实际费用以完成后记录为准。</p>
      <button type="button" className="primary" disabled={busy || Boolean(recovery && (!task || !["succeeded", "failed"].includes(task.state)))}
        onClick={() => void submit()}>确认费用并生成旁白</button></div>}
    {recovery && <div role="status">任务 {task?.state ?? "待查询"} · ID {task?.id ?? recovery.clientRequestId}
      <button type="button" onClick={() => void refresh().catch(cause => setError(String(cause)))}>查询原任务</button>
      {task?.state === "succeeded" && <p>旁白已进入配音素材库，请点击“加入配音轨”选择落点。</p>}
      {task?.state === "failed" && <p>旁白生成失败：{task.error || "服务端未返回具体原因"}。这次任务不会产生可用音频。</p>}</div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
