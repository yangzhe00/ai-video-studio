import { useState } from "react";
import { cloudRequest } from "../../lib/cloud";
import type { CloudAccount } from "../../lib/cloud";

interface Props { account: CloudAccount | null; onChange: (account: CloudAccount | null) => void }

export function CloudAccountControl({ account, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    try { await cloudRequest("/auth/logout", "POST"); onChange(null); setOpen(false); }
    catch (cause) { setError(String(cause)); }
  }

  return <>
    <button type="button" className="cloud-account-trigger" onClick={() => setOpen(true)}>{account ? account.email : "登录云端"}</button>
    {open && <div className="film-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="film-modal cloud-account-modal" role="dialog" aria-modal="true" aria-label="云端账号">
        <div className="film-modal-title"><strong>云端账号</strong><button type="button" onClick={() => setOpen(false)} aria-label="关闭">×</button></div>
        {account ? <><p>{account.email}</p><p>演示额度：{account.demo_quota - account.demo_reserved - account.demo_used} 次可用</p><button type="button" onClick={() => void logout()}>退出登录</button></> : <>
          <div className="cloud-account-tabs"><button type="button" className={mode === "login" ? "selected" : ""} onClick={() => setMode("login")}>登录</button><button type="button" className={mode === "register" ? "selected" : ""} onClick={() => setMode("register")}>注册</button></div>
          <label>邮箱<input aria-label="云端邮箱" type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>密码<input aria-label="云端密码" type="password" value={password} onChange={event => setPassword(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void submit(); }} /></label>
          <button type="button" disabled={busy || !email || !password} onClick={() => void submit()}>{mode === "login" ? "登录并同步" : "注册并同步"}</button>
        </>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>}
  </>;
}
