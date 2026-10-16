import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router'
import { useFilterStore } from '../../stores/filter-store'
import { criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import type { TodoPredicate } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { FilterChipBar } from '../shared/filters/FilterChipBar'
import styles from './FilterSheet.module.css'

export function FilterSheet() {
  const isOpen = useUIStore((s) => s.isFilterSheetOpen)
  const focusSearch = useUIStore((s) => s.filterSheetFocusSearch)
  const closeSheet = useCallback(() => useUIStore.getState().setFilterSheetOpen(false), [])
  const filters = useFilterStore((s) => s.filters)
  const setSearchText = useFilterStore((s) => s.setSearchText)
  const location = useLocation()

  const predicate = useMemo<TodoPredicate>(() => criteriaToPredicate(filters), [filters])
  const handleChange = useCallback((next: TodoPredicate) => {
    useFilterStore.getState().setAllFilters(predicateToCriteria(next))
  }, [])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  // Close sheet on route change
  const shownPath = useRef(location.pathname)
  useEffect(() => {
    if (shownPath.current === location.pathname) return
    shownPath.current = location.pathname
    if (isOpen) closeSheet()
  }, [location.pathname, isOpen, closeSheet])

  if (!isOpen) return null

  return (
    <>
      <div
        className={styles.backdrop}
        onClick={closeSheet}
        onTouchMove={(e) => e.preventDefault()}
      />
      <div className={styles.sheet}>
        <div className={styles.scrollBody}>
          <div className={styles.searchWrapper}>
            <span className={styles.searchIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search tasks..."
              aria-label="Search tasks"
              autoFocus={focusSearch}
              value={filters.searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            {filters.searchText && (
              <button className={styles.searchClear} onClick={() => setSearchText('')}>
                ×
              </button>
            )}
          </div>

          <FilterChipBar
            predicate={predicate}
            onChange={handleChange}
            density="mobile"
            onClearExtra={closeSheet}
            onClearAll={() => useFilterStore.getState().clearAll()}
          />
        </div>
      </div>
    </>
  )
}
