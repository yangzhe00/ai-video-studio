import { useCallback, useEffect, useState } from 'react'
import type { Task } from '@taskify/shared'
import { CONFIG } from '@taskify/shared'
import { api } from '@taskify/api-client'

/**
 * 任务列表轮询 hook（长时任务不阻塞页面，任务中心/页内共用）
 * @param filter 类型/状态筛选
 * @param enabled 是否启用轮询
 */
export function useTasks(filter?: { type?: string; state?: string }, enabled = true) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setTasks(await api.listTasks(filter))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '任务加载失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter?.type, filter?.state])

  useEffect(() => {
    void refresh()
    if (!enabled) return
    const timer = window.setInterval(() => void refresh(), CONFIG.taskPollIntervalMs)
    return () => window.clearInterval(timer)
  }, [refresh, enabled])

  return { tasks, loading, error, refresh }
}
