import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TodoPredicate } from '../../models'
import { unmatchedNote, useSearchBox } from '../../hooks/use-search-box'
import { useFilterStore } from '../../stores/filter-store'
import { countActiveFilters, criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import { FilterChipBar } from '../shared/filters/FilterChipBar'
import { CloseIcon, FunnelIcon, SearchIcon } from '../shared/icons'
import { NlpPopup } from '../shared/NlpPopup'
import { TintedText } from '../shared/TintedText'
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

/**
 * The screen filter's search (D16, as the phone filter sheet's): typed tokens
 * become the Filters sections' values, the words left the text search
 * (debounced into the store, as the top bar's — the rows behind follow it).
 * The `@ # /` popup and the unmatched-name note sit under the bar's first
 * line. Esc on the popup closes it; with text, clears the box; without,
 * closes the dialog.
 */
function SearchField() {
  const inputRef = useRef<HTMLInputElement>(null)
  const box = useSearchBox({ inputRef })
  const mirrorRef = useRef<HTMLDivElement>(null)
  const syncMirror = useCallback(() => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollLeft = inputRef.current.scrollLeft
  }, [])
  useLayoutEffect(() => { syncMirror() }, [box.text, syncMirror])
  const popupOpen = box.ac.state.visible && box.ac.state.view !== null
  return (
    <>
      <div className={styles.searchWrapper}>
        <span className={styles.searchIcon}><SearchIcon size={14} /></span>
        <input
          ref={inputRef}
          className={styles.searchInput}
          type="text"
          placeholder="Search…"
          aria-label="Search tasks"
          value={box.text}
          onChange={(e) => box.onChange(e.target.value, e.target.selectionStart ?? e.target.value.length, e.target)}
          onSelect={syncMirror}
          onScroll={syncMirror}
          onMouseUp={(e) => box.onCaretMove(e.currentTarget)}
          onKeyDown={(e) => {
            // The `@ # /` popup's keys; ⏎ makes every token a section's value;
            // Backspace in the empty box takes the last one back.
            if (box.onKeyDown(e)) {
              e.preventDefault()
              e.stopPropagation()
              return
            }
            if (e.key === 'Escape' && box.text !== '') {
              e.preventDefault()
              box.clear()
            }
          }}
          spellCheck={false}
        />
        {/* The box's text with its token tints, over the input's transparent text. */}
        <div ref={mirrorRef} className={styles.searchMirror} aria-hidden="true" data-testid="search-mirror">
          <TintedText text={box.text} spans={box.tints} />
        </div>
        {box.text && (
          // A mouse target only, as the top bar's (from the keyboard, Esc clears).
          <button
            type="button"
            className={styles.searchClear}
            aria-label="Clear search"
            tabIndex={-1}
            onMouseDown={(e) => { e.preventDefault(); box.clear(); inputRef.current?.focus() }}
          >
            <CloseIcon size={8} />
          </button>
        )}
      </div>
      {/* Under the bar's first line, full width: the popup, else a note per unmatched name. */}
      {popupOpen && box.ac.state.view && (
        <NlpPopup
          view={box.ac.state.view}
          selectedIndex={box.ac.state.selectedIndex}
          onPick={(row) => box.ac.select(row, inputRef.current)}
          onHighlight={box.ac.highlight}
          className={styles.popup}
        />
      )}
      {!popupOpen && box.unmatched.length > 0 && (
        <div className={styles.searchNote} role="status">
          {box.unmatched.map((n) => {
            const note = unmatchedNote(n)
            return (
              <div key={`${n.kind}-${n.start}`}>
                {note.lead}<b>{note.name}</b>{note.rest}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
