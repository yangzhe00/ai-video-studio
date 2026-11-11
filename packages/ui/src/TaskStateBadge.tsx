import { TaskState, FailCategory, type TaskState as TaskStateType, type FailCategory as FailCategoryType } from '@taskify/shared'

/** 状态 → 徽章修饰类（半透明药丸，色值由主题令牌决定） */
const stateCls: Record<TaskStateType, string> = {
  [TaskState.Draft]: 'badge--draft',
  [TaskState.Submitted]: 'badge--submitted',
  [TaskState.Queued]: 'badge--queued',
  [TaskState.Running]: 'badge--running',
  [TaskState.Success]: 'badge--success',
  [TaskState.Failed]: 'badge--failed',
  [TaskState.Used]: 'badge--queued',
  [TaskState.Composed]: 'badge--composed',
  [TaskState.Exported]: 'badge--exported',
  [TaskState.Voided]: 'badge--voided',
}

const stateLabel: Record<TaskStateType, string> = {
  [TaskState.Draft]: '草稿',
  [TaskState.Submitted]: '已提交',
  [TaskState.Queued]: '排队中',
  [TaskState.Running]: '生成中',
  [TaskState.Success]: '成功',
  [TaskState.Failed]: '失败',
  [TaskState.Used]: '已使用',
  [TaskState.Composed]: '已合成',
  [TaskState.Exported]: '已导出',
  [TaskState.Voided]: '已作废',
}

const failLabel: Record<FailCategoryType, string> = {
  [FailCategory.Param]: '参数错误',
  [FailCategory.Quota]: '额度不足',
  [FailCategory.Provider]: '供应商故障',
  [FailCategory.Review]: '审核不通过',
  [FailCategory.Timeout]: '超时',
}

/** 状态徽章：状态色统一（成功绿/失败红/进行中蓝/排队灰） */
export function TaskStateBadge({ state, failCategory }: { state: TaskStateType; failCategory?: FailCategoryType | null }): React.ReactElement {
  return (
    <span className={`badge ${stateCls[state]}`}>
      {stateLabel[state]}
      {state === TaskState.Failed && failCategory ? `· ${failLabel[failCategory]}` : ''}
    </span>
  )
}
