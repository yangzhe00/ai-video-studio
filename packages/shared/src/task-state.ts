/**
 * 任务状态机（全站统一，PRD 1.1）
 * 草稿 → 已提交 → 排队中 → 生成中 → 成功 / 失败
 * 失败 → (重试) → 已提交
 * 成功 → 已使用 → 已合成 → 已导出
 * 草稿 → 已作废
 */
export const TaskState = {
  Draft: 'draft',
  Submitted: 'submitted',
  Queued: 'queued',
  Running: 'running',
  Success: 'success',
  Failed: 'failed',
  Used: 'used',
  Composed: 'composed',
  Exported: 'exported',
  Voided: 'voided',
} as const

export type TaskState = (typeof TaskState)[keyof typeof TaskState]

/** 合法状态流转表（唯一事实来源，前后端共用） */
export const TaskTransitions: Record<TaskState, TaskState[]> = {
  draft: [TaskState.Submitted, TaskState.Voided],
  submitted: [TaskState.Queued],
  queued: [TaskState.Running],
  running: [TaskState.Success, TaskState.Failed],
  failed: [TaskState.Submitted, TaskState.Voided],
  success: [TaskState.Used, TaskState.Voided],
  used: [TaskState.Composed],
  composed: [TaskState.Exported],
  exported: [],
  voided: [],
}

/** 任务类型 */
export const TaskType = {
  ImageGen: 'image_gen',
  VideoGen: 'video_gen',
  Tts: 'tts',
  Compose: 'compose',
} as const

export type TaskType = (typeof TaskType)[keyof typeof TaskType]

/** 失败分类枚举（PRD 1.1） */
export const FailCategory = {
  Param: 'param_error',
  Quota: 'quota_insufficient',
  Provider: 'provider_fault',
  Review: 'content_review_rejected',
  Timeout: 'timeout',
} as const

export type FailCategory = (typeof FailCategory)[keyof typeof FailCategory]

/** 审核不通过不允许重试（PRD FR-E-02） */
export const RETRY_FORBIDDEN: readonly FailCategory[] = [FailCategory.Review]
