import { useCallback } from 'react'
import type { TodoPredicate } from '../../models'
import { FilterChipBar } from '../shared/filters/FilterChipBar'
import styles from './ListFilterEditor.module.css'

interface Props {
  predicate: TodoPredicate
  onChange: (next: TodoPredicate) => void
}

/**
 * Controlled filter editor — renders the same chip-row vocabulary as TopBar
 * but bound to an arbitrary `TodoPredicate` instead of the global filter-store.
 * Used inline in `DashboardListsEditor` (draft predicate) and in `ListView`
 * (bound to filter-store via criteria ↔ predicate round-trip). The chip + panel
 * chrome lives in `<FilterChipBar>`; this wrapper owns only the search input
 * and the surrounding bar layout.
 */
export function ListFilterEditor({ predicate, onChange }: Props) {
  const updateSearch = useCallback(
    (searchText: string) => onChange({ ...predicate, searchText }),
    [predicate, onChange],
  )

  return (
    <div className={styles.bar} role="toolbar" aria-label="Filter editor">
      <div className={styles.searchWrapper}>
        <svg
          className={styles.searchIcon}
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search..."
          value={predicate.searchText}
          onChange={(e) => updateSearch(e.target.value)}
        />
        {predicate.searchText && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => updateSearch('')}
          >
            &times;
          </button>
        )}
      </div>
      <FilterChipBar predicate={predicate} onChange={onChange} />
    </div>
  )
}
