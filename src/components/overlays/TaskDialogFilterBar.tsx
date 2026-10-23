import { useCallback, useMemo, useRef, useState } from 'react'
import type { TodoPredicate } from '../../models'
import { useScreenSearch } from '../../hooks/use-screen-search'
import { useFilterStore } from '../../stores/filter-store'
import { countActiveFilters, criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import { FilterChipBar } from '../shared/filters/FilterChipBar'
import { CloseIcon, FunnelIcon, SearchIcon } from '../shared/icons'
import styles from './TaskDialogFilterBar.module.css'

/**
 * The screen filter's task dialog's filter bar (a phone: desktop edits the
 * filter in the top bar's tray over its filtered-tasks panel): the screen
 * filter itself, not a copy — every change here applies to every widget
 * behind at once (the dialog's rows follow it). The search, then the
 * filter sheet's sections under a Filters disclosure (closed at first).
 */
export function TaskDialogFilterBar() {
  const filters = useFilterStore((s) => s.filters)
  const predicate = useMemo<TodoPredicate>(() => criteriaToPredicate(filters), [filters])
  const onChange = useCallback((next: TodoPredicate) => {
    useFilterStore.getState().setAllFilters(predicateToCriteria(next))
  }, [])
  const clearAll = useCallback(() => useFilterStore.getState().clearAll(), [])
  const [open, setOpen] = useState(false)
  // The search is its own field here, so it isn't counted.
  const count = countActiveFilters({ ...filters, searchText: '' })
  return (
    <div className={styles.bar} data-task-dialog-filters="">
      <SearchField />
      <button
        type="button"
        className={`${styles.toggle} ${count > 0 ? styles.toggleActive : ''}`}
        aria-expanded={open}
        aria-label={count > 0 ? `Filters, ${count} active` : 'Filters'}
        onClick={() => setOpen((o) => !o)}
      >
        <FunnelIcon size={14} />
        Filters
        {count > 0 && <span className={styles.count}>{count}</span>}
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true">▸</span>
      </button>
      {open && (
        <div className={styles.sections}>
          <FilterChipBar predicate={predicate} onChange={onChange} density="mobile" onClearAll={clearAll} />
        </div>
      )}
    </div>
  )
}

/** The screen filter's search text (debounced into the store, as the top bar's). Esc with text clears it; without, closes the dialog. */
function SearchField() {
  const [text, setText] = useScreenSearch()
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className={styles.searchWrapper}>
      <span className={styles.searchIcon}><SearchIcon size={14} /></span>
      <input
        ref={inputRef}
        className={styles.searchInput}
        type="text"
        placeholder="Search…"
        aria-label="Search tasks"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && text !== '') {
            e.preventDefault()
            setText('')
          }
        }}
      />
      {text && (
        // A mouse target only, as the top bar's (from the keyboard, Esc clears).
        <button
          type="button"
          className={styles.searchClear}
          aria-label="Clear search"
          tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); setText(''); inputRef.current?.focus() }}
        >
          <CloseIcon size={8} />
        </button>
      )}
    </div>
  )
}
