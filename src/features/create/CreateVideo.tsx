import { useState } from "react";
import { createShotDraft, DOG_CHEF_PRESET } from "./shotDraft";
import type { ShotDraft } from "../../types/ai";
import type { MediaAsset } from "../../types/project";

interface Props { assets: MediaAsset[]; shots: ShotDraft[]; disabled?: boolean; onAdd: (shot: ShotDraft) => void }

export function CreateVideo({ assets, shots, disabled, onAdd }: Props) {
  const images = assets.filter(asset => asset.kind === "image" && !asset.missing);
  const [source, setSource] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5);
  const [script, setScript] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    try { onAdd(createShotDraft(source, prompt, duration, script)); setError(null); }
    catch (cause) { setError(String(cause)); }
  }

  return <div className="editor-panel create-video-panel">
    <div className="panel-heading"><h2>照片生成视频 · 分镜草稿</h2><button type="button" onClick={() => { setPrompt(DOG_CHEF_PRESET.prompt); setScript(DOG_CHEF_PRESET.script); }}>使用宠物小厨师示例</button></div>
    <p className="muted">自由描述任意人物或动物的场景与动作。说话台词可留空；草稿保存后再进行模型费用确认与生成。</p>
    <div className="story-form">
      <label>参考照片<select aria-label="参考照片" value={source} onChange={event => setSource(event.target.value)}><option value="">请选择</option>{images.map(asset => <option key={asset.id} value={asset.id}>{asset.relativePath.split("/").slice(-1)[0]}</option>)}</select></label>
      <label className="story-prompt">场景和动作提示词<textarea aria-label="场景和动作提示词" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="例如：照片中的人物在雨中跳舞；或动物在森林奔跑" /></label>
      <label>时长（秒）<input aria-label="镜头时长" type="number" min="4" max="12" step="1" value={duration} onChange={event => setDuration(Number(event.target.value))} /></label>
      <label>可选台词<textarea aria-label="可选台词" value={script} onChange={event => setScript(event.target.value)} placeholder="留空则不制作说话镜头" /></label>
      <button type="button" disabled={disabled} onClick={add}>保存分镜草稿</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {shots.length > 0 && <ol className="shot-list">{shots.map(shot => <li key={shot.id}><strong>{shot.prompt}</strong><small>{shot.durationSec} 秒 · {shot.speaking ? `说话：${shot.script}` : "无台词"} · {shot.modelId}</small></li>)}</ol>}
  </div>;
}
