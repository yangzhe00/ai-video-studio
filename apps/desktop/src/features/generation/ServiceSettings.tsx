import { useEffect, useState } from "react";
import { desktopPorts } from "../../lib/ports";
import type { ProviderId, ProviderKeyStatus } from "@ai-video/platform-ports";

const PROVIDERS: { id: ProviderId; label: string; use: string }[] = [
  { id: "hedra", label: "Hedra", use: "默认图生视频与口型服务" },
  { id: "runway", label: "Runway", use: "备选图生视频服务" },
  { id: "deepseek", label: "DeepSeek", use: "可选分镜和文案助手" },
];

export function ServiceSettings() {
  const [statuses, setStatuses] = useState<ProviderKeyStatus[]>([]);
  const [provider, setProvider] = useState<ProviderId>("hedra");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void desktopPorts.ai.keyStatus().then(setStatuses).catch(error => setNotice(String(error))); }, []);

  async function save() {
    if (!key.trim()) { setNotice("请输入 API Key"); return; }
    setBusy(true);
    try {
      await desktopPorts.ai.setKey(provider, key);
      setKey("");
      setStatuses(await desktopPorts.ai.keyStatus());
      setNotice("密钥已保存到 macOS 钥匙串");
    } catch (error) { setNotice(`保存失败：${String(error)}`); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try { await desktopPorts.ai.removeKey(provider); setStatuses(await desktopPorts.ai.keyStatus()); setNotice("密钥已移除"); }
    catch (error) { setNotice(`移除失败：${String(error)}`); }
    finally { setBusy(false); }
  }

  return <div className="editor-panel service-panel">
    <h2>模型服务设置</h2><p className="muted">密钥仅存入 macOS 钥匙串，不写入项目文件。当前版本尚未发起付费生成。</p>
    <ul className="provider-list">{PROVIDERS.map(item => <li key={item.id}><strong>{item.label}</strong><small>{item.use}</small><span>{statuses.find(status => status.provider === item.id)?.configured ? "已配置" : "未配置"}</span></li>)}</ul>
    <div className="service-form"><label>服务<select aria-label="选择模型服务" value={provider} onChange={event => setProvider(event.target.value as ProviderId)}>{PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>API Key<input aria-label="API Key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder="粘贴你的 API Key" /></label><button type="button" disabled={busy} onClick={save}>保存密钥</button><button type="button" disabled={busy || !statuses.find(status => status.provider === provider)?.configured} onClick={remove}>移除密钥</button></div>
    {notice && <p className="notice" role="status">{notice}</p>}
  </div>;
}
