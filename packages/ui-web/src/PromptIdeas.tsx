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
  agentEnabled?: boolean;
  agentUnavailableReason?: string;
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

interface EditedIdeaDraft { variantId: string; prompt: string }
function storedEditedDrafts(scope: string): Record<string, EditedIdeaDraft> {
  try { return JSON.parse(window.sessionStorage.getItem(`avs-idea-edits:${scope}`) ?? "{}") as Record<string, EditedIdeaDraft>; }
  catch { return {}; }
}

export function PromptIdeas({ requestScope, ideaSet, recentSets = [], busy = false, error, agentEnabled = true,
  agentUnavailableReason = "登录后可让 Agent 提供方向", onRequest, onReload, onSelect, onContinue, onManual }: Props) {
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(() => storedRequest(requestScope));
  const [input, setInput] = useState(storedRequest(requestScope)?.input ?? storedDraft(requestScope) ?? ideaSet?.input ?? "");
  const [selectedId, setSelectedId] = useState(ideaSet?.selectedVariantId ?? "");
  const [editedPrompt, setEditedPrompt] = useState(ideaSet?.editedPrompt ?? "");
  const [editedDrafts, setEditedDrafts] = useState<Record<string, EditedIdeaDraft>>(() => storedEditedDrafts(requestScope));
  const [localError, setLocalError] = useState("");
  const awaitingOriginal = Boolean(pendingRequest && ideaSet?.clientRequestId !== pendingRequest.id);
  const stale = Boolean(ideaSet && input.trim() !== ideaSet.input.trim());
  const inputLength = Array.from(input).length;
  const agentLength = Array.from(input.trim()).length;
  const agentCanStart = agentEnabled && agentLength > 0 && agentLength <= 200;
  const manualCanStart = Array.from(input.trim()).length > 0 && inputLength <= 10000;

  useEffect(() => {
    const stored = storedRequest(requestScope);
    setPendingRequest(stored);
    setEditedDrafts(storedEditedDrafts(requestScope));
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
    const draftEdit = editedDrafts[ideaSet.id];
    setSelectedId(draftEdit?.variantId ?? ideaSet.selectedVariantId ?? "");
    setEditedPrompt(draftEdit?.prompt ?? ideaSet.editedPrompt ?? ideaSet.variants.find(item => item.id === ideaSet.selectedVariantId)?.prompt ?? "");
  }, [ideaSet?.id, ideaSet?.selectedVariantId, ideaSet?.editedPrompt]);

  function changeInput(value: string) {
    setInput(value);
    saveDraft(requestScope, value);
  }

  async function request(newRound = false) {
    const clean = input.trim();
    if (!agentEnabled) { setLocalError(agentUnavailableReason); return; }
    if (!clean || Array.from(clean).length > 200) { setLocalError("找灵感请输入 1–200 字的想法或关键词"); return; }
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
    if (ideaSet) rememberEdit(ideaSet.id, { variantId: variant.id, prompt: variant.prompt });
    setLocalError("");
  }

  function rememberEdit(id: string, edit: EditedIdeaDraft) {
    setEditedDrafts(current => {
      const next = { ...current, [id]: edit };
      try { window.sessionStorage.setItem(`avs-idea-edits:${requestScope}`, JSON.stringify(next)); } catch { /* in-memory draft remains */ }
      return next;
    });
  }

  async function saveAndContinue() {
    if (!ideaSet || !selectedId) return;
    const clean = editedPrompt.trim();
    if (!clean || Array.from(clean).length > 2000) { setLocalError("镜头提示词需为 1–2000 字"); return; }
    setLocalError("");
    try {
      const saved = await onSelect(ideaSet.id, selectedId, clean);
      onContinue(saved);
    } catch { /* the host shows the request error */ }
  }

  const querySnapshot = !stale && ideaSet && (ideaSet.state === "pending" || ideaSet.state === "unknown") && !pendingRequest;
  const retryNewRound = !stale && ideaSet && (ideaSet.state === "ready" || ideaSet.state === "failed") && !pendingRequest;
  return <section className="avs-prompt-ideas" aria-label="统一创作输入">
    <div className="avs-prompt-ideas-heading"><h1>你想拍什么？</h1>
      <p>找灵感可输入 1–200 字；已有内容可输入最多 10000 字。获取灵感不会消耗视频额度。</p></div>
    <label htmlFor="avs-idea-input">写下关键词、提示词或剧本</label>
    <textarea id="avs-idea-input" aria-label="写下关键词、提示词或剧本" value={input}
      onChange={event => changeInput(event.target.value)} placeholder="一句想法、镜头提示词，或粘贴完整剧本" />
    <div className="avs-prompt-ideas-count"><span>{inputLength} / 10000 字</span>
      {inputLength > 10000 && <span role="alert">内容超过 10000 字，请缩短后继续</span>}
      {agentLength > 200 && inputLength <= 10000 && <span>超过 200 字，可直接用自己的内容开始</span>}</div>
    <div className="avs-prompt-ideas-actions"><button type="button" onClick={() => {
      if (querySnapshot) void onReload(ideaSet.id);
      else void request(Boolean(retryNewRound));
    }} disabled={busy || !agentCanStart}>
      {busy ? "正在准备灵感…" : pendingRequest?.input === input.trim() || querySnapshot ? "查询原请求"
        : retryNewRound ? "再给我 3 个方向" : "让 Agent 给我 3 个方向"}</button>
      {onManual && <button type="button" className="secondary" onClick={() => onManual(input)} disabled={!manualCanStart}>用我的内容开始</button>}
      {!agentEnabled && <small>{agentUnavailableReason}</small>}
      {pendingRequest && <button type="button" className="secondary avs-prompt-ideas-new-round" onClick={() => {
        try { window.sessionStorage.removeItem(`avs-idea-request:${requestScope}`); }
        catch { setLocalError("浏览器无法清除旧请求编号，请启用会话存储后重试"); return; }
        setPendingRequest(null);
      }}>另起一轮</button>}
      {!pendingRequest && ideaSet?.state === "unknown" && !stale && <button type="button" className="secondary avs-prompt-ideas-new-round" onClick={() => void request(true)} disabled={busy || !agentCanStart}>另起一轮</button>}
    </div>
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
      </div> : ideaSet.state === "failed" ? <div className="avs-prompt-ideas-state avs-prompt-ideas-state--failed" role="alert">
        <p>灵感生成失败：{ideaSet.error ?? "模型未返回可用的三版提示词"}。你仍可用自己的内容开始。</p>
      </div>
        : <><div className="avs-prompt-ideas-grid">{ideaSet.variants.map((variant, index) => <button key={variant.id}
          type="button" className={selectedId === variant.id ? "avs-prompt-variant selected" : "avs-prompt-variant"}
          aria-pressed={selectedId === variant.id} onClick={() => choose(variant)}>
          <small>方向 {index + 1}</small><strong>{variant.title}</strong><span>{variant.description}</span><p>{variant.prompt}</p>
          <em>{selectedId === variant.id ? "✓ 已选中" : "选择这一版"}</em>
        </button>)}</div>
          {selectedId && <div className="avs-prompt-ideas-edit"><label htmlFor="avs-idea-prompt">修改最终镜头提示词</label>
            <textarea id="avs-idea-prompt" aria-label="最终镜头提示词" value={editedPrompt} onChange={event => {
              setEditedPrompt(event.target.value);
              if (ideaSet && selectedId) rememberEdit(ideaSet.id, { variantId: selectedId, prompt: event.target.value });
            }} />
            <button type="button" onClick={() => void saveAndContinue()} disabled={busy || !editedPrompt.trim() || Array.from(editedPrompt.trim()).length > 2000}>{busy ? "保存中…" : "用这条灵感开始"}</button>
            <small>下一步选择项目与制作方式；这里不会提交视频任务。</small>
          </div>}</>}
    </div>}
    {recentSets.length > 0 && <div className="avs-prompt-ideas-recent"><strong>最近的灵感</strong>
      {recentSets.filter(item => item.id !== ideaSet?.id).slice(0, 3).map(item => <button type="button" key={item.id}
        onClick={() => { changeInput(item.input); void onReload(item.id); }} disabled={busy}>{item.input}<small>{item.state === "ready" ? "查看三版" : "查看状态"}</small></button>)}
    </div>}
  </section>;
}
