import { useEffect, useRef, useState } from "react";

export interface VoiceAssetView { id: string; name: string; durationMs: number; url: string }
export interface VoiceDraftView {
  voiceAssetId: string | null;
  startMs: number;
  trimStartMs: number;
  trimEndMs: number;
  voiceVolume: number;
  sourceVolume: number;
  musicVolume: number;
}
export interface TtsVoiceView { id: string; label: string; language: "zh" | "en" }
export interface TtsQuoteView { id: string; amount: number | null; currency: string | null; description?: string }
export interface TtsJobView { id: string; state: "pending" | "running" | "succeeded" | "failed" | "unknown"; asset?: VoiceAssetView; error?: string }
export interface MixPreviewView { state: "pending" | "running" | "succeeded" | "failed"; url?: string; error?: string }

export interface VoiceoverPanelProps {
  scope: "shot" | "episode";
  durationMs: number;
  draft: VoiceDraftView;
  assets: VoiceAssetView[];
  ttsVoices: TtsVoiceView[];
  voicesLoading?: boolean;
  voicesError?: string;
  ttsJob?: TtsJobView | null;
  onUpload: (file: File) => Promise<VoiceAssetView>;
  onPickNativeAudio?: () => Promise<VoiceAssetView | null>;
  onQuoteTts: (text: string, voiceId: string, language: "zh" | "en", speed: number) => Promise<TtsQuoteView>;
  onStartTts: (text: string, voiceId: string, language: "zh" | "en", speed: number,
    quoteId: string, clientRequestId: string) => Promise<TtsJobView>;
  onRefreshTts?: (clientRequestId: string | null) => Promise<void>;
  onSave: (draft: VoiceDraftView) => Promise<void>;
  onPreview?: () => Promise<void>;
  preview?: MixPreviewView | null;
  onExport: () => Promise<void>;
  exportBusy?: boolean;
}

const toSec = (ms: number) => (ms / 1000).toFixed(1);
const toMs = (value: string) => Math.round(Number(value) * 1000);
const percent = (value: number) => String(Math.round(value * 100));
const allowedAudioTypes = new Set(["", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/m4a"]);

export function VoiceoverPanel({ scope, durationMs, draft, assets, ttsVoices, voicesLoading = false, voicesError, ttsJob, onUpload, onPickNativeAudio, onQuoteTts,
  onStartTts, onRefreshTts, onSave, onPreview, preview, onExport, exportBusy = false }: VoiceoverPanelProps) {
  const [local, setLocal] = useState(draft);
  const [uploaded, setUploaded] = useState<VoiceAssetView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(true);
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [speed, setSpeed] = useState(1);
  const [quote, setQuote] = useState<TtsQuoteView | null>(null);
  const [quoteFor, setQuoteFor] = useState("");
  const [uncertainSubmit, setUncertainSubmit] = useState(false);
  const requestId = useRef<string | null>(null);
  const lock = useRef(false);
  const allAssets = uploaded && !assets.some(asset => asset.id === uploaded.id) ? [...assets, uploaded] : assets;
  const selected = allAssets.find(asset => asset.id === local.voiceAssetId);
  const availableVoices = ttsVoices.filter(voice => voice.language === language);
  const fingerprint = `${voiceId}\n${language}\n${speed}\n${text.trim()}`;
  const validQuote = quote && quoteFor === fingerprint ? quote : null;
  const ttsRunning = ttsJob?.state === "pending" || ttsJob?.state === "running" || ttsJob?.state === "unknown";
  const draftValid = Number.isSafeInteger(local.startMs) && local.startMs >= 0 && local.startMs < durationMs &&
    (!selected || (Number.isSafeInteger(local.trimStartMs) && Number.isSafeInteger(local.trimEndMs) &&
      local.trimStartMs >= 0 && local.trimStartMs < local.trimEndMs && local.trimEndMs <= selected.durationMs &&
      local.startMs + local.trimEndMs - local.trimStartMs <= durationMs)) &&
    [local.voiceVolume, local.sourceVolume, local.musicVolume].every(value => Number.isFinite(value) && value >= 0 && value <= 2);

  const draftKey = JSON.stringify(draft);
  useEffect(() => { setLocal(draft); setSaved(true); }, [draftKey]);
  useEffect(() => {
    if (!ttsVoices.length) { setVoiceId(""); return; }
    if (!availableVoices.length) {
      setLanguage(ttsVoices[0].language);
      setVoiceId(ttsVoices[0].id);
    } else if (!availableVoices.some(voice => voice.id === voiceId)) {
      setVoiceId(availableVoices[0].id);
    }
  }, [ttsVoices, language, voiceId]);
  useEffect(() => { if (ttsJob?.state === "succeeded" && ttsJob.asset) {
    setUploaded(ttsJob.asset);
    setLocal(current => ({ ...current, voiceAssetId: ttsJob.asset!.id, trimStartMs: 0, trimEndMs: ttsJob.asset!.durationMs }));
    setSaved(false);
    setUncertainSubmit(false);
  } }, [ttsJob?.id, ttsJob?.state, ttsJob?.asset?.id]);
  useEffect(() => { if (ttsJob?.state === "failed") setUncertainSubmit(false); }, [ttsJob?.id, ttsJob?.state]);

  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError("");
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  function change(patch: Partial<VoiceDraftView>) { setLocal(current => ({ ...current, ...patch })); setSaved(false); }
  async function upload(file: File) {
    if (!allowedAudioTypes.has(file.type) || !/\.(mp3|wav|m4a)$/i.test(file.name)) { setError("请选择 MP3、WAV 或 M4A 录音"); return; }
    if (file.size === 0) { setError("录音文件为空"); return; }
    await run(async () => {
      const asset = await onUpload(file);
      setUploaded(asset);
      change({ voiceAssetId: asset.id, trimStartMs: 0, trimEndMs: asset.durationMs });
    });
  }
  async function pickNativeAudio() {
    if (!onPickNativeAudio) return;
    await run(async () => {
      const asset = await onPickNativeAudio();
      if (!asset) return;
      setUploaded(asset);
      change({ voiceAssetId: asset.id, trimStartMs: 0, trimEndMs: asset.durationMs });
    });
  }
  function selectAsset(id: string) {
    const asset = allAssets.find(item => item.id === id);
    change({ voiceAssetId: id || null, trimStartMs: 0, trimEndMs: asset?.durationMs ?? 0 });
  }
  async function quoteTts() {
    await run(async () => {
      const result = await onQuoteTts(text.trim(), voiceId, language, speed);
      setQuote(result); setQuoteFor(fingerprint); requestId.current = null;
    });
  }
  async function startTts() {
    if (!validQuote || uncertainSubmit || ttsRunning) return;
    requestId.current ??= crypto.randomUUID();
    const id = requestId.current;
    await run(async () => {
      try { await onStartTts(text.trim(), voiceId, language, speed, validQuote.id, id); }
      catch (cause) { setUncertainSubmit(true); throw cause; }
    });
  }

  return <section className="video-edit-voice" aria-label={scope === "shot" ? "镜头配音" : "整集配音"}>
    <h3>{scope === "shot" ? "镜头配音" : "整集配音"}</h3>
    <p>上传录音或输入文字生成配音；不会改变人物或宠物口型。</p>
    <div className="video-edit-voice-source">
      {onPickNativeAudio ? <button type="button" disabled={busy || exportBusy} onClick={() => void pickNativeAudio()}>从本机选择录音</button>
        : <label>上传自己的录音<input aria-label="上传录音" type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" disabled={busy || exportBusy}
          onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></label>}
      <label>已保存的录音<select aria-label="选择配音资产" value={local.voiceAssetId ?? ""} disabled={busy || exportBusy} onChange={event => selectAsset(event.target.value)}>
        <option value="">不添加配音</option>{allAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
      {selected ? <><audio controls preload="metadata" src={selected.url} aria-label="试听配音素材" /><small>{selected.name} · {toSec(selected.durationMs)} 秒。此处试听原始录音；混音效果请用合成预览核对。</small></>
        : <p className="video-edit-voice-empty">还没有选中录音。上传后可以裁剪并放到时间线上。</p>}
    </div>
    <div className="video-edit-voice-tts">
      <h4>文字生成配音</h4>
      <label>配音文案<textarea aria-label="配音文案" value={text} maxLength={1000} disabled={busy || ttsRunning}
        onChange={event => { setText(event.target.value); setQuote(null); }} /></label>
      <label>声音<select aria-label="配音声音" value={voiceId} disabled={busy || ttsRunning || !availableVoices.length} onChange={event => { setVoiceId(event.target.value); setQuote(null); }}>
        {!availableVoices.length && <option value="">暂无可用音色</option>}
        {availableVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}</select></label>
      {voicesLoading && <p role="status">正在读取可用音色…</p>}
      {voicesError && <p role="alert">音色列表读取失败：{voicesError}。请稍后重试或上传自己的录音。</p>}
      {!voicesLoading && !voicesError && ttsVoices.length === 0 && <p>目前没有可用音色，请上传自己的录音。</p>}
      <div className="video-edit-voice-grid"><label>语言<select aria-label="配音语言" value={language} disabled={busy || ttsRunning || !ttsVoices.length} onChange={event => { setLanguage(event.target.value as "zh" | "en"); setQuote(null); }}>
        {ttsVoices.some(voice => voice.language === "zh") && <option value="zh">中文</option>}
        {ttsVoices.some(voice => voice.language === "en") && <option value="en">英文</option>}
        {!ttsVoices.length && <option value="zh">中文</option>}
      </select></label>
        <label>语速<input aria-label="配音语速" type="number" min="0.8" max="2" step="0.1" value={speed} disabled={busy || ttsRunning} onChange={event => { setSpeed(Number(event.target.value)); setQuote(null); }} /></label></div>
      <button type="button" disabled={busy || ttsRunning || uncertainSubmit || !voiceId || !text.trim() || !Number.isFinite(speed) || speed < 0.8 || speed > 2 || !Number.isInteger(speed * 10)} onClick={() => void quoteTts()}>查看费用说明</button>
      {validQuote && <div className="video-edit-voice-confirm" role="group" aria-label="确认付费生成配音">
        <p>{validQuote.amount === null ? "可灵按实际用量扣费；目前无法给出准确事前报价。请核对文案和音色，确认后可能产生费用。"
          : `${validQuote.description ?? "请核对配音文案与声音"} · 预计费用 ${validQuote.amount} ${validQuote.currency ?? ""}`}</p>
        <button type="button" disabled={busy || ttsRunning || uncertainSubmit} onClick={() => void startTts()}>{validQuote.amount === null ? "确认按实际用量扣费并生成" : "确认付费生成配音"}</button>
      </div>}
      {uncertainSubmit && <p role="alert">提交结果尚不确定。请查询原任务，确认状态前不要再次付费提交。</p>}
      {ttsJob && <p role="status">配音任务：{ttsJob.state}{ttsJob.error ? ` · ${ttsJob.error}` : ""}</p>}
      {onRefreshTts && (ttsJob || uncertainSubmit) && <button type="button" disabled={busy} onClick={() => void run(() => onRefreshTts(requestId.current))}>查询原配音任务</button>}
    </div>
    <div className="video-edit-voice-mix">
      <h4>位置与音量</h4>
      <div className="video-edit-voice-grid"><label>画面内开始（秒）<input aria-label="配音开始秒数" type="number" min="0" max={toSec(durationMs)} step="0.1" value={toSec(local.startMs)} onChange={event => change({ startMs: toMs(event.target.value) })} /></label>
        <label>录音入点（秒）<input aria-label="录音入点秒数" type="number" min="0" step="0.1" value={toSec(local.trimStartMs)} disabled={!selected} onChange={event => change({ trimStartMs: toMs(event.target.value) })} /></label>
        <label>录音出点（秒）<input aria-label="录音出点秒数" type="number" min="0" step="0.1" value={toSec(local.trimEndMs)} disabled={!selected} onChange={event => change({ trimEndMs: toMs(event.target.value) })} /></label></div>
      <div className="video-edit-voice-grid">{([["voiceVolume", "配音音量"], ["sourceVolume", "原声音量"], ["musicVolume", "背景音乐音量"]] as const).map(([key, label]) =>
        <label key={key}>{label}（%）<input aria-label={label} type="number" min="0" max="200" step="1" value={percent(local[key])} onChange={event => change({ [key]: Number(event.target.value) / 100 })} /></label>)}</div>
      <small>目标时长 {toSec(durationMs)} 秒；配音结束时间需在目标片段内。</small>
      {!draftValid && <p role="alert">请检查配音起点、录音裁剪范围和音量。</p>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="video-edit-voice-actions"><button type="button" disabled={busy || exportBusy || !draftValid || saved} onClick={() => void run(async () => { await onSave(local); setSaved(true); })}>保存配音草稿</button>
      {onPreview && <button type="button" disabled={busy || exportBusy || !draftValid || !saved || preview?.state === "pending" || preview?.state === "running"}
        onClick={() => void run(onPreview)}>合成预览</button>}
      <button type="button" disabled={busy || exportBusy || !draftValid || !saved || (onPreview !== undefined && (preview?.state !== "succeeded" || !preview.url))}
        onClick={() => void run(onExport)}>确认导出</button></div>
    {preview && <div className="video-edit-voice-preview" role="status">
      <strong>合成预览：{preview.state === "pending" || preview.state === "running" ? "制作中" : preview.state === "succeeded" ? "可播放" : "失败"}</strong>
      {preview.error && <p role="alert">{preview.error}</p>}
      {preview.state === "succeeded" && preview.url && <video controls preload="metadata" src={preview.url} aria-label="配音混音预览" />}
    </div>}
    {!saved && <p role="status">配音改动尚未保存，导出前请先保存草稿。</p>}
  </section>;
}
