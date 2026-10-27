import { useEffect, useState } from "react";
import { checkShotBudget, quoteShot } from "../../lib/native";
import type { MoneyEstimate } from "../../lib/native";
import type { ShotDraft } from "../../types/ai";

interface Props { root: string; shots: ShotDraft[]; budgetUsd: number | null; onSaveBudget: (value: number | null) => void; disabled?: boolean }

export function CostReview({ root, shots, budgetUsd, onSaveBudget, disabled }: Props) {
  const [quotes, setQuotes] = useState<Record<string, MoneyEstimate>>({});
  const [budgetInput, setBudgetInput] = useState(budgetUsd?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all(shots.map(async shot => [shot.id, await quoteShot(shot.modelId, shot.durationSec)] as const))
      .then(entries => { if (live) { setQuotes(Object.fromEntries(entries)); setError(null); } })
      .catch(cause => { if (live) setError(`无法获取费用估算：${String(cause)}`); });
    return () => { live = false; };
  }, [shots]);

  function saveBudget() {
    if (!budgetInput.trim()) { onSaveBudget(null); setError(null); return; }
    const value = Number(budgetInput);
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) { setError("请输入有效的非负预算金额"); return; }
    onSaveBudget(value); setError(null);
  }

  const quoted = shots.every(shot => quotes[shot.id]);
  const totalMicros = shots.reduce((sum, shot) => sum + (quotes[shot.id]?.microsUsd ?? 0), 0);
  return <div className="editor-panel cost-panel">
    <h2>生成费用预估</h2>
    <p className="muted">仅供规划，当前不会发起付费任务。模型价格按 2026-10-27 官方公开价计算，实际提交前需重新确认。</p>
    <div className="budget-row"><label>项目预算上限（美元）<input aria-label="项目预算上限" type="number" min="0" step="0.01" value={budgetInput} onChange={event => setBudgetInput(event.target.value)} placeholder="未设置" /></label><button type="button" disabled={disabled} onClick={saveBudget}>保存预算</button></div>
    {shots.length > 0 && <ul className="quote-list">{shots.map(shot => <li key={shot.id}><span>{shot.speaking ? "口型镜头" : "图生视频"} · {shot.durationSec} 秒 <small>{shot.modelId}</small></span><strong>{quotes[shot.id] ? `约 $${(quotes[shot.id].microsUsd / 1_000_000).toFixed(4)}` : "计算中"}</strong><button type="button" disabled={disabled || budgetUsd === null} onClick={() => void checkShotBudget(root, shot.id).then(() => setError("当前预算可覆盖该镜头；尚未提交付费任务")).catch(cause => setError(String(cause)))}>检查预算</button></li>)}</ul>}
    {shots.length > 0 && quoted && <p className="cost-total">草稿合计约 <strong>${(totalMicros / 1_000_000).toFixed(4)}</strong>{budgetUsd !== null && totalMicros > budgetUsd * 1_000_000 && <em>超过当前预算</em>}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
