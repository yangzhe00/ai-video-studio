import { useEffect, useLayoutEffect, useState } from "react";

export interface PromptVariant {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

export interface PromptIdeaSet {
  id: string;
  clientRequestId?: string;
  input: string;
  state: "pending" | "ready" | "failed" | "unknown";
  variants: PromptVariant[];
  selectedVariantId?: string | null;
  editedPrompt?: string | null;
  createdAt?: number | string;
  errorCode?: string | null;
  error?: string | null;
}

interface Props {
  requestScope: string;
  ideaSet: PromptIdeaSet | null;
  recentSets?: PromptIdeaSet[];
  busy?: boolean;
  error?: string | null;
  onRequest: (input: string, clientRequestId: string) => Promise<void>;
  onReload: (id: string) => Promise<void>;
  onSelect: (id: string, variantId: string, editedPrompt: string) => Promise<PromptIdeaSet>;
  onContinue: (ideaSet: PromptIdeaSet) => void;
  onManual?: (draft: string) => void;
}

interface PendingRequest { id: string; input: string }

function storedRequest(scope: string): PendingRequest | null {
  try {
    const value = window.sessionStorage.getItem(`avs-idea-request:${scope}`);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<PendingRequest>;
    return typeof parsed.id === "string" && typeof parsed.input === "string"
      ? parsed as PendingRequest : null;
  } catch { return null; }
}

export function pendingPromptRequestId(scope: string): string | null { return storedRequest(scope)?.id ?? null; }

function storedDraft(scope: string): string | null {
  try { return window.sessionStorage.getItem(`avs-idea-draft:${scope}`); } catch { return null; }
}

function saveDraft(scope: string, value: string) {
  try { window.sessionStorage.setItem(`avs-idea-draft:${scope}`, value); } catch { /* storage may be unavailable */ }
}

export function PromptIdeas({ requestScope, ideaSet, recentSets = [], busy = false, error, onRequest, onReload, onSelect, onContinue, onManual }: Props) {
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(() => storedRequest(requestScope));
  const [input, setInput] = useState(storedRequest(requestScope)?.input ?? storedDraft(requestScope) ?? ideaSet?.input ?? "");
  const [selectedId, setSelectedId] = useState(ideaSet?.selectedVariantId ?? "");
  const [editedPrompt, setEditedPrompt] = useState(ideaSet?.editedPrompt ?? "");
  const [localError, setLocalError] = useState("");
  const awaitingOriginal = Boolean(pendingRequest && ideaSet?.clientRequestId !== pendingRequest.id);
  const stale = Boolean(ideaSet && input.trim() !== ideaSet.input.trim());

  useEffect(() => {
    const stored = storedRequest(requestScope);
    setPendingRequest(stored);
    setInput(stored?.input ?? storedDraft(requestScope) ?? ideaSet?.input ?? "");
  }, [requestScope]);

  useEffect(() => {
    if (!pendingRequest || ideaSet?.clientRequestId !== pendingRequest.id) return;
    setPendingRequest(null);
    try { window.sessionStorage.removeItem(`avs-idea-request:${requestScope}`); } catch { /* settled response is still shown */ }
  }, [ideaSet?.id, ideaSet?.input, pendingRequest?.id, requestScope]);

  useLayoutEffect(() => {
    if (!ideaSet) return;
    if (pendingRequest && ideaSet.clientRequestId !== pendingRequest.id) return;
    const draft = storedDraft(requestScope);
    if (draft && draft.trim() !== ideaSet.input.trim() && ideaSet.clientRequestId !== pendingRequest?.id) return;
    setInput(ideaSet.input);
    setSelectedId(ideaSet.selectedVariantId ?? "");
    setEditedPrompt(ideaSet.editedPrompt ?? ideaSet.variants.find(item => item.id === ideaSet.selectedVariantId)?.prompt ?? "");
  }, [ideaSet?.id, ideaSet?.selectedVariantId, ideaSet?.editedPrompt]);

  function changeInput(value: string) {
    setInput(value);
    saveDraft(requestScope, value);
  }

  async function request(newRound = false) {
    const clean = input.trim();
    if (!clean || clean.length > 200) { setLocalError("请输入 1–200 字的想法或关键词"); return; }
    setLocalError("");
    const request = !newRound && pendingRequest?.input === clean
      ? pendingRequest : { id: crypto.randomUUID(), input: clean };
    try { window.sessionStorage.setItem(`avs-idea-request:${requestScope}`, JSON.stringify(request)); }
    catch { setLocalError("浏览器无法保存请求编号，请启用会话存储后重试，避免重复调用模型"); return; }
    setPendingRequest(request);
    await onRequest(clean, request.id);
  }

  function choose(variant: PromptVariant) {
    setSelectedId(variant.id);
    setEditedPrompt(variant.prompt);
    setLocalError("");
  }

  async function saveAndContinue() {
    if (!ideaSet || !selectedId) return;
    const clean = editedPrompt.trim();
    if (!clean || clean.length > 2000) { setLocalError("镜头提示词需为 1–2000 字"); return; }
    setLocalError("");
    try {
      const saved = await onSelect(ideaSet.id, selectedId, clean);
      onContinue(saved);
    } catch { /* the host shows the request error */ }
  }

  return <section className="avs-prompt-ideas" aria-label="一句话灵感">
    <div className="avs-prompt-ideas-heading"><span>IDEA FIRST</span><h2>今天想拍什么？</h2>
      <p>说一句话或几个关键词，先看同一个镜头的三种拍法。选好后再决定项目和照片。</p></div>
    <label htmlFor="avs-idea-input">你的想法</label>
    <textarea id="avs-idea-input" aria-label="你的想法" maxLength={200} value={input}
      onChange={event => changeInput(event.target.value)} placeholder="例如：小狗做好晚餐，开心地端上桌" />
    <div className="avs-prompt-ideas-actions"><button type="button" onClick={() => void request()} disabled={busy || !input.trim()}>
      {busy ? "正在准备灵感…" : pendingRequest?.input === input.trim() ? "查询原请求" : ideaSet ? "再给我三种灵感" : "给我三种灵感"}</button>
      {pendingRequest && <button type="button" className="secondary" onClick={() => {
        try { window.sessionStorage.removeItem(`avs-idea-request:${requestScope}`); }
        catch { setLocalError("浏览器无法清除旧请求编号，请启用会话存储后重试"); return; }
        setPendingRequest(null);
      }}>另起一轮</button>}
      {onManual && <button type="button" className="secondary" onClick={() => onManual(input.trim())}>我已有提示词</button>}
      <small>获取灵感不会创建项目或消耗视频生成额度</small></div>
    {pendingRequest && <small className="avs-prompt-ideas-pending">上次请求可能已送达。“查询原请求”会使用相同编号；只有明确另起一轮才使用新编号。</small>}
    {(localError || error) && <p role="alert" className="avs-prompt-ideas-error">{localError || error}</p>}
    {ideaSet && <div className="avs-prompt-ideas-result">
      <div className="avs-prompt-ideas-result-heading"><h3>三种镜头方向</h3><span>你的想法：{ideaSet.input}</span></div>
      {awaitingOriginal ? <div className="avs-prompt-ideas-state" role="status"><p>新一轮结果尚未确认，旧的三版暂不可选。请点击“查询原请求”，系统会复用上次的请求编号。</p></div>
        : stale ? <div className="avs-prompt-ideas-state" role="status"><p>你修改了原始想法；旧的三版已过期。请获取新一轮，或恢复原想法。</p>
        <button type="button" onClick={() => changeInput(ideaSet.input)}>恢复原想法</button></div>
        : ideaSet.state === "pending" || ideaSet.state === "unknown" ? <div className="avs-prompt-ideas-state" role="status">
        <p>{ideaSet.state === "unknown" ? "模型请求结果待确认；系统不会自动再次提交。" : "正在准备三种灵感，可以稍后回来查看。"}
          {ideaSet.error ? ` ${ideaSet.error}` : ""}</p>
        <button type="button" onClick={() => void onReload(ideaSet.id)} disabled={busy}>查询原请求</button>
      </div> : ideaSet.state === "failed" ? <div className="avs-prompt-ideas-state avs-prompt-ideas-state--failed" role="alert">
        <p>灵感生成失败：{ideaSet.error ?? "模型未返回可用的三版提示词"}。你仍可手写提示词继续创作。</p>
        <div><button type="button" onClick={() => void request(true)} disabled={busy || !input.trim()}>重新获取灵感</button>
          {onManual && <button type="button" className="secondary" onClick={() => onManual(input.trim())}>手写提示词继续</button>}</div>
      </div>
        : <><div className="avs-prompt-ideas-grid">{ideaSet.variants.map((variant, index) => <button key={variant.id}
          type="button" className={selectedId === variant.id ? "avs-prompt-variant selected" : "avs-prompt-variant"}
          aria-pressed={selectedId === variant.id} onClick={() => choose(variant)}>
          <small>方向 {index + 1}</small><strong>{variant.title}</strong><span>{variant.description}</span><p>{variant.prompt}</p>
          <em>{selectedId === variant.id ? "✓ 已选中" : "选择这一版"}</em>
        </button>)}</div>
          {selectedId && <div className="avs-prompt-ideas-edit"><label htmlFor="avs-idea-prompt">修改最终镜头提示词</label>
            <textarea id="avs-idea-prompt" aria-label="最终镜头提示词" maxLength={2000} value={editedPrompt} onChange={event => setEditedPrompt(event.target.value)} />
            <button type="button" onClick={() => void saveAndContinue()} disabled={busy || !editedPrompt.trim()}>{busy ? "保存中…" : "保存这一版并继续"}</button>
            <small>下一步选择项目、分集和参考照片；这里不会提交视频任务。</small>
          </div>}</>}
    </div>}
    {recentSets.length > 0 && <div className="avs-prompt-ideas-recent"><strong>最近的灵感</strong>
      {recentSets.filter(item => item.id !== ideaSet?.id).slice(0, 3).map(item => <button type="button" key={item.id}
        onClick={() => { changeInput(item.input); void onReload(item.id); }} disabled={busy}>{item.input}<small>{item.state === "ready" ? "查看三版" : "查看状态"}</small></button>)}
    </div>}
  </section>;
}
