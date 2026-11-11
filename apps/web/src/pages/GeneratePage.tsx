import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Asset, FailCategory, ScriptSegment } from '@taskify/shared'
import { CONFIG } from '@taskify/shared'
import { api } from '@taskify/api-client'
import type { ClipView } from '@taskify/api-client'
import { Button, EmptyState, PageHeader, Skeleton, TaskStateBadge } from '@taskify/ui'
import { useWorkspaceStore } from '../stores/workspace'

interface SegmentRow {
  segment: ScriptSegment
  clip: ClipView | null
  state: 'idle' | 'queued' | 'running' | 'success' | 'failed'
  failCategory: string | null
}

/** 生成任务页（B 域：图文关联 / 生视频 / 片段管理，七类交互状态覆盖） */
export function GeneratePage(): React.ReactElement {
  const navigate = useNavigate()
  const { topic, script, setScript } = useWorkspaceStore()
  const [assets, setAssets] = useState<Asset[]>([])
  const [clips, setClips] = useState<ClipView[]>([])
  const [rows, setRows] = useState<SegmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshClips = useCallback(async (): Promise<void> => {
    if (!script) return
    const list = await api.listClips(script.id)
    setClips(list)
  }, [script])

  useEffect(() => {
    void (async () => {
      try {
        setAssets(await api.listAssets())
        if (script) await refreshClips()
      } finally {
        setLoading(false)
      }
    })()
  }, [script, refreshClips])

  // 片段结果合并进段落行（部分成功场景：成功段标记可用，失败段单独重试）
  useEffect(() => {
    if (!script) return
    setRows(
      script.segments.map((segment) => {
        const clip = clips.find((c) => c.segmentIndex === segment.index && c.clipId) ?? null
        return { segment, clip, state: clip ? 'success' : 'idle', failCategory: null }
      }),
    )
  }, [script, clips])

  /** 单段素材关联（写入讲稿并持久化） */
  async function bindAsset(index: number, assetId: string): Promise<void> {
    if (!script) return
    const segments = script.segments.map((s) => (s.index === index ? { ...s, assetId } : s))
    setScript({ ...script, segments })
    await api.saveScript(script.id, segments)
  }

  /** 提交全部可提交段落（额度不足时由后端 422 拦截并显示余额） */
  async function handleSubmitAll(): Promise<void> {
    if (!script) return
    setSubmitting(true)
    setError(null)
    try {
      for (const seg of script.segments) {
        if (seg.clipId) continue
        if (!seg.assetId) throw new Error(`第 ${seg.index + 1} 段未关联素材`)
        if (!seg.prompt) throw new Error(`第 ${seg.index + 1} 段缺少提示词`)
        await api.submitVideoGen({
          scriptId: script.id,
          segmentIndex: seg.index,
          assetId: seg.assetId,
          prompt: seg.prompt,
        })
      }
      await pollUntilDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  /** 轮询任务直到本讲稿所有生视频任务落定 */
  async function pollUntilDone(): Promise<void> {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      const tasks = await api.listTasks({ type: 'video_gen' })
      const mine = tasks.filter((t) => t.params?.scriptId === script?.id || t.params?.script_id === script?.id)
      setRows((prev) =>
        prev.map((r) => {
          const t = mine.find((x) => Number(x.params?.segment_index) === r.segment.index)
          if (!t) return r
          if (t.state === 'success') return { ...r, state: 'success', failCategory: null }
          if (t.state === 'failed') return { ...r, state: 'failed', failCategory: t.failCategory }
          if (t.state === 'running') return { ...r, state: 'running' }
          return { ...r, state: 'queued' }
        }),
      )
      await refreshClips()
      const allDone = mine.length > 0 && mine.every((t) => t.state === 'success' || t.state === 'failed')
      if (allDone) return
      await new Promise((r) => window.setTimeout(r, CONFIG.taskPollIntervalMs))
    }
  }

  /** 删除片段 */
  async function handleDeleteClip(clipId: string): Promise<void> {
    await api.deleteClip(clipId)
    await refreshClips()
  }

  if (!script) {
    return (
      <div>
        <PageHeader title="生成任务" description="逐段关联图片与提示词，生成动态视频片段" />
        <EmptyState
          title="还没有讲稿"
          description="先到「选题与讲稿」生成讲稿与分镜提示词"
          action={<Button onClick={() => navigate('/topic')}>去选题</Button>}
        />
      </div>
    )
  }

  const successCount = rows.filter((r) => r.state === 'success').length

  return (
    <div>
      <PageHeader
        title="生成任务"
        description={`${topic?.title ?? '当前讲稿'} · 已生成片段 ${successCount}/${rows.length}`}
        actions={
          <>
            <span className="meta">生视频 20 额度/段</span>
            <Button loading={submitting} onClick={handleSubmitAll}>
              提交生视频任务
            </Button>
          </>
        }
      />

      {error && <p className="alert alert--error" style={{ marginBottom: 'var(--space-4)' }}>{error}</p>}
      {loading && <Skeleton rows={3} />}

      <div className="grid-2">
        {rows.map(({ segment, clip, state, failCategory }) => (
          <article key={segment.index} className="card card--pad">
            <header className="card__head">
              <h3 className="card__title">第 {segment.index + 1} 段</h3>
              {state === 'idle' && <span className="meta">待生成</span>}
              {state === 'queued' && <TaskStateBadge state="queued" />}
              {state === 'running' && <TaskStateBadge state="running" />}
              {state === 'success' && <TaskStateBadge state="success" />}
              {state === 'failed' && <TaskStateBadge state="failed" failCategory={(failCategory ?? 'provider_fault') as FailCategory} />}
            </header>

            <p className="hint clamp-2" style={{ marginBottom: 8 }}>
              {segment.text}
            </p>
            <p
              className="clamp-2"
              style={{
                marginBottom: 12,
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--chip-bg)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-2)',
              }}
            >
              提示词：{segment.prompt || '（未生成，请到选题页生成）'}
            </p>

            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12 }}>
              {assets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => void bindAsset(segment.index, a.id)}
                  className={`thumb${segment.assetId === a.id ? ' is-active' : ''}`}
                  title={a.source === 'generated' ? 'AI 生图' : '本地上传'}
                >
                  <img src={a.url} alt="素材" />
                </button>
              ))}
              {assets.length === 0 && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/assets')}>
                  素材库为空，去上传 →
                </button>
              )}
            </div>

            {clip?.videoUrl ? (
              <div className="stack-2">
                <div className="media-frame">
                  <video src={clip.videoUrl} controls />
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Button size="sm" variant="secondary" onClick={() => void handleDeleteClip(clip.clipId!)}>
                    删除片段
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleSubmitAll}>
                    重新生成
                  </Button>
                </div>
              </div>
            ) : (
              <div className="media-frame">
                <span className="hint">{state === 'failed' ? '生成失败，可在任务中心重试' : '尚未生成片段'}</span>
              </div>
            )}
          </article>
        ))}
      </div>

      <div style={{ marginTop: 'var(--space-6)', display: 'flex', gap: 'var(--space-2)' }}>
        <Button variant="secondary" onClick={() => navigate('/assets')}>
          返回素材库
        </Button>
        <Button onClick={() => navigate('/compose')}>去合成工作台</Button>
      </div>
    </div>
  )
}
