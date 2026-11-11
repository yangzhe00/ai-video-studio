import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { clearToken, registerUnauthorizedHandler } from '@taskify/api-client'
import { router } from './routes'
import { useAuthStore } from './stores/auth'
import { syncTheme } from './stores/theme'
import './index.css'

// 首屏主题与 <html data-theme> 对齐（内联脚本已提前写入，避免闪白）
syncTheme()

// 会话过期：清 token 跳登录并保留当前页（FR-E-04）
registerUnauthorizedHandler(() => {
  clearToken()
  useAuthStore.getState().reset()
  const current = window.location.pathname + window.location.search
  if (!current.startsWith('/login')) {
    window.location.href = `/login?redirect=${encodeURIComponent(current)}`
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
