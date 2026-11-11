/**
 * 业务 API 定义（统一走 api-client，AGENTS.md 约束）
 * 类型来自 @taskify/shared，与后端 Pydantic 契约对齐
 */
import type {
  Asset,
  CompositionVersion,
  QuotaLedgerEntry,
  Script,
  Task,
  Template,
  Topic,
  User,
} from '@taskify/shared'
import { del, get, patch, post, upload } from './index'

export interface QuotaInfo {
  balance: number
  warn: boolean
  warnThreshold: number
  ledger: QuotaLedgerEntry[]
}

export interface ComposeCheck {
  missing: string[]
  ready: boolean
}

/** 片段视图（后端按段聚合最新片段） */
export interface ClipView {
  segmentIndex: number
  clipId: string | null
  videoUrl: string | null
  durationSec: number
}

/** 成片版本视图 */
export interface CompositionItem extends CompositionVersion {
  topicTitle: string
}

export const api = {
  /** 发送验证码（演示模式返回 code） */
  sendCode: (phone: string) => post<{ demoCode: string }>('/auth/send-code', { phone }),
  /** 登录换取 token */
  login: (phone: string, code: string) => post<{ token: string }>('/auth/login', { phone, code }),
  /** 当前用户 */
  me: () => get<User>('/me'),

  generateTopics: (keyword: string) => post<Topic[]>('/topics/generate', { keyword }),
  listTopics: (status?: string) => get<Topic[]>(`/topics${status ? `?status=${status}` : ''}`),
  selectTopic: (id: string) => post<Topic>(`/topics/${id}/select`),
  deleteTopic: (id: string) => del<{ ok: boolean }>(`/topics/${id}`),
  generateScript: (topicId: string) => post<Script>(`/topics/${topicId}/script`),
  getScript: (topicId: string) => get<Script>(`/scripts?topic_id=${topicId}`),
  saveScript: (scriptId: string, segments: Script['segments']) =>
    patch<Script>(`/scripts/${scriptId}`, { segments }),
  generatePrompts: (scriptId: string) => post<Script>(`/scripts/${scriptId}/prompts`),

  uploadAssets: (files: File[]) => upload<Asset[]>('/assets/upload', files),
  generateImage: (prompt: string) => post<{ taskId: string }>('/assets/generate', { prompt }),
  listAssets: () => get<Asset[]>('/assets'),

  submitVideoGen: (body: { scriptId: string; segmentIndex: number; assetId: string; prompt: string }) =>
    post<Task>('/tasks/video-gen', body),
  listTasks: (filter?: { type?: string; state?: string }) => {
    const q = new URLSearchParams()
    if (filter?.type) q.set('type', filter.type)
    if (filter?.state) q.set('state', filter.state)
    const s = q.toString()
    return get<Task[]>(`/tasks${s ? `?${s}` : ''}`)
  },
  retryTask: (id: string) => post<Task>(`/tasks/${id}/retry`),
  voidTask: (id: string) => post<Task>(`/tasks/${id}/void`),
  deleteClip: (clipId: string) => del<{ ok: boolean }>(`/tasks/clips/${clipId}`),

  listTemplates: () => get<Template[]>('/templates'),
  generateTts: (scriptId: string) => post<{ taskIds: string[] }>('/compose/tts', { scriptId }),
  checkCompose: (scriptId: string) => get<ComposeCheck>(`/compose/check?script_id=${scriptId}`),
  submitCompose: (scriptId: string, templateId: string) =>
    post<{ taskId: string; compositionId: string; versionNo: number }>('/compose', { scriptId, templateId }),
  listCompositions: () => get<CompositionItem[]>('/compositions'),
  listClips: (scriptId: string) => get<ClipView[]>(`/clips?script_id=${scriptId}`),
  deleteComposition: (id: string) => del<{ ok: boolean }>(`/compositions/${id}`),

  quota: () => get<QuotaInfo>('/quota'),
}
