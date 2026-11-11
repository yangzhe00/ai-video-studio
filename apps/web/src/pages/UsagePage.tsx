import { useEffect, useState } from 'react'
import { api } from '@taskify/api-client'
import type { QuotaInfo } from '@taskify/api-client'
import { Button, PageHeader, Skeleton } from '@taskify/ui'

/** 用量与额度页（E 域：余额 / 20% 预警 / 消耗明细 FR-E-03） */
export function UsagePage(): React.ReactElement {
  const [info, setInfo] = useState<QuotaInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    try {
      setInfo(await api.quota())
    } catch (e) {
      setError(e instanceof Error ? e.message : '额度加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const spent = info ? info.ledger.filter((l) => l.delta < 0).reduce((s, l) => s - l.delta, 0) : 0
  const total = info ? Math.max(info.balance + spent, 1) : 1
  const usedRatio = info ? Math.min(1, spent / total) : 0

  return (
    <div>
      <PageHeader
        title="用量与额度"
        description="每用户独立额度，任务提交前预检，低于 20% 预警"
        actions={
          <Button variant="secondary" onClick={() => void refresh()}>
            刷新
          </Button>
        }
      />

      {error && <p className="alert alert--error" style={{ marginBottom: 'var(--space-4)' }}>{error}</p>}
      {loading && <Skeleton rows={3} />}

      {info && (
        <>
          <section className="grid-3" style={{ marginBottom: 'var(--space-5)' }}>
            <div className="card card--pad">
              <p className="stat__label">当前余额</p>
              <p className="stat__value num" style={{ marginTop: 4 }}>
                {info.balance.toFixed(0)}
                <span className="stat__unit">额度</span>
              </p>
              <p className="meta" style={{ marginTop: 4 }}>
                累计消耗 {spent.toFixed(0)} · 预警线 {info.warnThreshold.toFixed(0)}
              </p>
            </div>
            <div className="card card--pad" style={{ gridColumn: 'span 2' }}>
              <div className="row-between">
                <span className="stat__label">额度使用进度</span>
                <span className="meta num">{Math.round(usedRatio * 100)}%</span>
              </div>
              <div className="bar" style={{ marginTop: 'var(--space-3)' }}>
                <div
                  className={`bar__fill${info.warn ? ' bar__fill--warn' : ''}`}
                  style={{ width: `${Math.max(3, Math.round(usedRatio * 100))}%` }}
                />
              </div>
              {info.warn ? (
                <p className="alert alert--warn" style={{ marginTop: 'var(--space-3)' }}>
                  额度低于 20% 预警线，提交任务可能被拦截
                </p>
              ) : (
                <p className="hint" style={{ marginTop: 'var(--space-3)' }}>
                  额度充足，可正常提交生成任务
                </p>
              )}
            </div>
          </section>

          <h2 className="section-title">
            消耗明细 <span className="section-title__count">{info.ledger.length}</span>
          </h2>
          <div className="card" style={{ overflow: 'hidden' }}>
            {info.ledger.length === 0 && (
              <p className="hint" style={{ padding: '32px 0', textAlign: 'center' }}>
                暂无消耗记录
              </p>
            )}
            {info.ledger.map((l) => (
              <div key={l.id} className="list__row list__row--hover">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="truncate" style={{ margin: 0, fontSize: 'var(--text-base)' }}>
                    {l.reason}
                  </p>
                  <p className="meta">{new Date(l.createdAt).toLocaleString('zh-CN')}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p
                    className="num"
                    style={{
                      margin: 0,
                      fontSize: 'var(--text-base)',
                      fontWeight: 600,
                      color: l.delta < 0 ? 'var(--err-fg)' : 'var(--ok-fg)',
                    }}
                  >
                    {l.delta > 0 ? '+' : ''}
                    {l.delta.toFixed(0)}
                  </p>
                  <p className="meta num">余额 {l.balanceAfter.toFixed(0)}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
