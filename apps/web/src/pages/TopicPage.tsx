import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Script, Topic } from '@taskify/shared'
import { api } from '@taskify/api-client'
import { Button, EmptyState, Input, PageHeader, Skeleton } from '@taskify/ui'
import { useWorkspaceStore } from '../stores/workspace'

/** 选题与讲稿页（A 域：选题生成 / 讲稿分段编辑 / 分镜提示词 / 草稿） */
export function TopicPage(): React.ReactElement {
  const navigate = useNavigate()
  const { topic, script, setTopic, setScript, patchScript } = useWorkspaceStore()

  const [keyword, setKeyword] = useState('')
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedHint, setSavedHint] = useState(false)

  useEffect(() => {
    void api
      .listTopics()
      .then(setTopics)
      .catch(() => setTopics([]))
  }, [])

  /** 生成选题（5 条，防重复点击） */
  async function handleGenerate(): Promise<void> {
    if (!keyword.trim()) return
    setLoading(true)
    setError(null)
    try {
      const list = await api.generateTopics(keyword.trim())
      setTopics((prev) => [...list, ...prev])
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  /** 选定选题 → 生成讲稿 */
  async function handleSelect(t: Topic): Promise<void> {
    setBusy(t.id)
    setError(null)
    try {
      const selected = await api.selectTopic(t.id)
      setTopic(selected)
      const s = await api.generateScript(selected.id)
      setScript(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : '讲稿生成失败')
    } finally {
      setBusy(null)
    }
  }

  /** 逐段编辑讲稿文本 */
  function updateSegment(index: number, text: string): void {
    if (!script) return
    const segments = script.segments.map((s) => (s.index === index ? { ...s, text } : s))
    patchScript({ ...script, segments })
    setSavedHint(false)
  }

  /** 保存讲稿 */
  async function handleSave(): Promise<void> {
    if (!script) return
    setBusy('save')
    try {
      const saved = await api.saveScript(script.id, script.segments)
      setScript(saved)
      setSavedHint(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(null)
    }
  }

  /** 生成分镜提示词 */
  async function handlePrompts(): Promise<void> {
    if (!script) return
    setBusy('prompts')
    try {
      const updated = await api.generatePrompts(script.id)
      setScript(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : '提示词生成失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHeader title="选题与讲稿" description="输入关键词生成 5 条选题，选定后生成分段讲稿与分镜提示词" />

      <section className="card card--pad" style={{ marginBottom: 'var(--space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div style={{ width: 320, maxWidth: '100%' }}>
            <Input
              label="创作领域 / 关键词"
              name="keyword"
              placeholder="例如：居家收纳"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <Button loading={loading} disabled={!keyword.trim()} onClick={handleGenerate}>
            生成选题
          </Button>
          <span className="hint" style={{ paddingBottom: 10 }}>
            每次生成 5 条
          </span>
        </div>
        {error && (
          <p className="alert alert--error" style={{ marginTop: 'var(--space-3)' }}>
            {error}
          </p>
        )}
      </section>

      <div className="grid-3">
        <section style={{ gridColumn: 'span 2' }} className="stack-3">
          <h2 className="section-title">
            选题列表 <span className="section-title__count">{topics.length}</span>
          </h2>
          {topics.length === 0 && !loading && <EmptyState title="还没有选题" description="输入关键词生成第一组选题灵感" />}
          {loading && <Skeleton rows={2} />}
          {topics.map((t) => (
            <article
              key={t.id}
              className={`card card--tight${topic?.id === t.id ? ' is-selected' : ''}`}
              style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}
            >
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)' }}>{t.title}</h3>
                <p className="hint" style={{ marginTop: 4 }}>
                  {t.angle}
                </p>
                {topic?.id === t.id && (
                  <span className="badge badge--success" style={{ marginTop: 8 }}>
                    当前选题
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant={topic?.id === t.id ? 'secondary' : 'primary'}
                loading={busy === t.id}
                onClick={() => void handleSelect(t)}
              >
                {topic?.id === t.id ? '已选' : '选为我的选题'}
              </Button>
            </article>
          ))}
        </section>

        <section className="stack-3">
          <h2 className="section-title">
            讲稿 <span className="section-title__count">{script ? `${script.segments.length} 段` : '未生成'}</span>
          </h2>
          {!script && <EmptyState title="未生成讲稿" description="先选定一个选题" />}
          {script && (
            <div className="stack-3">
              {script.segments.map((seg) => (
                <div key={seg.index} className="card card--tight">
                  <div className="row-between" style={{ marginBottom: 6 }}>
                    <span className="meta">第 {seg.index + 1} 段 · 5-10s</span>
                    {seg.prompt && <span className="badge badge--success">已有提示词</span>}
                  </div>
                  <textarea
                    value={seg.text}
                    onChange={(e) => updateSegment(seg.index, e.target.value)}
                    rows={3}
                    className="textarea"
                  />
                  {seg.prompt && <p className="hint" style={{ marginTop: 6 }}>提示词：{seg.prompt}</p>}
                </div>
              ))}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <Button size="sm" variant="secondary" loading={busy === 'save'} onClick={handleSave}>
                  保存讲稿
                </Button>
                <Button size="sm" loading={busy === 'prompts'} onClick={handlePrompts}>
                  生成分镜提示词
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate('/assets')}>
                  去准备素材
                </Button>
              </div>
              {savedHint && <p className="alert alert--ok">已保存（离开页面后可从草稿恢复）</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
