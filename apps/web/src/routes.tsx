import { createBrowserRouter, Navigate } from 'react-router'
import { getToken } from '@taskify/api-client'
import { AppLayout } from './components/AppLayout'
import { LoginPage } from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import { TopicPage } from './pages/TopicPage'
import { AssetsPage } from './pages/AssetsPage'
import { GeneratePage } from './pages/GeneratePage'
import { ComposePage } from './pages/ComposePage'
import { OutputPage } from './pages/OutputPage'
import { TasksPage } from './pages/TasksPage'
import { UsagePage } from './pages/UsagePage'

/** 路由守卫：未登录跳登录页并保留来源（FR-E-04） */
function RequireAuth({ children }: { children: React.ReactNode }): React.ReactElement {
  if (!getToken()) {
    const current = window.location.pathname
    return <Navigate to={`/login?redirect=${encodeURIComponent(current)}`} replace />
  }
  return <>{children}</>
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'topic', element: <TopicPage /> },
      { path: 'assets', element: <AssetsPage /> },
      { path: 'generate', element: <GeneratePage /> },
      { path: 'compose', element: <ComposePage /> },
      { path: 'output', element: <OutputPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'usage', element: <UsagePage /> },
    ],
  },
])
