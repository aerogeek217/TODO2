import { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router'
import { ROUTE_WORKSPACE } from '../../routes'
import { useFilterStore } from '../../stores/filter-store'
import { criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import type { Person, PersistedTodoItem, Status, Tag, TodoPredicate } from '../../models'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { startOfToday } from '../../utils/date'
import { groupTodosByTextMatch, textMatchContextFor, type TextMatchField } from '../../utils/filter'
import { TaskPillBar } from '../shared/TaskPillBar'
import { FilterChipBar } from '../shared/filters/FilterChipBar'
import { useTaskRowActions } from '../../hooks/use-task-row-actions'
import { TaskMenu } from '../task/TaskMenu'
import { searchMenuHandlers } from './top-bar-search-menu'
import { LayoutControls } from '../workspace/LayoutControls'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { StoragePill } from './StoragePill'
import { CloseIcon, FunnelIcon, GearIcon, PlusIcon, SearchIcon } from '../shared/icons'
import { useTooltip } from '../shared/use-tooltip'
import { useShortcutLabel } from '../../hooks/use-shortcut-label'
import styles from './TopBar.module.css'
import { collapseWhitespace } from '../../utils/text'
import { filtersFolded, FOLD_PART, FOLD_SEARCH_ATTR, SEARCH_WIDTH, tabsFolded, traySqueeze, useTopBarFold } from './use-top-bar-fold'
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
import { trayExpansion, type TrayExpansion } from './tray-expansion'

const SEARCH_FIELD_ORDER: TextMatchField[] = ['title', 'notes', 'person', 'status', 'tag']
const SEARCH_FIELD_LABELS: Record<TextMatchField, string> = {
  title: 'Title',
  notes: 'Notes',
  person: 'Person',
  status: 'Status',
  tag: 'Tags',
}
const MAX_GROUP_PREVIEW = 5
/** Keys that move the search box's caret (the `@ # /` popup follows it). */
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

/**
 * The most layouts shown as tabs: more than a bar can hold anyway, so past
 * it the picker shows from the start and no tab per layout is mounted.
 */
export const MAX_LAYOUT_TABS = 30

/**
 * What the layout tabs show, for their width (not their order): the names,
 * the open one and its unsaved dot, a kept new layout. Past
 * `MAX_LAYOUT_TABS` the names don't matter (the picker shows).
 */
function layoutTabsKey(s: ReturnType<typeof useWorkspaceStore.getState>): string {
  const open = s.saved === null ? `new:${s.working?.name ?? ''}` : String(s.activeLayoutId)
  if (s.layouts.length > MAX_LAYOUT_TABS) return `many|${open}`
  const names = [...s.layouts.map((l) => l.name)].sort().join('/')
  return `${s.layouts.length}|${names}|${open}|${s.isDirty ? 'dirty' : ''}`
}

/**
 * The filter tray's funnel, left of search: red while any screen filter is
 * on; a click clears them all. Disabled while none is on.
 */
function ClearFiltersButton({ active }: { active: boolean }) {
  const { triggerProps, tooltip } = useTooltip(active ? 'Clear all filters\nFilters apply to every widget on screen' : null)
  return (
    <button
      type="button"
      className={styles.funnel}
      aria-label="Clear all filters"
      disabled={!active}
      onClick={() => useFilterStore.getState().clearAll()}
      data-clear-filters=""
      {...triggerProps}
    >
      <FunnelIcon size={14} />
      {tooltip}
    </button>
  )
}

/**
 * The search box's placeholder: `Search…`, and while the empty box has the
 * focus the token examples in turn (D16), so the grammar can be found.
 */
const SEARCH_PLACEHOLDERS = ['Search…', 'Search… @person', 'Search… #tag', 'Search… overdue', 'Search… due fri']
const PLACEHOLDER_MS = 2500

function useSearchPlaceholder(cycling: boolean): string {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!cycling) return
    const id = setInterval(() => setStep((n) => n + 1), PLACEHOLDER_MS)
    return () => clearInterval(id)
  }, [cycling])
  return cycling ? SEARCH_PLACEHOLDERS[step % SEARCH_PLACEHOLDERS.length] ?? 'Search…' : 'Search…'
}

function SearchFieldIcon({ field }: { field: TextMatchField }) {
  const common = { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (field) {
    case 'title':
      return <svg {...common}><path d="M3 3h10M3 6h10M3 9h7M3 12h10" /></svg>
    case 'notes':
      return <svg {...common}><path d="M4 2h6l2 2v10H4z" /><path d="M6 6h4M6 8h4M6 10h3" /></svg>
    case 'person':
      return <span className={styles.miniListGroupIcon} style={{ fontSize: 12 }}>@</span>
    case 'status':
      return <svg {...common}><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" /></svg>
    case 'tag':
      return <svg {...common}><path d="M3 6h10M3 10h10M6 3l-1 10M11 3l-1 10" /></svg>
  }
}

/**
 * Per-row pill context resolved once on TopBar and threaded down to every
 * `SearchResultRow`. Keeping it in one place avoids re-subscribing each row
 * to the assigned-people / status stores.
 */
interface SearchResultPillContext {
  peopleByTodoId: Map<number, Person[]>
  statusesById: Map<number, Status>
}

function SearchResultPills({ todo, ctx }: { todo: PersistedTodoItem; ctx: SearchResultPillContext }) {
  const today = startOfToday()
  const people = ctx.peopleByTodoId.get(todo.id) ?? []
  const status = todo.statusId != null ? ctx.statusesById.get(todo.statusId) : undefined

  if (people.length === 0 && !status && !todo.dueDate && !todo.nextFollowupAt) {
    return null
  }

  return (
    <TaskPillBar
      todo={todo}
      people={people}
      status={status}
      today={today}
      interactive={false}
      ariaHidden
    />
  )
}

/**
 * One search-result row: a complete checkbox, then the title / snippet /
 * pills as an option button (click or Enter opens the task).
 *
 * Right-clicking surfaces the same context menu as `TaskRow`. The menu lives
 * on the parent `TopBar` (not on each row) so it survives re-renders and so
 * the dropdown stays mounted underneath the menu (the result list stays
 * visible while the menu is open so the user can pick another row).
 */
function SearchResultRow({ todo, field, pillCtx, onOpen, onKeyDown, onOpenContextMenu }: {
  todo: PersistedTodoItem
  field: TextMatchField
  pillCtx: SearchResultPillContext
  onOpen: (todoId: number) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, todoId: number) => void
  onOpenContextMenu: (todo: PersistedTodoItem, x: number, y: number) => void
}) {
  const { handleToggleComplete } = useTaskRowActions({ todo })
  return (
    <div className={`${styles.miniListItem} ${todo.isCompleted ? styles.miniListItemCompleted : ''}`}>
      <input
        type="checkbox"
        className={styles.miniListCheckbox}
        checked={todo.isCompleted}
        onChange={handleToggleComplete}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
      />
      <button
        type="button"
        role="option"
        aria-selected={false}
        className={styles.miniListItemContent}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onOpen(todo.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenContextMenu(todo, e.clientX, e.clientY)
        }}
        onKeyDown={(e) => onKeyDown(e, todo.id)}
        style={{ cursor: 'pointer' }}
      >
        <span className={styles.miniListTitle}>{todo.title}</span>
        {field === 'notes' && todo.notes && (
          <span className={styles.miniListMatchSnippet}>{collapseWhitespace(todo.notes)}</span>
        )}
        <SearchResultPills todo={todo} ctx={pillCtx} />
      </button>
    </div>
  )
}

/**
 * Right-click menu for a search result. Its own component so TopBar hands the
 * ref-touching `handleOpenTodo` over as a JSX prop instead of passing it into
 * a render-time `searchMenuHandlers` call (`react-hooks/refs`).
 */
function SearchResultContextMenu({ x, y, todo, onOpen, onClose }: {
  x: number
  y: number
  todo: PersistedTodoItem
  onOpen: (todoId: number) => void
  onClose: () => void
}) {
  return (
    <TaskMenu
      todo={todo}
      point={{ x, y }}
      selectionAware={false}
      handlers={searchMenuHandlers({ todo, onOpen })}
      onClose={onClose}
    />
  )
}

const NO_EXPANDED_FIELDS: ReadonlySet<TextMatchField> = new Set()
const NO_TODOS: PersistedTodoItem[] = []
const NO_PEOPLE_MAP = new Map<number, Person[]>()
const NO_TAGS_MAP = new Map<number, Tag[]>()

const SearchResultsGroups = forwardRef<HTMLDivElement, {
  groups: Record<TextMatchField, PersistedTodoItem[]>
  query: string
  /** The box's note for a name matching nobody, above the results. */
  note?: ReactNode
  pillCtx: SearchResultPillContext
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onOpen: (todoId: number) => void
  onBlur: (e: React.FocusEvent<HTMLDivElement>) => void
  onOpenContextMenu: (todo: PersistedTodoItem, x: number, y: number) => void
}>(function SearchResultsGroups({ groups, query, note, pillCtx, searchInputRef, onOpen, onBlur, onOpenContextMenu }, ref) {
  // "Show all" expansions belong to the query they were made under; a new
  // query starts collapsed. Derived from the stored query instead of reset in
  // an effect.
  const [expansion, setExpansion] = useState<{ query: string; fields: ReadonlySet<TextMatchField> }>(
    () => ({ query, fields: new Set() }),
  )
  const expanded = expansion.query === query ? expansion.fields : NO_EXPANDED_FIELDS
  const containerRef = useRef<HTMLDivElement | null>(null)

  const setRefs = (el: HTMLDivElement | null) => {
    containerRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el
  }

  const focusSibling = (current: HTMLElement, dir: 1 | -1) => {
    const options = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
    const i = options.indexOf(current as HTMLButtonElement)
    if (dir === -1 && i <= 0) { searchInputRef.current?.focus(); return }
    const next = options[i + dir]
    next?.focus()
  }

  const onItemKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, todoId: number) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); focusSibling(e.currentTarget, 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusSibling(e.currentTarget, -1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(todoId) }
    else if (e.key === 'Escape') { e.preventDefault(); searchInputRef.current?.focus() }
  }

  return (
    <div
      ref={setRefs}
      className={styles.searchMiniList}
      id="search-results"
      role="listbox"
      aria-label="Search results"
      tabIndex={-1}
      onBlur={onBlur}
    >
      {note}
      {SEARCH_FIELD_ORDER.map(field => {
        const items = groups[field]
        if (items.length === 0) return null
        const shown = expanded.has(field) ? items : items.slice(0, MAX_GROUP_PREVIEW)
        return (
          <div key={field} role="group" aria-label={SEARCH_FIELD_LABELS[field]}>
            <div className={styles.miniListGroupHeader}>
              <SearchFieldIcon field={field} />
              <span>{SEARCH_FIELD_LABELS[field]}</span>
              <span className={styles.miniListGroupCount}>{items.length}</span>
            </div>
            {shown.map((todo, localIdx) => (
              <SearchResultRow
                key={`${field}-${todo.id}-${localIdx}`}
                todo={todo}
                field={field}
                pillCtx={pillCtx}
                onOpen={onOpen}
                onKeyDown={onItemKeyDown}
                onOpenContextMenu={onOpenContextMenu}
              />
            ))}
            {items.length > MAX_GROUP_PREVIEW && !expanded.has(field) && (
              <button
                className={styles.miniListShowAll}
                onMouseDown={(e) => { e.preventDefault(); setExpansion({ query, fields: new Set(expanded).add(field) }) }}
              >
                Show all {items.length}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
})

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
  const searchPlaceholder = useSearchPlaceholder(searchFocused && box.text === '')
  const miniListRef = useRef<HTMLDivElement>(null)
  // Right-click menu state is kept on TopBar (not SearchResultRow) so the
  // menu outlives the search dropdown closing when the menu opens — the row
  // would otherwise unmount along with its portals.
  const [searchContextMenu, setSearchContextMenu] = useState<
    { todoId: number; x: number; y: number } | null
  >(null)
  // The filtered-tasks panel: while it is open its rows are the search's
  // results (no dropdown), and the tray is its filter editor.
  const panelOpen = useUIStore((s) => s.filterPanelOpen)
  const trayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // The tasks and their people / tags only while the search dropdown (or a
  // result's menu) can show: otherwise a task write doesn't render the bar.
  const searching = !panelOpen && ((searchWords.length > 0 && searchFocused) || searchContextMenu !== null)
  const todos = useTodoStore((s) => (searching ? s.todos : NO_TODOS))
  const statuses = useStatusStore((s) => s.statuses)
  const assignedPeopleMap = usePersonStore((s) => (searching ? s.assignedPeopleMap : NO_PEOPLE_MAP))
  const assignedTagsMap = useTagStore((s) => (searching ? s.assignedTagsMap : NO_TAGS_MAP))
  const openEditPopup = useUIStore((s) => s.openEditPopup)

  const statusesById = useMemo(() => new Map(statuses.map(s => [s.id!, s])), [statuses])

  const filterPredicate = useMemo<TodoPredicate>(() => criteriaToPredicate(filters), [filters])
  const handleFilterChange = useCallback((next: TodoPredicate) => {
    useFilterStore.getState().setAllFilters(predicateToCriteria(next))
  }, [])

  const searchPillCtx = useMemo<SearchResultPillContext>(() => ({
    peopleByTodoId: assignedPeopleMap,
    statusesById,
  }), [assignedPeopleMap, statusesById])

  // The dropdown lists the words' matches among the tasks the chips and the
  // lens keep (completed ones too, last, as before the chips).
  const screenFilter = useScreenFilter()
  const filterSettings = useFilterSettings()
  const miniListGroups = useMemo(() => {
    if (!searchWords || !searchFocused) return null
    const lookups = { assignedPeopleMap, assignedTagsMap, statusesById }
    const narrowing = { ...screenFilter.filters, searchText: '', showCompleted: true }
    const today = startOfToday()
    const kept = screenFilter.active
      ? todos.filter((t) => matchesFilterWithLookups(narrowing, t, lookups, today, filterSettings))
      : todos
    return groupTodosByTextMatch(kept, searchWords, (t) => textMatchContextFor(t, lookups))
  }, [searchWords, searchFocused, todos, assignedPeopleMap, assignedTagsMap, statusesById, screenFilter.filters, screenFilter.active, filterSettings])

  const totalMatchCount = miniListGroups
    ? (Object.values(miniListGroups) as PersistedTodoItem[][]).reduce((n, arr) => n + arr.length, 0)
    : 0
  // The `@ # /` popup under the box (Quick Add's): the results wait while it shows.
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
  // search narrows, then long filter values are cut), then the filter
  // buttons fold into one Filters menu, then the layout tabs into the layout
  // picker. The filtered-tasks panel changes none of it.
  const barRef = useRef<HTMLElement | null>(null)
  const tabsKey = useWorkspaceStore(layoutTabsKey)
  const manyLayouts = useWorkspaceStore((s) => s.layouts.length > MAX_LAYOUT_TABS)
  // The counter shows while a chip is on or a lens is picked (lifted
  // too: 109 of 109), or the panel is open (it stays the panel's toggle when
  // Clear all empties the filter).
  const lensPicked = usePickedLens() != null
  const showTasksButton = isActive || lensPicked || panelOpen
  // While the panel is open over folded filters, the tray expands in place
  // to show every filter button: lifted out of the bar (a slot of its folded
  // width keeps its place, so nothing else moves), from its left edge
  // rightwards over the free space and the right zone — shrunk, then slid
  // left only as far as the window needs. When even the window can't hold it
  // shrunk, it stays folded. Placed before paint, again on every change of
  // the bar's widths.
  // The right zone it reaches into hides under it (no part of the storage
  // pill peeking out beside it).
  const [placed, setPlaced] = useState<(TrayExpansion & { top: number; coversRight: boolean }) | null>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  // The tray gains or loses Show N tasks, or is lifted out: measured again then.
  const { fold, squeeze: barSqueeze, trayOpen, trayOpenMin, trayFolded, values, lensName } = useTopBarFold(barRef, tabsKey, `${isWorkspace}|${showTasksButton}|${panelOpen}|${placed !== null}`)
  const expandable = panelOpen && filtersFolded(fold) && trayOpen !== undefined
  const expansion = expandable ? placed : null
  // The expanded tray shrinks to its own width; in the bar, to the bar's room.
  const squeeze = expansion && trayOpen !== undefined ? traySqueeze(trayOpen, expansion.width, values) : barSqueeze
  useLayoutEffect(() => {
    if (!expandable || trayOpen === undefined) return
    const place = () => {
      // The slot while expanded, else the tray itself: the place in the bar.
      const anchor = slotRef.current ?? trayRef.current
      if (!anchor) return
      const box = anchor.getBoundingClientRect()
      const at = trayExpansion(box.left, trayOpen, window.innerWidth, trayOpenMin)
      const rightZone = rightRef.current?.getBoundingClientRect().left ?? Infinity
      const next = at && { ...at, top: box.top, coversRight: at.left + at.width > rightZone }
      setPlaced((prev) => (prev?.left === next?.left && prev?.top === next?.top && prev?.width === next?.width
        && prev?.coversRight === next?.coversRight ? prev : next))
    }
    place()
    // A part before it changing width (the lens control on a pick from the
    // keyboard or the palette, the layout tabs) moves its place unresized.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    const anchor = slotRef.current ?? trayRef.current
    for (let part = anchor?.previousElementSibling; part; part = part.previousElementSibling) observer?.observe(part)
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [expandable, trayOpen, trayOpenMin, trayFolded, tabsKey])

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
        <button
          type="button"
          className={styles.newTask}
          onClick={() => useUIStore.getState().openQuickAdd()}
          aria-label="New task"
          title={`New task (${quickAddKeys})`}
        >
          <PlusIcon size={14} strokeWidth={2} />
        </button>
        {isWorkspace && (
          <div className={styles.layoutSlot} data-fold-part={FOLD_PART.layout}>
            <LayoutControls mode={tabsFolded(fold) || manyLayouts ? 'menu' : 'tabs'} />
          </div>
        )}
        {/* The top bar's lens: its own part, outside the tray (never lifted
            with it), a fixed width the fold counts like New task's. */}
        {isWorkspace && (
          <div className={styles.lensSlot} data-fold-part={FOLD_PART.lens}>
            <LensControl nameWidth={lensName} />
          </div>
        )}

        {expansion && (
          <div ref={slotRef} className={styles.traySlot} style={{ width: trayFolded }} data-fold-part={FOLD_PART.traySlot} aria-hidden="true" />
        )}
        <div
          ref={trayRef}
          className={`${styles.tray} ${isActive ? styles.trayActive : ''} ${panelOpen ? styles.trayPanelOpen : ''} ${expansion ? styles.trayExpanded : ''}`}
          style={expansion ? { left: expansion.left, top: expansion.top } : undefined}
          data-fold-part={FOLD_PART.tray}
          data-expanded={expansion ? '' : undefined}
          role="group"
          aria-label="Screen filters — apply to every widget"
          {...{ [FILTER_ROW_ATTR]: '' }}
          data-filtered={isActive || undefined}
          onKeyDown={panelOpen ? (e) => tabAcross(e, trayRef.current, panelRef.current) : undefined}
        >
          <ClearFiltersButton active={isActive} />
          <div className={styles.searchWrapper} style={{ width: squeeze?.search ?? SEARCH_WIDTH }} {...{ [FOLD_SEARCH_ATTR]: '' }}>
            <span className={styles.searchIcon}><SearchIcon size={14} /></span>
            <input
              ref={searchInputRef}
              className={styles.searchInput}
              type="text"
              placeholder={searchPlaceholder}
              aria-label="Search tasks"
              value={box.text}
              onChange={(e) => box.onChange(e.target.value, e.target.selectionStart ?? e.target.value.length, e.target)}
              onSelect={syncMirror}
              onMouseUp={(e) => box.onCaretMove(e.currentTarget)}
              onKeyUp={(e) => {
                if (CARET_KEYS.has(e.key)) box.onCaretMove(e.currentTarget)
              }}
              onScroll={syncMirror}
              aria-controls="search-results"
              aria-expanded={showMiniList || popupOpen}
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
                // The `@ # /` popup's keys; ⏎ makes every token a chip;
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
                aria-label="Clear search"
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
              <div className={styles.searchNotePopover}>{unmatchedNotes}</div>
            )}
          </div>

          <FilterChipBar
            predicate={filterPredicate}
            onChange={handleFilterChange}
            onClearAll={() => useFilterStore.getState().clearAll()}
            fold={filtersFolded(fold) && !expansion}
            measureFold
            valueWidths={squeeze?.values}
            consumeEscape={panelOpen}
          />
          {showTasksButton && <ShowFilteredTasksButton open={panelOpen} />}
        </div>

        <div
          ref={rightRef}
          className={`${styles.right} ${expansion?.coversRight ? styles.rightCovered : ''}`}
          data-fold-part={FOLD_PART.spring}
        >
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
      {panelOpen && <FilteredTasksPanel trayRef={trayRef} topBarRef={barRef} panelRef={panelRef} trayLeft={expansion?.left} />}
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
