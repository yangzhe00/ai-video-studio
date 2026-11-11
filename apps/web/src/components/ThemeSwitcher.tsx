import { THEMES, useThemeStore } from '../stores/theme'

/** 配色方案一键切换：药丸色点组，选中态跟随主题描边 */
export function ThemeSwitcher(): React.ReactElement {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <div className="theme-switch" role="group" aria-label="配色方案">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.label}
          aria-label={`切换为${t.label}`}
          aria-pressed={theme === t.id}
          className={`theme-switch__btn${theme === t.id ? ' is-active' : ''}`}
          onClick={() => setTheme(t.id)}
        >
          <span className="theme-switch__dot" style={{ backgroundImage: t.dot }} />
        </button>
      ))}
    </div>
  )
}
