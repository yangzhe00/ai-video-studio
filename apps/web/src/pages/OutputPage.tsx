import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@taskify/api-client'
import type { CompositionItem } from '@taskify/api-client'
import { Button, EmptyState, PageHeader, Skeleton, TaskStateBadge } from '@taskify/ui'

/** 成片库页（D 域：预览 / 下载 / 版本历史 FR-D-01/02） */
export function OutputPage(): React.ReactElement {
  const navigate = useNavigate()
  const [items, setItems] = useState<CompositionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<CompositionItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh(): Promise<void> {
    try {
      const list = await api.listCompositions()
      setItems(list)
      setActive((prev) => prev ?? list.find((i) => i.videoUrl) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '成片加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  /** 下载文件名：选题标题_YYYYMMDD.mp4（FR-D-01） */
  function downloadName(item: CompositionItem): string {
    const d = new Date(item.createdAt)
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    return `${item.topicTitle}_${ymd}_v${item.versionNo}.mp4`
  }

  async function handleDownload(item: CompositionItem): Promise<void> {
    if (!item.videoUrl) return
    setBusy(true)
    try {
      const resp = await fetch(item.videoUrl)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = downloadName(item)
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string): Promise<void> {
    await api.deleteComposition(id)
    setActive(null)
    await refresh()
  }

  return (
    <div>
      <PageHeader
        title="成片库"
        description="在线预览、下载 mp4、同一选题版本历史（保留最近 10 版）"
        actions={
          <Button variant="secondary" onClick={() => void refresh()}>
            刷新
          </Button>
        }
      />

      {error && <p className="alert alert--error" style={{ marginBottom: 'var(--space-4)' }}>{error}</p>}
      {loading && <Skeleton rows={3} />}

      {!loading && items.length === 0 && (
        <EmptyState
          title="还没有成片"
          description="完成片段生成与配音后到合成工作台合成"
          action={<Button onClick={() => navigate('/compose')}>去合成</Button>}
        />
      )}

      {items.length > 0 && (
        <div className="grid-3">
          <section className="card card--pad" style={{ gridColumn: 'span 2' }}>
            {active?.videoUrl ? (
              <>
                <div className="media-frame" style={{ height: 480 }}>
                  <video key={active.id} src={active.videoUrl} controls />
                </div>
                <div className="row-between" style={{ marginTop: 'var(--space-3)' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 'var(--weight-medium)' }}>{active.topicTitle}</p>
                    <p className="meta">
                      v{active.versionNo} · {new Date(active.createdAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <Button loading={busy} onClick={() => void handleDownload(active)}>
                    下载 mp4
                  </Button>
                </div>
              </>
            ) : (
              <p className="hint" style={{ padding: '96px 0', textAlign: 'center' }}>
                该版本尚未生成成片
              </p>
            )}
          </section>

          <section className="stack-2">
            <h2 className="section-title">
              版本历史 <span className="section-title__count">{items.length}</span>
            </h2>
            {items.map((it) => (
              <article
                key={it.id}
                className={`card card--tight card--interactive${active?.id === it.id ? ' is-selected' : ''}`}
                onClick={() => setActive(it)}
              >
                <div className="row-between">
                  <p style={{ margin: 0, fontFamily: 'var(--font-num)', fontSize: 'var(--text-base)', fontWeight: 600 }}>
                    v{it.versionNo}
                  </p>
                  <TaskStateBadge state={it.status} />
                </div>
                <p className="meta truncate" style={{ marginTop: 4 }}>
                  {it.topicTitle}
                </p>
                <div className="row-between" style={{ marginTop: 8 }}>
                  <span className="meta">{new Date(it.createdAt).toLocaleDateString('zh-CN')}</span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ color: 'var(--err-fg)', padding: '2px 6px' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDelete(it.id)
                    }}
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </section>
        </div>
      )}
    </div>
  )
}
