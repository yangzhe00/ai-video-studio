import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api, setToken } from '@taskify/api-client'
import { Button, Input } from '@taskify/ui'
import { useAuthStore } from '../stores/auth'
import { ThemeSwitcher } from '../components/ThemeSwitcher'

/** 登录页：手机号+验证码，演示模式返回 Mock 验证码并明确提示（constitution 已确认） */
export function LoginPage(): React.ReactElement {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const setPhone = useAuthStore((s) => s.setPhone)

  const [phone, setPhoneVal] = useState('')
  const [code, setCode] = useState('')
  const [demoHint, setDemoHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)

  const phoneValid = /^1\d{10}$/.test(phone)

  async function handleSendCode(): Promise<void> {
    setSending(true)
    setError(null)
    try {
      const resp = await api.sendCode(phone)
      // 演示模式：直接展示固定验证码
      setDemoHint(resp.demoCode)
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  async function handleLogin(): Promise<void> {
    setLoggingIn(true)
    setError(null)
    try {
      const resp = await api.login(phone, code)
      setToken(resp.token)
      setPhone(phone)
      // 登录后回到来源页（会话过期保留当前页）
      const redirect = params.get('redirect') ?? '/'
      navigate(redirect, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败')
    } finally {
      setLoggingIn(false)
    }
  }

  return (
    <div className="login-shell" style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 20, right: 24 }}>
        <ThemeSwitcher />
      </div>

      <div className="card login-card">
        <div className="app-brand" style={{ padding: '0 0 20px' }}>
          <span className="app-brand__mark">TF</span>
          <span>
            <span className="app-brand__name">Taskify</span>
            <span className="app-brand__sub">video studio</span>
          </span>
        </div>

        <h1 className="login-title">视频成片工作台</h1>
        <p className="login-sub">选题 → 素材 → 片段 → 合成，一条竖屏视频 5 步出片</p>

        <div className="login-stack">
          <Input
            label="手机号"
            name="phone"
            value={phone}
            maxLength={11}
            placeholder="11 位手机号"
            onChange={(e) => setPhoneVal(e.target.value.trim())}
          />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Input
                label="验证码"
                name="code"
                value={code}
                placeholder="6 位数字"
                onChange={(e) => setCode(e.target.value.trim())}
              />
            </div>
            <Button variant="secondary" disabled={!phoneValid} loading={sending} onClick={handleSendCode}>
              获取验证码
            </Button>
          </div>

          {demoHint && <p className="alert alert--info">演示模式验证码：{demoHint}</p>}
          {error && <p className="alert alert--error">{error}</p>}

          <Button block disabled={!phoneValid || !code} loading={loggingIn} onClick={handleLogin}>
            登录
          </Button>
          <p className="hint" style={{ textAlign: 'center' }}>
            演示环境：任意 11 位手机号登录，自动发放 1000 额度
          </p>
        </div>
      </div>
    </div>
  )
}
