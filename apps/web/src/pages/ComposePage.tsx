import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Template } from '@taskify/shared'
import { CONFIG } from '@taskify/shared'
import { api } from '@taskify/api-client'
import type { ComposeCheck } from '@taskify/api-client'
import { Button, EmptyState, PageHeader, TaskStateBadge } from '@taskify/ui'
import { useWorkspaceStore } from '../stores/workspace'

/** 合成工作台页（C 域：模板 / 配音 / 字幕 / 要素校验 / 合成提交） */
export function ComposePage(): React.ReactElement {
  const navigate = useNavigate()
  const { topic, script, patchScript } = useWorkspaceStore()
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateId, setTemplateId] = useState<string>('')
  const [check, setCheck] = useState<ComposeCheck | null>(null)
  const [ttsState, setTtsState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  const [composing, setComposing] = useState(false)
  const [composeTask, setComposeTask] = useState<{ id: string; versionNo: number } | null>(null)
  const [composeState, setComposeState] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const refreshCheck = useCallback(async (): Promise<void> => {
    if (!script) return
    setCheck(await api.checkCompose(script.id))
  }, [script])

  useEffect(() => {
    void api.listTemplates().then((list) => {
      setTemplates(list)
      if (list[0]) setTemplateId(list[0].id)
    })
    void refreshCheck()
  }, [refreshCheck])

  /** 生成 AI 配音（分段 TTS，完成后可试听） */
  async function handleTts(): Promise<void> {
    if (!script) return
    setTtsState('running')
    setError(null)
    try {
      const { taskIds } = await api.generateTts(script.id)
      const deadline = Date.now() + 90_000
      while (Date.now() < deadline) {
        const tasks = await api.listTasks({ type: 'tts' })
        const mine = tasks.filter((t) => taskIds.includes(t.id))
        if (mine.every((t) => t.state === 'success')) {
          setTtsState('done')
          await refreshCheck()
          return
        }
        if (mine.some((t) => t.state === 'failed')) {
          setTtsState('failed')
          setError('配音生成失败，可重试')
          return
        }
        await new Promise((r) => window.setTimeout(r, CONFIG.taskPollIntervalMs))
      }
      setTtsState('failed')
      setError('配音生成超时')
    } catch (e) {
      setTtsState('failed')
      setError(e instanceof Error ? e.message : '配音任务提交失败')
    }
  }

  /** 字幕文本编辑（字幕随讲稿段落，保存即生效） */
  async function saveSubtitle(index: number, text: string): Promise<void> {
    if (!script) return
    const segments = script.segments.map((s) => (s.index === index ? { ...s, text } : s))
    patchScript({ ...script, segments })
    await api.saveScript(script.id, segments)
  }

  /** 提交合成（要素缺失时按钮禁用并列出缺什么） */
  async function handleCompose(): Promise<void> {
    if (!script || !templateId) return
    setComposing(true)
    setError(null)
    try {
      const resp = await api.submitCompose(script.id, templateId)
      setComposeTask({ id: resp.taskId, versionNo: resp.versionNo })
      const deadline = Date.now() + 180_000
      while (Date.now() < deadline) {
        const tasks = await api.listTasks({ type: 'compose' })
        const t = tasks.find((x) => x.id === resp.taskId)
        if (t) {
          setComposeState(t.state)
          if (t.state === 'success') return
          if (t.state === 'failed') {
            setError(t.failDetail ?? '合成失败，可重试')
            return
          }
        }
        await new Promise((r) => window.setTimeout(r, CONFIG.taskPollIntervalMs))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '合成提交失败')
    } finally {
      setComposing(false)
    }
  }

  if (!script) {
    return (
      <div>
        <PageHeader title="合成工作台" description="选模板、AI 配音、自动字幕，合成 9:16 成片" />
        <EmptyState
          title="还没有讲稿"
          description="先完成选题与讲稿，再准备片段"
          action={<Button onClick={() => navigate('/topic')}>去选题</Button>}
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="合成工作台" description={`${topic?.title ?? '当前讲稿'} · 9:16 竖屏成片`} />

      {error && <p className="alert alert--error" style={{ marginBottom: 'var(--space-4)' }}>{error}</p>}

      <div className="grid-3">
        <section className="stack-4" style={{ gridColumn: 'span 2' }}>
          <div className="card card--pad">
            <div className="card__head">
              <h2 className="card__title">
                <span className="card__step">1</span>
                选择模板 <span className="section-title__count">必选</span>
              </h2>
            </div>
            <div className="grid-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplateId(t.id)}
                  className={`card card--tight card--interactive${templateId === t.id ? ' is-selected' : ''}`}
                >
                  <p style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)' }}>{t.name}</p>
                  <p className="meta" style={{ marginTop: 4 }}>
                    {Object.values(t.style).slice(0, 2).join(' · ')}
                  </p>
                  {templateId === t.id && (
                    <span className="badge badge--success" style={{ marginTop: 8 }}>
                      已选中
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="card card--pad">
            <div className="card__head">
              <h2 className="card__title">
                <span className="card__step">2</span>
                AI 配音与字幕
              </h2>
              <Button size="sm" variant="secondary" loading={ttsState === 'running'} onClick={handleTts}>
                生成 AI 配音
              </Button>
            </div>
            {ttsState === 'done' && <p className="alert alert--ok" style={{ marginBottom: 8 }}>配音已生成，可试听确认</p>}
            <div className="stack-2">
              {script.segments.map((seg) => (
                <div
                  key={seg.index}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-3)',
                    padding: 8,
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--divider)',
                  }}
                >
                  <span className="meta" style={{ paddingTop: 6 }}>
                    #{seg.index + 1}
                  </span>
                  <textarea
                    defaultValue={seg.text}
                    onBlur={(e) => void saveSubtitle(seg.index, e.target.value)}
                    rows={2}
                    className="textarea"
                    style={{ flex: 1, background: 'var(--chip-bg)', borderColor: 'transparent', fontSize: 'var(--text-sm)' }}
                  />
                  {ttsState === 'done' && (
                    <span className="badge badge--success" style={{ marginTop: 6 }}>
                      已配音
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              字幕文本可修改，合成前自动保存
            </p>
          </div>
        </section>

        <aside className="stack-4">
          <div className="card card--pad">
            <h2 className="card__title" style={{ marginBottom: 'var(--space-3)' }}>
              <span className="card__step">3</span>
              合成要素校验
            </h2>
            {check?.ready ? (
              <p className="alert alert--ok">要素齐全，可以合成</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--warn-fg)', fontSize: 'var(--text-sm)' }}>
                {(check?.missing ?? ['正在校验…']).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            <Button
              block
              style={{ marginTop: 'var(--space-3)' }}
              disabled={!check?.ready}
              loading={composing}
              onClick={handleCompose}
            >
              提交合成（10 额度）
            </Button>
            {!check?.ready && (
              <p className="hint" style={{ marginTop: 8 }}>
                要素缺失时禁止提交
              </p>
            )}
          </div>

          {composeTask && (
            <div className="card card--pad">
              <div className="row-between" style={{ marginBottom: 'var(--space-2)' }}>
                <h2 className="card__title">合成进度</h2>
                <TaskStateBadge state={(composeState || 'running') as never} />
              </div>
              <p className="meta">v{composeTask.versionNo} 版本</p>
              {composeState === 'success' && (
                <Button block style={{ marginTop: 'var(--space-3)' }} onClick={() => navigate('/output')}>
                  查看成片
                </Button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
