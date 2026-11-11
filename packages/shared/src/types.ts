/** 核心业务对象类型（与后端契约对齐，见 plan.md Data Model） */

export interface User {
  id: string
  phone: string
  quotaBalance: number
  quotaWarn: boolean
}

export interface Topic {
  id: string
  userId: string
  keyword: string
  title: string
  angle: string
  status: 'draft' | 'selected'
  createdAt: string
}

export interface ScriptSegment {
  index: number
  text: string
  /** 分镜画面提示词（FR-A-03，可编辑） */
  prompt: string
  /** 关联素材 ID（FR-B-03） */
  assetId: string | null
  /** 生成的片段 ID */
  clipId: string | null
}

export interface Script {
  id: string
  userId: string
  topicId: string
  segments: ScriptSegment[]
  updatedAt: string
}

export interface Asset {
  id: string
  userId: string
  source: 'upload' | 'generated'
  url: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

export interface Task {
  id: string
  userId: string
  type: import('./task-state').TaskType
  state: import('./task-state').TaskState
  failCategory: import('./task-state').FailCategory | null
  failDetail: string | null
  consumedQuota: number
  /** 跳回来源页（FR-E-01 任务中心跳转） */
  sourcePage: string | null
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  createdAt: string
  finishedAt: string | null
}

export interface Clip {
  id: string
  taskId: string
  segmentIndex: number
  videoUrl: string
  durationSec: number
}

export interface Template {
  id: string
  name: string
  /** 片头/片尾/字幕样式/BGM 配置 */
  style: Record<string, string>
}

export interface CompositionVersion {
  id: string
  topicId: string
  versionNo: number
  videoUrl: string
  status: import('./task-state').TaskState
  createdAt: string
}

export interface QuotaLedgerEntry {
  id: string
  taskId: string | null
  delta: number
  balanceAfter: number
  reason: string
  createdAt: string
}
