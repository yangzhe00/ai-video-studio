import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@taskify/api-client'
import type { CompositionItem, QuotaInfo } from '@taskify/api-client'
import { Button, EmptyState, PageHeader, TaskStateBadge } from '@taskify/ui'
import { useWorkspaceStore } from '../stores/workspace'

const STEPS = [
  { to: '/topic', step: '01', title: '选题与讲稿', desc: '生成选题、分段讲稿与分镜提示词' },
  { to: '/assets', step: '02', title: '素材库', desc: '上传图片或站内 AI 生图' },
  { to: '/generate', step: '03', title: '生成任务', desc: '逐段关联图文，生成视频片段' },
  { to: '/compose', step: '04', title: '合成工作台', desc: '选模板、AI 配音、自动字幕、合成' },
  { to: '/output', step: '05', title: '成片库', desc: '预览、下载 mp4 与版本历史' },
] as const

/** 工作台首页：黄金任务流入口 + 额度概览 + 最近成片 */
export function HomePage(): React.ReactElement {
  const navigate = useNavigate()
  const { topic, script } = useWorkspaceStore()
  const [quota, setQuota] = useState<QuotaInfo | null>(null)
  const [comps, setComps] = useState<CompositionItem[]>([])

  useEffect(() => {
    void api.quota().then(setQuota).catch(() => setQuota(null))
    void api.listCompositions().then(setComps).catch(() => setComps([]))
  }, [])

  const doneSegments = script ? script.segments.filter((s) => s.clipId).length : 0
  const totalSegments = script ? script.segments.length : 0

  return (
    <div>
      <PageHeader
        title="工作台"
        description="从选题灵感到竖屏成片，5 步完成一条视频"
        actions={<Button onClick={() => navigate('/topic')}>开始创作</Button>}
      />

      {/* 当前创作上下文：让用户随时知道「做到哪一步了」 */}
      <section className="card card--pad" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="row-between" style={{ flexWrap: 'wrap' }}>
          <div className="stack-1" style={{ minWidth: 260 }}>
            <span className="kicker">当前创作</span>
            <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)' }}>
              {topic?.title ?? '尚未选择选题'}
            </span>
            <span className="hint">
              {script
                ? `讲稿 ${totalSegments} 段 · 已生成片段 ${doneSegments}/${totalSegments}`
                : '从「选题与讲稿」开始，输入关键词生成 5 条选题'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Button variant="secondary" size="sm" onClick={() => navigate('/topic')}>
              选题与讲稿
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/generate')}>
              生成片段
            </Button>
            <Button size="sm" onClick={() => navigate('/compose')}>
              去合成
            </Button>
          </div>
        </div>
      </section>

      <section className="grid-5" style={{ marginBottom: 'var(--space-5)' }}>
        {STEPS.map((s) => (
          <button key={s.to} type="button" className="tile" onClick={() => navigate(s.to)}>
            <span className="tile__index">{s.step}</span>
            <p className="tile__title">{s.title}</p>
            <p className="tile__desc">{s.desc}</p>
          </button>
        ))}
      </section>

      <div className="grid-3">
        <section className="card card--pad">
          <h2 className="card__title">额度概览</h2>
          {quota ? (
            <>
              <p className="stat__value num" style={{ marginTop: 'var(--space-3)' }}>
                {quota.balance.toFixed(0)}
                <span className="stat__unit">额度</span>
              </p>
              <div className="bar" style={{ marginTop: 'var(--space-3)' }}>
                <div
                  className={`bar__fill${quota.warn ? ' bar__fill--warn' : ''}`}
                  style={{ width: `${Math.max(4, Math.min(100, (quota.balance / Math.max(quota.balance + 1, 1000)) * 100))}%` }}
                />
              </div>
              {quota.warn && (
                <p className="alert alert--warn" style={{ marginTop: 'var(--space-3)' }}>
                  余额低于预警线，提交任务将受限
                </p>
              )}
              <Button variant="secondary" size="sm" block onClick={() => navigate('/usage')} className="mt-3">
                查看明细
              </Button>
            </>
          ) : (
            <p className="hint" style={{ marginTop: 'var(--space-3)' }}>
              加载中…
            </p>
          )}
        </section>

        <section className="card card--pad" style={{ gridColumn: 'span 2' }}>
          <div className="card__head">
            <h2 className="card__title">
              最近成片 <span className="section-title__count">{comps.length}</span>
            </h2>
            {comps.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => navigate('/output')}>
                全部
              </Button>
            )}
          </div>
          {comps.length === 0 ? (
            <EmptyState title="还没有成片" description="完成合成后成片会出现在这里" />
          ) : (
            <div className="stack-2">
              {comps.slice(0, 3).map((c) => (
                <div key={c.id} className="list__row list__row--hover" style={{ paddingInline: 0, borderRadius: 'var(--radius-md)' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="truncate" style={{ fontSize: 'var(--text-base)' }}>
                      {c.topicTitle}
                    </p>
                    <p className="meta">
                      v{c.versionNo} · {new Date(c.createdAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <TaskStateBadge state={c.status} />
                  <Button size="sm" variant="secondary" onClick={() => navigate('/output')}>
                    查看
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
