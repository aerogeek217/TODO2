import { useNavigate, useLocation } from 'react-router'
import { useSettingsStore } from '../../stores/settings-store'
import { useResolvedTheme } from '../../hooks/use-resolved-theme'
import { useUIStore } from '../../stores/ui-store'
import { formatShortcut } from '../../utils/platform'
import { ROUTE_WORKSPACE } from '../../routes'
import styles from './Sidebar.module.css'

const views = [
  {
    path: ROUTE_WORKSPACE,
    label: 'Workspace',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="2.5" width="12" height="11" rx="2" />
        <path d="M6.5 2.5v11M10 2.5v11" />
      </svg>
    ),
  },
] as const

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const themeMode = useSettingsStore((s) => s.themeMode)
  const setThemeMode = useSettingsStore((s) => s.setThemeMode)
  const resolvedTheme = useResolvedTheme()

  return (
    <nav className={styles.sidebar}>
      <button
        type="button"
        className={styles.quickAdd}
        onClick={() => useUIStore.getState().openQuickAdd()}
        aria-label="Quick add"
        title={`Quick add (${formatShortcut('Mod-Space')})`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </button>
      <span className={styles.separator} aria-hidden="true" />
      <div className={styles.viewIcons}>
        {views.map(({ path, label, icon }) => (
          <button
            key={path}
            className={`${styles.iconButton} ${location.pathname === path ? styles.active : ''}`}
            onClick={() => navigate(path)}
            title={label}
            aria-label={label}
            aria-current={location.pathname === path ? 'page' : undefined}
          >
            {icon}
          </button>
        ))}
      </div>
      <div className={styles.bottomIcons}>
        <button
          className={styles.iconButton}
          onClick={() => setThemeMode(resolvedTheme === 'dark' ? 'light' : 'dark')}
          title={themeMode === 'system'
            ? `Theme: System (${resolvedTheme}) — switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'}`
            : `Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
          aria-label="Toggle theme"
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>{resolvedTheme === 'dark' ? '☀' : '☾'}</span>
        </button>
        <button
          className={styles.iconButton}
          onClick={() => useUIStore.getState().openSettings()}
          title="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>
    </nav>
  )
}
