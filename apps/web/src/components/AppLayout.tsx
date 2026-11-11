import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { api, clearToken } from '@taskify/api-client'
import type { QuotaInfo } from '@taskify/api-client'
import { useAuthStore } from '../stores/auth'
import { ThemeSwitcher } from './ThemeSwitcher'
import {
  IconActivity,
  IconDownload,
  IconFilm,
  IconHome,
  IconImage,
  IconLayers,
  IconLogout,
  IconSparkles,
  IconWallet,
} from './icons'

interface NavItemMeta {
  to: string
  label: string
  short: string
  icon: React.ReactElement
  end?: boolean
}

const NAV_GROUPS: { group: string; items: NavItemMeta[] }[] = [
  {
    group: '创作流程',
    items: [
      { to: '/', label: '工作台', short: '工作台', icon: <IconHome />, end: true },
      { to: '/topic', label: '选题与讲稿', short: '选题与讲稿', icon: <IconSparkles /> },
      { to: '/assets', label: '素材库', short: '素材库', icon: <IconImage /> },
      { to: '/generate', label: '生成任务', short: '生成任务', icon: <IconFilm /> },
      { to: '/compose', label: '合成工作台', short: '合成工作台', icon: <IconLayers /> },
      { to: '/output', label: '成片库', short: '成片库', icon: <IconDownload /> },
    ],
  },
  {
    group: '运营',
    items: [
      { to: '/tasks', label: '任务中心', short: '任务中心', icon: <IconActivity /> },
      { to: '/usage', label: '用量与额度', short: '用量与额度', icon: <IconWallet /> },
    ],
  },
]

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items)

/** 全局布局壳：左侧导航 + 顶栏（换肤 / 额度 / 账号）+ 内容容器 */
export function AppLayout(): React.ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const phone = useAuthStore((s) => s.phone)
  const [quota, setQuota] = useState<QuotaInfo | null>(null)

  // 顶栏额度随路由刷新（任务提交会消耗额度）
  useEffect(() => {
    void api
      .quota()
      .then(setQuota)
      .catch(() => setQuota(null))
  }, [location.pathname])

  const current = ALL_ITEMS.find((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to))) ?? ALL_ITEMS[0]

  function handleLogout(): void {
    clearToken()
    useAuthStore.getState().reset()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <span className="app-brand__mark">TF</span>
          <span className="app-brand__text">
            <span className="app-brand__name">Taskify</span>
            <span className="app-brand__sub">video studio</span>
          </span>
        </div>

        <nav className="app-nav">
          {NAV_GROUPS.map((g) => (
            <div key={g.group}>
              <div className="app-nav__group">{g.group}</div>
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
                >
                  <span className="nav-item__icon">{item.icon}</span>
                  <span className="nav-item__label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="user-card">
          <span className="user-card__avatar">{phone ? phone.slice(-2) : 'TF'}</span>
          <span className="user-card__meta">
            <span className="user-card__name">{phone ?? '未登录'}</span>
            <span className="user-card__role">演示账号 · 独立额度</span>
          </span>
          <button type="button" className="icon-btn" onClick={handleLogout} title="退出登录" aria-label="退出登录">
            <IconLogout />
          </button>
        </div>
      </aside>

      <main className="app-main">
        <header className="app-topbar">
          <div className="topbar__left">
            <span className="topbar__crumb">
              视频成片工作台 / <strong>{current.short}</strong>
            </span>
          </div>
          <div className="topbar__right">
            <ThemeSwitcher />
            <NavLink to="/usage" className="quota-chip">
              可用额度
              <span className="quota-chip__value num">{quota ? quota.balance.toFixed(0) : '—'}</span>
            </NavLink>
            <button type="button" className="icon-btn" onClick={handleLogout} title="退出登录" aria-label="退出登录">
              <IconLogout />
            </button>
          </div>
        </header>

        <div className="app-content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
