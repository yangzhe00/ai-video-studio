/**
 * 统一 API 客户端：fetch 封装 + JWT 注入 + 401 跳登录保留当前页（FR-E-04）
 * 约束：所有 API 调用必须走此层（AGENTS.md）
 */

const BASE = '/api'
const TOKEN_KEY = 'taskify_token'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** 登录过期处理器，由应用层注册（路由跳转保留当前页） */
let onUnauthorized: (() => void) | null = null
export function registerUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

/**
 * 发起 API 请求并解析 JSON
 * @throws ApiError 非 2xx 时抛出；401 触发登录跳转
 */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!(init?.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const resp = await fetch(`${BASE}${path}`, { ...init, headers })

  if (!resp.ok) {
    if (resp.status === 401) {
      clearToken()
      onUnauthorized?.()
    }
    const body = (await resp.json().catch(() => ({ code: 'unknown', message: '未知错误' }))) as {
      code?: string
      message?: string
    }
    throw new ApiError(resp.status, body.code ?? 'unknown', body.message ?? '请求失败')
  }
  return (await resp.json()) as T
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}

/** 文件上传（multipart，FR-B-02 批量上传） */
export async function upload<T>(path: string, files: File[]): Promise<T> {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return request<T>(path, { method: 'POST', headers, body: form })
}

export * from './endpoints'
