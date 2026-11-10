import { useState, useRef, useCallback, useMemo, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router'
import { ROUTE_WORKSPACE } from '../../routes'
import { useFilterStore } from '../../stores/filter-store'
import { criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import type { PersistedTodoItem, TodoPredicate } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { startOfToday } from '../../utils/date'
import { groupTodosByTextMatch, textMatchContextFor } from '../../utils/filter'
import { FilterChipBar } from '../shared/filters/FilterChipBar'
import { useTodoNameLookups } from '../../hooks/use-todo-name-lookups'
import { SearchResultContextMenu, SearchResultsGroups, type SearchResultPillContext } from './TopBarSearchResults'
import { LayoutControls } from '../workspace/LayoutControls'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { StoragePill } from './StoragePill'
import { CloseIcon, GearIcon, PlusIcon, SearchIcon } from '../shared/icons'
import { useShortcutLabel } from '../../hooks/use-shortcut-label'
import { useFilterPlaceholder } from '../../hooks/use-filter-placeholder'
import styles from './TopBar.module.css'
import { filtersFolded, FOLD_PART, FOLD_SEARCH_ATTR, SEARCH_WIDTH, tabsFolded, useTopBarFold } from './use-top-bar-fold'
import { ShowFilteredTasksButton } from './ShowFilteredTasksButton'
import { LensControl } from '../shared/filters/LensControl'
import { usePickedLens, useScreenFilter } from '../../stores/screen-filter'
import { matchesFilterWithLookups } from '../../utils/filter-match'
import { unmatchedNote, useSearchBox } from '../../hooks/use-search-box'
import { useNlpPopupAnchor } from '../../hooks/use-nlp-popup-anchor'
import { NlpPopup } from '../shared/NlpPopup'
import { TintedText } from '../shared/TintedText'
import { useFilterSettings } from '../../hooks/use-filter-settings'
import { FILTER_ROW_ATTR, SEARCH_INPUT_ATTR } from '../../utils/dom-contract'
import { FilteredTasksPanel } from '../overlays/FilteredTasksPanel'
import { tabAcross } from '../../utils/focusables'
import { PopoverRoot } from '../shared/PopoverRoot'
import { AmbienceSky } from '../ambience/AmbienceSky'

/** Keys that move the search box's caret (the `@ # ! /` popup follows it). */
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

/**
 * The most layouts shown as tabs: more than a bar can hold anyway, so past
 * it the picker shows from the start and no tab per layout is mounted.
 */
export const MAX_LAYOUT_TABS = 30

/**
 * What the layout tabs show, for their width (not their order): the names,
 * the open one, and the `Couldn't save · Retry` control while it shows. Past
 * `MAX_LAYOUT_TABS` the names don't matter (the picker shows).
 */
function layoutTabsKey(s: ReturnType<typeof useWorkspaceStore.getState>): string {
  const open = String(s.activeLayoutId)
  if (s.layouts.length > MAX_LAYOUT_TABS) return `many|${open}`
  const names = [...s.layouts.map((l) => l.name)].sort().join('/')
  return `${s.layouts.length}|${names}|${open}|${s.writeFailed ? 'failed' : ''}`
}

const NO_TODOS: PersistedTodoItem[] = []

export function TopBar() {
  const quickAddKeys = useShortcutLabel('quick-add')
  const settingsKeys = useShortcutLabel('open-settings')
  const filters = useFilterStore((s) => s.filters)
  const isActive = useFilterStore((s) => s.isActive)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // The box: its tokens become the tray's chips, its words the text search.
  const box = useSearchBox({ inputRef: searchInputRef })
  const searchWords = box.words
  const [searchFocused, setSearchFocused] = useState(false)
  const searchPlaceholder = useFilterPlaceholder(searchFocused && box.text === '')
  const miniListRef = useRef<HTMLDivElement>(null)
  // Right-click menu state is kept on TopBar (not SearchResultRow) so the
  // menu outlives the search dropdown closing when the menu opens — the row
  // would otherwise unmount along with its portals.
  const [searchContextMenu, setSearchContextMenu] = useState<
    { todoId: number; x: number; y: number } | null
  >(null)
  // The filtered-tasks panel: while it is open its rows are the field's
  // results (no dropdown), and the tray — the field, the Filter menu, the
  // chips — is its filter editor.
  const panelOpen = useUIStore((s) => s.filterPanelOpen)
  const trayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // The tasks and their people / tags only while the search dropdown (or a
  // result's menu) can show: otherwise a task write doesn't render the bar.
  const searching = !panelOpen && ((searchWords.length > 0 && searchFocused) || searchContextMenu !== null)
  const todos = useTodoStore((s) => (searching ? s.todos : NO_TODOS))
  const lookups = useTodoNameLookups({ active: searching })
  const { assignedPeopleMap, statusesById, statusUpdatesByTodo, subtasksByTodo } = lookups
  const openEditPopup = useUIStore((s) => s.openEditPopup)


  const filterPredicate = useMemo<TodoPredicate>(() => criteriaToPredicate(filters), [filters])
  const handleFilterChange = useCallback((next: TodoPredicate) => {
    useFilterStore.getState().setAllFilters(predicateToCriteria(next))
  }, [])

  const searchPillCtx = useMemo<SearchResultPillContext>(() => ({
    peopleByTodoId: assignedPeopleMap,
    statusesById,
    statusUpdatesByTodo,
    subtasksByTodo,
  }), [assignedPeopleMap, statusesById, statusUpdatesByTodo, subtasksByTodo])

  // The dropdown lists the words' matches among the tasks the chips and the
  // lens keep (completed ones too, last, as before the chips).
  const screenFilter = useScreenFilter()
  const filterSettings = useFilterSettings()
  const miniListGroups = useMemo(() => {
    if (!searchWords || !searchFocused) return null
    const narrowing = { ...screenFilter.filters, searchText: '', showCompleted: true }
    const today = startOfToday()
    const kept = screenFilter.active
      ? todos.filter((t) => matchesFilterWithLookups(narrowing, t, lookups, today, filterSettings))
      : todos
    return groupTodosByTextMatch(kept, searchWords, (t) => textMatchContextFor(t, lookups))
  }, [searchWords, searchFocused, todos, lookups, screenFilter.filters, screenFilter.active, filterSettings])

  const totalMatchCount = miniListGroups
    ? (Object.values(miniListGroups) as PersistedTodoItem[][]).reduce((n, arr) => n + arr.length, 0)
    : 0
  // The `@ # ! /` popup under the box (Quick Add's): the results wait while it shows.
  const popupOpen = box.ac.state.visible && box.ac.state.view !== null
  const dismissPopup = box.ac.dismiss
  const popup = useNlpPopupAnchor(searchInputRef, box.ac.state)
  const showMiniList = !panelOpen && !popupOpen && searchFocused && searchWords.length > 0 && !!miniListGroups && totalMatchCount > 0
  // A name the search matched nobody to: a line under the box, while it has the focus.
  const unmatchedNotes = searchFocused && !popupOpen && box.unmatched.length > 0
    ? (
      <div className={styles.searchNote} role="status">
        {box.unmatched.map((n) => {
          const note = unmatchedNote(n)
          return (
            <div key={`${n.kind}-${n.start}`}>
              {note.lead}<b>{note.name}</b>{note.rest} · <span className={styles.searchNoteHint}>{note.hint}</span>
            </div>
          )
        })}
      </div>
    )
    : null

  // Keep the tint mirror scrolled with the input's text.
  const mirrorRef = useRef<HTMLDivElement>(null)
  const syncMirror = useCallback(() => {
    if (mirrorRef.current && searchInputRef.current) mirrorRef.current.scrollLeft = searchInputRef.current.scrollLeft
  }, [])
  useLayoutEffect(() => { syncMirror() }, [box.text, syncMirror])

  const location = useLocation()
  const isWorkspace = location.pathname === ROUTE_WORKSPACE
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  // The bar never wraps or overflows: measured, the tray shrinks first (the
  // field narrows, then long filter values are cut), then the set filters'
  // chips fold into the Filter button, then the layout tabs into the layout
  // picker. The filtered-tasks panel changes none of it.
  const barRef = useRef<HTMLElement | null>(null)
  const tabsKey = useWorkspaceStore(layoutTabsKey)
  const manyLayouts = useWorkspaceStore((s) => s.layouts.length > MAX_LAYOUT_TABS)
  // The counter shows while a chip is on or a lens is picked (lifted
  // too: 109 of 109), or the panel is open (it stays the panel's toggle when
  // Clear all empties the filter).
  const lensPicked = usePickedLens() != null
  const showTasksButton = isActive || lensPicked || panelOpen
  // The tray gains or loses Show N tasks: measured again then.
  const { fold, squeeze, lensName } = useTopBarFold(barRef, tabsKey, `${isWorkspace}|${showTasksButton}`)

  const clearSearch = box.clear
  const handleOpenTodo = useCallback((todoId: number) => {
    openEditPopup(todoId)
    clearSearch()
    setSearchFocused(false)
    searchInputRef.current?.blur()
  }, [openEditPopup, clearSearch])

  const handleOpenSearchContextMenu = useCallback((todo: PersistedTodoItem, x: number, y: number) => {
    setSearchContextMenu({ todoId: todo.id, x, y })
    // Keep the dropdown open so the user can pick another row after closing
    // the menu. The row's `onMouseDown preventDefault` already blocks the
    // right-click from transferring focus off the input; picking a menu item
    // focuses the menu button and that natural blur collapses the dropdown —
    // so actions still clean up both surfaces.
  }, [])

  const menuTodo = useMemo(() => {
    if (!searchContextMenu) return null
    return todos.find((t) => t.id === searchContextMenu.todoId) ?? null
  }, [searchContextMenu, todos])

  return (
    <>
      <header
        ref={barRef}
        className={styles.topBar}
        data-fold={fold}
        // A press on the bar outside the tray closes the panel first; the
        // press then does its own thing. (In the page, not in a layer the
        // bar's controls portaled out: a picker, a menu.)
        onMouseDownCapture={(e) => {
          const target = e.target as Node
          if (panelOpen && e.currentTarget.contains(target) && !trayRef.current?.contains(target)) {
            useUIStore.getState().closeFilterPanel()
          }
        }}
      >
        {/* Ambience: the sky over the glass, under the controls (absolute: the fold skips it). */}
        <AmbienceSky />
        {isWorkspace && (
          <div className={styles.layoutSlot} data-fold-part={FOLD_PART.layout}>
            <LayoutControls mode={tabsFolded(fold) || manyLayouts ? 'menu' : 'tabs'} />
          </div>
        )}
        {/* The top bar's lens: its own part, outside the tray (never lifted
            with it), a fixed width the fold counts in its base. */}
        {isWorkspace && (
          <div className={styles.lensSlot} data-fold-part={FOLD_PART.lens}>
            <LensControl nameWidth={lensName} />
          </div>
        )}

        <div
          ref={trayRef}
          className={`${styles.tray} ${isActive ? styles.trayActive : ''} ${panelOpen ? styles.trayPanelOpen : ''}`}
          data-fold-part={FOLD_PART.tray}
          role="group"
          aria-label="Screen filters — apply to every widget"
          {...{ [FILTER_ROW_ATTR]: '' }}
          data-filtered={isActive || undefined}
          onKeyDown={panelOpen ? (e) => tabAcross(e, trayRef.current, panelRef.current) : undefined}
        >
          <div className={styles.searchWrapper} style={{ width: squeeze?.search ?? SEARCH_WIDTH }} {...{ [FOLD_SEARCH_ATTR]: '' }}>
            <span className={styles.searchIcon}><SearchIcon size={14} /></span>
            <input
              ref={searchInputRef}
              className={styles.searchInput}
              type="text"
              placeholder={searchPlaceholder}
              aria-label="Filter tasks"
              value={box.text}
              onChange={(e) => box.onChange(e.target.value, e.target.selectionStart ?? e.target.value.length, e.target)}
              onSelect={syncMirror}
              onMouseUp={(e) => box.onCaretMove(e.currentTarget)}
              onKeyUp={(e) => {
                if (CARET_KEYS.has(e.key)) box.onCaretMove(e.currentTarget)
              }}
              onScroll={syncMirror}
              // A text box: no aria-expanded (not one of its states); the results it controls while shown.
              aria-controls={showMiniList ? 'search-results' : undefined}
              onFocus={() => setSearchFocused(true)}
              onBlur={(e) => {
                dismissPopup()
                if (miniListRef.current?.contains(e.relatedTarget as Node)) return
                // Right-click on a search row opens a context menu that autoFocuses
                // its first item; preserve the listbox so the menu's actions can
                // still target the row.
                if (searchContextMenu) return
                setSearchFocused(false)
              }}
              onKeyDown={(e) => {
                // The `@ # ! /` popup's keys; ⏎ makes every token a chip;
                // Backspace in the empty box takes the last one back.
                if (box.onKeyDown(e)) {
                  e.preventDefault()
                  e.stopPropagation()
                  return
                }
                if (e.key === 'Escape' && panelOpen) {
                  // Over the panel: the text first (stays here), then the panel.
                  if (box.text !== '') {
                    e.preventDefault()
                    box.clear()
                  }
                } else if (e.key === 'Escape') {
                  // The box only: the chips stay.
                  box.clear()
                  setSearchFocused(false)
                  searchInputRef.current?.blur()
                } else if (e.key === 'ArrowDown' && showMiniList) {
                  e.preventDefault()
                  const first = miniListRef.current?.querySelector<HTMLButtonElement>('[role="option"]')
                  first?.focus()
                }
              }}
              spellCheck={false}
              {...{ [SEARCH_INPUT_ATTR]: '' }}
            />
            {/* The box's text with its token tints, over the input's transparent text. */}
            <div ref={mirrorRef} className={styles.searchMirror} aria-hidden="true" data-testid="search-mirror">
              <TintedText text={box.text} spans={box.tints} />
            </div>
            {box.text && (
              // Like `ClearableField`'s ×, a mouse target only (it acts on
              // mousedown); from the keyboard, Esc in the field clears it.
              <button
                type="button"
                className={styles.searchClear}
                aria-label="Clear filter text"
                tabIndex={-1}
                onMouseDown={(e) => { e.preventDefault(); box.clear(); searchInputRef.current?.focus() }}
              >
                <CloseIcon size={8} />
              </button>
            )}
            {showMiniList && miniListGroups ? (
              <SearchResultsGroups
                ref={miniListRef}
                groups={miniListGroups}
                query={searchWords}
                note={unmatchedNotes}
                pillCtx={searchPillCtx}
                searchInputRef={searchInputRef}
                onOpen={handleOpenTodo}
                onOpenContextMenu={handleOpenSearchContextMenu}
                onBlur={(e) => {
                  if (!miniListRef.current?.contains(e.relatedTarget as Node) && e.relatedTarget !== searchInputRef.current) {
                    if (searchContextMenu) return
                    setSearchFocused(false)
                  }
                }}
              />
            ) : unmatchedNotes && (
              <PopoverRoot className={styles.searchNotePopover}>{unmatchedNotes}</PopoverRoot>
            )}
          </div>

          <FilterChipBar
            predicate={filterPredicate}
            onChange={handleFilterChange}
            onClearAll={() => useFilterStore.getState().clearAll()}
            fold={filtersFolded(fold)}
            measureFold
            valueWidths={squeeze?.values}
            consumeEscape={panelOpen}
          />
          {showTasksButton && <ShowFilteredTasksButton open={panelOpen} />}
        </div>

        <div className={styles.right} data-fold-part={FOLD_PART.spring}>
          <StoragePill />
          <button
            type="button"
            className={`${styles.gear} ${settingsOpen ? styles.gearOpen : ''}`}
            onClick={() => useUIStore.getState().openSettings()}
            aria-label="Settings"
            title={`Settings (${settingsKeys})`}
          >
            <GearIcon />
          </button>
          <button
            type="button"
            className={styles.newTask}
            onClick={() => useUIStore.getState().openQuickAdd()}
            aria-label="New task"
            title={`New task (${quickAddKeys})`}
          >
            <PlusIcon size={14} strokeWidth={2} />
          </button>
        </div>

        {searchContextMenu && menuTodo && (
          <SearchResultContextMenu
            x={searchContextMenu.x}
            y={searchContextMenu.y}
            todo={menuTodo}
            onOpen={handleOpenTodo}
            onClose={() => {
              setSearchContextMenu(null)
              // Match the prior onAction-closes-listbox UX: any path that closes
              // the context menu (action click, outside click, Esc) also drops
              // the search dropdown so the user is back to the unfocused state.
              setSearchFocused(false)
            }}
          />
        )}
      </header>
      {panelOpen && <FilteredTasksPanel trayRef={trayRef} topBarRef={barRef} panelRef={panelRef} />}
      {popupOpen && box.ac.state.view && createPortal(
        <NlpPopup
          view={box.ac.state.view}
          selectedIndex={box.ac.state.selectedIndex}
          onPick={(row) => box.ac.select(row, searchInputRef.current)}
          onHighlight={box.ac.highlight}
          popupRef={popup.setPopupEl}
          className={styles.nlpPopup}
          style={popup.style}
          entityMenu={{ keyTarget: () => searchInputRef.current }}
        />,
        document.body,
      )}
    </>
  )
}
