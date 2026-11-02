import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { FeedbackMessage } from "./feedback";

type DialogMode = "confirm" | "input" | "notice";
type DialogResult = boolean | string | null;

interface PendingDialog {
  id: number;
  message: FeedbackMessage;
  mode: DialogMode;
  initialValue: string;
  resolve: (result: DialogResult) => void;
}

interface Props {
  request: PendingDialog | null;
  onResolve: (result: DialogResult) => void;
}

/** Shared themed modal for confirmations, failures and one-line input. */
export function FeedbackDialog({ request, onResolve }: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!request) return;
    setValue(request.initialValue);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (request.mode === "input" ? inputRef.current : request.mode === "confirm" ? cancelRef.current : confirmRef.current)?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [request?.id]);

  if (!request) return null;
  const { message, mode } = request;
  const canConfirm = mode !== "input" || Boolean(value.trim());
  const submit = () => { if (canConfirm) onResolve(mode === "input" ? value.trim() : true); };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onResolve(null); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? []);
    if (focusable.length < 2) return;
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1]?.focus(); }
    else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0]?.focus(); }
  };

  return createPortal(<div className="avs-feedback-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onResolve(null);
  }}>
    <section ref={panelRef} className="avs-feedback-dialog" data-kind={message.kind}
      role={message.kind === "warning" || message.kind === "failure" ? "alertdialog" : "dialog"}
      aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={handleKeyDown}>
      <div className="avs-feedback-heading"><span className="avs-feedback-symbol" aria-hidden="true">{
        message.kind === "warning" ? "!" : message.kind === "failure" ? "×" : message.kind === "success" ? "✓" : "i"
      }</span><h2 id={titleId}>{message.title}</h2></div>
      <p id={descriptionId}>{message.description}</p>
      {mode === "input" && <label className="avs-feedback-field">{message.inputLabel}
        <input ref={inputRef} value={value} maxLength={50}
          onChange={event => setValue(event.target.value)} onKeyDown={event => {
            if (event.key === "Enter") { event.preventDefault(); submit(); }
          }} />
      </label>}
      <div className="avs-feedback-actions">
        {mode !== "notice" && <button type="button" ref={cancelRef} onClick={() => onResolve(null)}>{message.cancelLabel ?? "取消"}</button>}
        <button type="button" ref={confirmRef} className="primary" disabled={!canConfirm} onClick={submit}>{message.confirmLabel}</button>
      </div>
    </section>
  </div>, document.body);
}

/** Local host with a queue: concurrent prompts settle in order and unmount cancels pending actions. */
export function useFeedbackDialog() {
  const nextId = useRef(0);
  const active = useRef<PendingDialog | null>(null);
  const queue = useRef<PendingDialog[]>([]);
  const [request, setRequest] = useState<PendingDialog | null>(null);

  useEffect(() => () => {
    active.current?.resolve(null);
    queue.current.forEach(item => item.resolve(null));
    active.current = null;
    queue.current = [];
  }, []);

  const open = (message: FeedbackMessage, mode: DialogMode, initialValue = "") => new Promise<DialogResult>(resolve => {
    const item: PendingDialog = { id: ++nextId.current, message, mode, initialValue, resolve };
    if (active.current) queue.current.push(item);
    else { active.current = item; setRequest(item); }
  });
  const settle = (result: DialogResult) => {
    const current = active.current;
    if (!current) return;
    const next = queue.current.shift() ?? null;
    active.current = next;
    setRequest(next);
    current.resolve(result);
  };

  return {
    confirm: async (message: FeedbackMessage) => (await open(message, "confirm")) === true,
    input: async (message: FeedbackMessage, initialValue = "") => {
      const result = await open(message, "input", initialValue);
      return typeof result === "string" ? result : null;
    },
    show: async (message: FeedbackMessage) => { await open(message, "notice"); },
    dialog: <FeedbackDialog request={request} onResolve={settle} />,
  };
}
