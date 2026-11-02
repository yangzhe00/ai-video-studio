import { useEffect, useRef, useState } from "react";
import { cloudRequest } from "../../lib/cloud";
import type { CloudAccount } from "../../lib/cloud";

interface Props { account: CloudAccount | null; onChange: (account: CloudAccount | null) => void }

export function CloudAccountControl({ account, onChange }: Props) {
  const controlRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initial = account?.email.trim().charAt(0).toUpperCase() || "?";
  const available = account ? Math.max(0, account.demo_quota - account.demo_reserved - account.demo_used) : 0;

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    function closeOnOutside(event: PointerEvent) {
      if (account && !controlRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [open, account]);

  async function submit() {
    try {
      setBusy(true); setError("");
      await cloudRequest(`/auth/${mode}`, "POST", { email, password });
      const current = await cloudRequest<{ account: CloudAccount }>("/auth/me");
      onChange(current.account); setOpen(false); setPassword("");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function logout() {
    try { setBusy(true); setError(""); await cloudRequest("/auth/logout", "POST"); onChange(null); setOpen(false); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  return <div className="cloud-account-control" ref={controlRef}>
    <button type="button" className={`cloud-account-trigger${account ? " is-connected" : ""}`}
      aria-label={account ? `云端账号，已登录 ${account.email}` : "登录云端"}
      aria-haspopup="dialog" aria-expanded={open} title={account?.email ?? "登录并同步项目"}
      onClick={() => { setError(""); setOpen(value => !value); }}>
      <span className="cloud-account-avatar" aria-hidden="true">{account ? initial : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3" /><path d="M5 20c.5-4 3-6 7-6s6.5 2 7 6" /></svg>}
        {account && <i className="cloud-account-online" />}</span>
      <span className="cloud-account-trigger-label">{account ? "云端账号" : "登录云端"}</span>
      <svg className="cloud-account-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
    </button>
    {open && account && <section className="cloud-account-popover" role="dialog" aria-label="云端账号">
      <div className="cloud-account-popover-head"><span className="cloud-account-avatar large" aria-hidden="true">{initial}<i className="cloud-account-online" /></span>
        <strong>已连接云端</strong>
        <button type="button" className="cloud-account-close" aria-label="关闭账号面板" onClick={() => setOpen(false)}>×</button></div>
      <p className="cloud-account-email">{account.email}</p>
      <div className="cloud-account-quota"><span>可用生成次数</span><strong>{available} 次</strong></div>
      <button type="button" className="cloud-account-signout" disabled={busy} onClick={() => void logout()}>退出登录</button>
      {error && <p role="alert">{error}</p>}
    </section>}
    {open && !account && <div className="film-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="film-modal cloud-account-modal" role="dialog" aria-modal="true" aria-label="云端账号">
        <div className="film-modal-title"><strong>登录云端</strong><button type="button" onClick={() => setOpen(false)} aria-label="关闭">×</button></div>
        <p className="cloud-account-intro">登录后，项目和生成任务会同步到你的账号。</p>
          <div className="cloud-account-tabs"><button type="button" className={mode === "login" ? "selected" : ""} onClick={() => setMode("login")}>登录</button><button type="button" className={mode === "register" ? "selected" : ""} onClick={() => setMode("register")}>注册</button></div>
          <label>邮箱<input aria-label="云端邮箱" type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>密码<input aria-label="云端密码" type="password" value={password} onChange={event => setPassword(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void submit(); }} /></label>
          <button type="button" className="cloud-account-submit" disabled={busy || !email || !password} onClick={() => void submit()}>{mode === "login" ? "登录并同步" : "注册并同步"}</button>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>}
  </div>;
}
