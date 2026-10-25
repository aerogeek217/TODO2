import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router'
import { useFilterStore } from '../../stores/filter-store'
import { criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import type { TodoPredicate } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { FilterChipBar } from '../shared/filters/FilterChipBar'
import { useScreenTaskCount } from '../../hooks/use-screen-task-count'
import { screenTaskDialog, showTasksLabel } from '../../services/task-dialog'
import { usePickedLens } from '../../stores/screen-filter'
import { FilterSheetLens } from './FilterSheetLens'
import { unmatchedNote, useSearchBox } from '../../hooks/use-search-box'
import { NlpPopup } from '../shared/NlpPopup'
import { TintedText } from '../shared/TintedText'
import styles from './FilterSheet.module.css'

export function FilterSheet() {
  const isOpen = useUIStore((s) => s.isFilterSheetOpen)
  const focusSearch = useUIStore((s) => s.filterSheetFocusSearch)
  const closeSheet = useCallback(() => useUIStore.getState().setFilterSheetOpen(false), [])
  const filters = useFilterStore((s) => s.filters)
  const isActive = useFilterStore((s) => s.isActive)
  const lensPicked = usePickedLens() != null
  // The search: its tokens become the sections' values (the screen filter's chips), its words the text search.
  const searchRef = useRef<HTMLInputElement>(null)
  const box = useSearchBox({ inputRef: searchRef, debounce: false })
  const mirrorRef = useRef<HTMLDivElement>(null)
  const syncMirror = useCallback(() => {
    if (mirrorRef.current && searchRef.current) mirrorRef.current.scrollLeft = searchRef.current.scrollLeft
  }, [])
  useLayoutEffect(() => { syncMirror() }, [box.text, syncMirror])
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
              ref={searchRef}
              className={styles.searchInput}
              type="text"
              placeholder="Search tasks..."
              aria-label="Search tasks"
              autoFocus={focusSearch}
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
                }
              }}
              spellCheck={false}
            />
            {/* The box's text with its token tints, over the input's transparent text. */}
            <div ref={mirrorRef} className={styles.searchMirror} aria-hidden="true" data-testid="search-mirror">
              <TintedText text={box.text} spans={box.tints} />
            </div>
            {box.text && (
              <button className={styles.searchClear} onClick={box.clear}>
                ×
              </button>
            )}
          </div>
          {/* The `@ # /` popup inside the sheet, under the box. */}
          {box.ac.state.visible && box.ac.state.view && (
            <NlpPopup
              view={box.ac.state.view}
              selectedIndex={box.ac.state.selectedIndex}
              onPick={(row) => box.ac.select(row, searchRef.current)}
              onHighlight={box.ac.highlight}
              className={styles.popup}
            />
          )}
          {box.unmatched.length > 0 && !box.ac.state.visible && (
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

          <FilterSheetLens />
          <FilterChipBar
            predicate={predicate}
            onChange={handleChange}
            density="mobile"
            onClearExtra={closeSheet}
            onClearAll={() => useFilterStore.getState().clearAll()}
          />
          {(isActive || lensPicked) && <ShowTasksButton onShow={closeSheet} />}
        </div>
      </div>
    </>
  )
}

/**
 * The sheet's foot while a filter is on or the layout has a lens, as the top
 * bar's tray end: how many tasks the filter and the lens keep; a tap closes the sheet and opens them in the
 * task dialog (whose filter bar edits this filter).
 */
function ShowTasksButton({ onShow }: { onShow: () => void }) {
  const count = useScreenTaskCount()
  return (
    <button
      type="button"
      className={styles.showTasks}
      onClick={() => {
        onShow()
        useUIStore.getState().showTaskDialog(screenTaskDialog())
      }}
      data-show-filtered-tasks=""
    >
      {showTasksLabel(count)}
    </button>
  )
}
