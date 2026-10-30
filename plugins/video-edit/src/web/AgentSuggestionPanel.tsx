import { useEffect, useRef, useState } from "react";

export interface EditSuggestionView {
  id: string;
  title: string;
  reason: string;
  before: string;
  after: string;
  invalidReason?: string;
}

export interface EditSuggestionSetView {
  id: string;
  targetRevision: number;
  suggestions: EditSuggestionView[];
  state: "ready" | "applied" | "conflict";
}

export interface AgentSuggestionPanelProps {
  set: EditSuggestionSetView | null;
  loading?: boolean;
  error?: string;
  onGenerate: (instruction: string) => Promise<void>;
  onConfirm: (setId: string, selectedIds: string[], targetRevision: number) => Promise<void>;
  onRefresh?: () => Promise<void>;
}

export function AgentSuggestionPanel({ set, loading = false, error, onGenerate, onConfirm, onRefresh }: AgentSuggestionPanelProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const lock = useRef(false);
  const suggestionKey = `${set?.id ?? ""}:${set?.suggestions.map(item => `${item.id}:${item.invalidReason ?? ""}`).join("|") ?? ""}`;

  useEffect(() => {
    setSelected(set?.suggestions.filter(item => !item.invalidReason).map(item => item.id) ?? []);
    setReviewing(false);
    setLocalError("");
  }, [suggestionKey]);

  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setLocalError("");
    try { await task(); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; setBusy(false); }
  }

  const valid = set?.suggestions.filter(item => !item.invalidReason) ?? [];
  const canConfirm = set?.state === "ready" && selected.length > 0 && !loading && !busy;

  return <section className="video-edit-agent" aria-label="Agent 剪辑建议">
    <div className="video-edit-agent-heading"><div><h3>Agent 剪辑建议</h3><p>先看差异、逐条选择，再确认应用。生成建议与确认都不会导出视频。</p></div></div>
    <label>想调整什么<textarea aria-label="剪辑建议要求" value={instruction} maxLength={1000} onChange={event => setInstruction(event.target.value)} placeholder="例如：剪掉开头停顿，保留小狗做饭的动作" /></label>
    <button type="button" disabled={busy || loading || !instruction.trim()} onClick={() => void run(() => onGenerate(instruction.trim()))}>生成建议</button>
    {loading && <p role="status">正在整理剪辑建议…</p>}
    {(error || localError) && <p role="alert">{error || localError}。仍可继续手工编辑。</p>}
    {!loading && !set && <p className="video-edit-agent-empty">还没有剪辑建议。你可以先手工编辑，或让 Agent 提供一版方案。</p>}
    {set && <>
      <p className="video-edit-agent-revision">建议集版本 {set.targetRevision}；确认时会校验源镜头和分集是否变化。</p>
      {set.state === "applied" && <p role="status">已应用所选建议，仍需单独保存或导出成片。</p>}
      {set.state === "conflict" && <p role="alert">编辑内容已变化，这组建议不能直接应用。请刷新后重新查看差异。</p>}
      {set.suggestions.length === 0 && <p role="status">本次没有可用建议。你可以继续手工编辑。</p>}
      <ul className="video-edit-agent-list">{set.suggestions.map(item => <li key={item.id}>
        <label><input type="checkbox" checked={selected.includes(item.id)} disabled={Boolean(item.invalidReason) || set.state !== "ready" || busy || loading}
          onChange={() => setSelected(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])} />
          <strong>{item.title}</strong></label>
        <p>{item.reason}</p>
        <div className="video-edit-agent-diff"><span><small>目前</small>{item.before}</span><span><small>建议</small>{item.after}</span></div>
        {item.invalidReason && <p role="alert">不可应用：{item.invalidReason}</p>}
      </li>)}</ul>
      {set.state === "ready" && valid.length > 0 && <div className="video-edit-agent-actions">
        <button type="button" disabled={!canConfirm} onClick={() => setReviewing(true)}>预览所选 {selected.length} 条</button>
      </div>}
      {reviewing && set.state === "ready" && <div className="video-edit-agent-confirm" role="group" aria-label="确认应用剪辑建议">
        <p>将确认建议集版本 {set.targetRevision} 中的 {selected.length} 条。原视频保留；不会自动生成视频、调用 TTS 或扣费。</p>
        <button type="button" disabled={!canConfirm} onClick={() => void run(async () => { await onConfirm(set.id, selected, set.targetRevision); setReviewing(false); })}>确认应用所选建议</button>
        <button type="button" disabled={busy} onClick={() => setReviewing(false)}>返回修改选择</button>
      </div>}
      {onRefresh && <button type="button" disabled={busy || loading} onClick={() => void run(onRefresh)}>刷新建议状态</button>}
    </>}
  </section>;
}
