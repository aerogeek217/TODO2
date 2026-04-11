import { useLocation, useNavigate } from 'react-router'
import { useFilterStore } from '../../stores/filter-store'
import { useUIStore } from '../../stores/ui-store'
import styles from './BottomTabBar.module.css'

export function BottomTabBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const isActive = useFilterStore((s) => s.isActive)
  const isFilterSheetOpen = useUIStore((s) => s.isFilterSheetOpen)
  const toggleFilterSheet = useUIStore((s) => s.toggleFilterSheet)

  const isListActive = location.pathname === '/list' || location.pathname === '/'
  const isSettingsActive = location.pathname === '/settings'

  return (
    <nav className={styles.tabBar} aria-label="Main navigation">
      <button
        className={`${styles.tab} ${isListActive && !isFilterSheetOpen ? styles.tabActive : ''}`}
        role="tab"
        aria-selected={isListActive && !isFilterSheetOpen}
        onClick={() => {
          if (isFilterSheetOpen) toggleFilterSheet()
          if (location.pathname !== '/list') navigate('/list')
        }}
      >
        <span className={styles.tabIcon}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="14" y2="18" />
          </svg>
        </span>
        <span className={styles.tabLabel}>List</span>
      </button>

      <button
        className={`${styles.tab} ${isFilterSheetOpen ? styles.tabActive : ''}`}
        role="tab"
        aria-selected={isFilterSheetOpen}
        onClick={toggleFilterSheet}
      >
        <span className={styles.tabIcon}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          {isActive && <span className={styles.filterDot} />}
        </span>
        <span className={styles.tabLabel}>Filters</span>
      </button>

      <button
        className={`${styles.tab} ${isSettingsActive && !isFilterSheetOpen ? styles.tabActive : ''}`}
        role="tab"
        aria-selected={isSettingsActive && !isFilterSheetOpen}
        onClick={() => {
          if (isFilterSheetOpen) toggleFilterSheet()
          navigate('/settings')
        }}
      >
        <span className={styles.tabIcon}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </span>
        <span className={styles.tabLabel}>Settings</span>
      </button>
    </nav>
  )
}
