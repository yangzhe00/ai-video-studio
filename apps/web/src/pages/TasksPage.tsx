import { useState } from 'react'
import { useNavigate } from 'react-router'
import { TaskState, TaskType } from '@taskify/shared'
import { api } from '@taskify/api-client'
import { Button, EmptyState, PageHeader, Skeleton, TaskStateBadge } from '@taskify/ui'
import { useTasks } from '../hooks/useTasks'

const TYPE_LABEL: Record<string, string> = {
  [TaskType.ImageGen]: '生图',
  [TaskType.VideoGen]: '生视频',
  [TaskType.Tts]: '配音',
  [TaskType.Compose]: '合成',
}

const STATES = [
  { value: '', label: '全部状态' },
  { value: TaskState.Queued, label: '排队中' },
  { value: TaskState.Running, label: '生成中' },
  { value: TaskState.Success, label: '成功' },
  { value: TaskState.Failed, label: '失败' },
]

/** 任务中心页（E 域：统一看板 / 筛选 / 失败分类 / 重试规则） */
export function TasksPage(): React.ReactElement {
  const navigate = useNavigate()
  const [type, setType] = useState('')
  const [state, setState] = useState('')
  const { tasks, loading, error, refresh } = useTasks({ type: type || undefined, state: state || undefined })
  const [actionError, setActionError] = useState<string | null>(null)

  /** 重试：审核不通过/参数错误由后端拒绝，前端展示原因 */
  async function handleRetry(id: string): Promise<void> {
    setActionError(null)
    try {
      await api.retryTask(id)
      await refresh()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '重试失败')
    }
  }

  return (
    <div>
      <PageHeader
        title="任务中心"
        description="全站异步任务看板，长时任务可离开页面稍后回来查看"
        actions={
          <Button variant="secondary" onClick={() => void refresh()}>
            刷新
          </Button>
        }
      />

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <select className="select" style={{ width: 150 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">全部类型</option>
          {Object.entries(TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 150 }} value={state} onChange={(e) => setState(e.target.value)}>
          {STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {(error ?? actionError) && (
        <p className="alert alert--error" style={{ marginBottom: 'var(--space-4)' }}>
          {actionError ?? error}
        </p>
      )}
      {loading && <Skeleton rows={4} />}

      {!loading && tasks.length === 0 && (
        <EmptyState
          title="暂无任务"
          description="从选题开始创建你的第一个生成任务"
          action={<Button onClick={() => navigate('/topic')}>去选题</Button>}
        />
      )}

      {tasks.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {tasks.map((t) => (
            <article key={t.id} className="list__row list__row--hover">
              <span className="meta" style={{ width: 56 }}>
                {TYPE_LABEL[t.type] ?? t.type}
              </span>
              <TaskStateBadge state={t.state} failCategory={t.failCategory} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="truncate" style={{ margin: 0, fontSize: 'var(--text-base)' }}>
                  {String(t.params?.prompt ?? t.params?.text ?? t.params?.output_key ?? '—')}
                </p>
                <p className="meta">
                  {new Date(t.createdAt).toLocaleString('zh-CN')} · 消耗 {t.consumedQuota} 额度
                  {t.failDetail ? ` · ${t.failDetail.slice(0, 60)}` : ''}
                </p>
              </div>
              {t.state === TaskState.Failed && (
                <Button size="sm" variant="secondary" onClick={() => void handleRetry(t.id)}>
                  重试
                </Button>
              )}
              {t.sourcePage && (
                <Button size="sm" variant="ghost" onClick={() => navigate(t.sourcePage!)}>
                  去处理
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
