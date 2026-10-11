import { useLocation, useNavigate } from 'react-router'
import { countActiveFilters, useFilterStore } from '../../stores/filter-store'
import { useUIStore } from '../../stores/ui-store'
import { ROUTE_SETTINGS, ROUTE_WORKSPACE } from '../../routes'
import styles from './BottomTabBar.module.css'

/** Mobile app navigation: Workspace, Filters (the filter sheet, with a count of active screen filters), Settings. */
export function BottomTabBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const filterCount = useFilterStore((s) => countActiveFilters(s.filters))
  const isFilterSheetOpen = useUIStore((s) => s.isFilterSheetOpen)
  const toggleFilterSheet = useUIStore((s) => s.toggleFilterSheet)

  const isSettingsActive = location.pathname === ROUTE_SETTINGS
  const isWorkspaceActive = !isSettingsActive

  return (
    <nav className={styles.tabBar} aria-label="Main navigation">
      <button
        className={`${styles.tab} ${isWorkspaceActive && !isFilterSheetOpen ? styles.tabActive : ''}`}
        role="tab"
        aria-selected={isWorkspaceActive && !isFilterSheetOpen}
        onClick={() => {
          if (isFilterSheetOpen) toggleFilterSheet()
          if (location.pathname !== ROUTE_WORKSPACE) navigate(ROUTE_WORKSPACE)
        }}
      >
        <span className={styles.tabIcon}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="2.5" width="12" height="11" rx="2" />
            <path d="M6.5 2.5v11M10 2.5v11" />
          </svg>
        </span>
        <span className={styles.tabLabel}>Workspace</span>
      </button>

      <button
        className={`${styles.tab} ${isFilterSheetOpen ? styles.tabActive : ''}`}
        role="tab"
        aria-selected={isFilterSheetOpen}
        aria-label={filterCount > 0 ? `Filters (${filterCount} active)` : 'Filters'}
        onClick={toggleFilterSheet}
      >
        <span className={styles.tabIcon}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
        </span>
        {filterCount > 0 && <span className={styles.filterBadge} data-testid="filter-count">{filterCount}</span>}
        <span className={styles.tabLabel}>Filters</span>
      </button>

      <button
        className={`${styles.tab} ${isSettingsActive && !isFilterSheetOpen ? styles.tabActive : ''}`}
        role="tab"
        aria-selected={isSettingsActive && !isFilterSheetOpen}
        onClick={() => {
          if (isFilterSheetOpen) toggleFilterSheet()
          navigate(ROUTE_SETTINGS)
        }}
      >
        <span className={styles.tabIcon}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </span>
        <span className={styles.tabLabel}>Settings</span>
      </button>
    </nav>
  )
}
