import { create } from 'zustand'

/** 可选配色方案（新增主题：在 03-themes.css 加 [data-theme='x'] + 此处加一项即可） */
export type ThemeId = 'aurora' | 'daylight' | 'ocean' | 'graphite'

export interface ThemeMeta {
  id: ThemeId
  label: string
  /** 切换器上的色点，取值与主题 --grad-brand 一致 */
  dot: string
}

export const THEMES: readonly ThemeMeta[] = [
  { id: 'aurora', label: '深空极光', dot: 'linear-gradient(135deg,#4e6bff,#9b5cff)' },
  { id: 'daylight', label: '日光浅色', dot: 'linear-gradient(135deg,#1a73e8,#8ab4f8)' },
  { id: 'ocean', label: '深海青', dot: 'linear-gradient(135deg,#12b5a6,#3ad6c4)' },
  { id: 'graphite', label: '石墨金', dot: 'linear-gradient(135deg,#e0b15c,#f6dfa6)' },
] as const

export const THEME_STORAGE_KEY = 'taskify_theme'

/** 默认主题 = 设计稿配色 */
export const DEFAULT_THEME: ThemeId = 'aurora'

function isThemeId(v: string | null): v is ThemeId {
  return v !== null && THEMES.some((t) => t.id === v)
}

/** 读取持久化主题（首屏由 index.html 内联脚本提前写入，避免闪烁） */
function readInitial(): ThemeId {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemeId(saved)) return saved
  } catch {
    /* 隐私模式下 localStorage 不可用，回落到默认主题 */
  }
  return DEFAULT_THEME
}

interface ThemeState {
  theme: ThemeId
  setTheme: (id: ThemeId) => void
}

/** 主题切换：一键换肤，只改 <html data-theme>，组件层无感知 */
export const useThemeStore = create<ThemeState>((set) => ({
  theme: readInitial(),
  setTheme: (id: ThemeId) => {
    document.documentElement.dataset.theme = id
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, id)
    } catch {
      /* 忽略写入失败，本次会话内仍生效 */
    }
    set({ theme: id })
  },
}))

/** 首屏同步（main.tsx 调用）：确保 DOM 与 store 一致 */
export function syncTheme(): void {
  document.documentElement.dataset.theme = useThemeStore.getState().theme
}
