import { useCallback, useMemo, useRef, useState } from 'react'
import type { TodoPredicate } from '../../models'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { useScreenSearch } from '../../hooks/use-screen-search'
import { useFilterStore } from '../../stores/filter-store'
import { countActiveFilters, criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import { FilterChipBar } from '../shared/filters/FilterChipBar'
import { CloseIcon, FunnelIcon, SearchIcon } from '../shared/icons'
import { useTooltip } from '../shared/use-tooltip'
import styles from './TaskDialogFilterBar.module.css'

/**
 * The screen filter's task dialog's filter bar: the screen filter itself,
 * not a copy — every change here applies to every widget behind at once
 * (the dialog's rows follow it). The top bar's tray without its search
 * dropdown (the rows are the results): the funnel (Clear all filters), the
 * search text and the filter buttons with Completed; on a phone, the
 * search and the filter sheet's sections under a Filters disclosure.
 */
export function TaskDialogFilterBar() {
  const filters = useFilterStore((s) => s.filters)
  const isActive = useFilterStore((s) => s.isActive)
  const isMobile = useIsMobile()
  const predicate = useMemo<TodoPredicate>(() => criteriaToPredicate(filters), [filters])
  const onChange = useCallback((next: TodoPredicate) => {
    useFilterStore.getState().setAllFilters(predicateToCriteria(next))
  }, [])
  const clearAll = useCallback(() => useFilterStore.getState().clearAll(), [])

  if (isMobile) return <MobileBar predicate={predicate} onChange={onChange} onClearAll={clearAll} />
  return (
    <div
      className={`${styles.bar} ${isActive ? styles.barActive : ''}`}
      role="group"
      aria-label="Screen filters — apply to every widget"
      data-task-dialog-filters=""
    >
      <ClearAllButton active={isActive} onClear={clearAll} />
      <SearchField />
      <FilterChipBar predicate={predicate} onChange={onChange} onClearAll={clearAll} />
    </div>
  )
}

/** The funnel: red while a filter is on; a click clears them all (the dialog stays, now every open task). */
function ClearAllButton({ active, onClear }: { active: boolean; onClear: () => void }) {
  const { triggerProps, tooltip } = useTooltip(active ? 'Clear all filters\nFilters apply to every widget on screen' : null)
  return (
    <button
      type="button"
      className={styles.funnel}
      aria-label="Clear all filters"
      disabled={!active}
      onClick={onClear}
      {...triggerProps}
    >
      <FunnelIcon size={14} />
      {tooltip}
    </button>
  )
}

/** The screen filter's search text (debounced into the store, as the top bar's). Esc with text clears it; without, closes the dialog. */
function SearchField({ className }: { className?: string }) {
  const [text, setText] = useScreenSearch()
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className={`${styles.searchWrapper} ${className ?? ''}`}>
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

/** The phone's bar: the search, then the filter sheet's sections under a Filters disclosure (closed at first). */
function MobileBar({ predicate, onChange, onClearAll }: {
  predicate: TodoPredicate
  onChange: (next: TodoPredicate) => void
  onClearAll: () => void
}) {
  const [open, setOpen] = useState(false)
  // The search is its own field here, so it isn't counted.
  const filters = useFilterStore((s) => s.filters)
  const count = countActiveFilters({ ...filters, searchText: '' })
  return (
    <div className={styles.mobile} data-task-dialog-filters="">
      <SearchField className={styles.mobileSearch} />
      <button
        type="button"
        className={`${styles.mobileToggle} ${count > 0 ? styles.mobileToggleActive : ''}`}
        aria-expanded={open}
        aria-label={count > 0 ? `Filters, ${count} active` : 'Filters'}
        onClick={() => setOpen((o) => !o)}
      >
        <FunnelIcon size={14} />
        Filters
        {count > 0 && <span className={styles.mobileCount}>{count}</span>}
        <span className={`${styles.mobileChevron} ${open ? styles.mobileChevronOpen : ''}`} aria-hidden="true">▸</span>
      </button>
      {open && (
        <div className={styles.mobileSections}>
          <FilterChipBar predicate={predicate} onChange={onChange} density="mobile" onClearAll={onClearAll} />
        </div>
      )}
    </div>
  )
}
