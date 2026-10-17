import { useState, useRef, useEffect, useCallback, useMemo, forwardRef } from 'react'
import { useLocation } from 'react-router'
import { ROUTE_WORKSPACE } from '../../routes'
import { SEARCH_DEBOUNCE_MS } from '../../constants'
import { useFilterStore } from '../../stores/filter-store'
import { criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import type { Person, PersistedTodoItem, Status, TodoPredicate } from '../../models'
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
import { StoragePill } from './StoragePill'
import { CloseIcon, FunnelIcon, GearIcon, PlusIcon, SearchIcon } from '../shared/icons'
import { useMediaQuery } from '../../hooks/use-media-query'
import { formatShortcut } from '../../utils/platform'
import styles from './TopBar.module.css'
import { collapseWhitespace } from '../../utils/text'

const SEARCH_FIELD_ORDER: TextMatchField[] = ['title', 'notes', 'person', 'status', 'tag']
const SEARCH_FIELD_LABELS: Record<TextMatchField, string> = {
  title: 'Title',
  notes: 'Notes',
  person: 'Person',
  status: 'Status',
  tag: 'Tags',
}
const MAX_GROUP_PREVIEW = 5

/** Below this width the screen-filter buttons fold into one Filters menu. */
const FOLD_FILTERS_QUERY = '(max-width: 1279px)'

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

const SearchResultsGroups = forwardRef<HTMLDivElement, {
  groups: Record<TextMatchField, PersistedTodoItem[]>
  query: string
  pillCtx: SearchResultPillContext
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onOpen: (todoId: number) => void
  onBlur: (e: React.FocusEvent<HTMLDivElement>) => void
  onOpenContextMenu: (todo: PersistedTodoItem, x: number, y: number) => void
}>(function SearchResultsGroups({ groups, query, pillCtx, searchInputRef, onOpen, onBlur, onOpenContextMenu }, ref) {
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
  const filters = useFilterStore((s) => s.filters)
  const isActive = useFilterStore((s) => s.isActive)
  const setSearchText = useFilterStore((s) => s.setSearchText)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [localSearch, setLocalSearch] = useState(filters.searchText)
  const [searchFocused, setSearchFocused] = useState(false)
  const miniListRef = useRef<HTMLDivElement>(null)
  // Right-click menu state is kept on TopBar (not SearchResultRow) so the
  // menu outlives the search dropdown closing when the menu opens — the row
  // would otherwise unmount along with its portals.
  const [searchContextMenu, setSearchContextMenu] = useState<
    { todoId: number; x: number; y: number } | null
  >(null)
  const todos = useTodoStore((s) => s.todos)
  const statuses = useStatusStore((s) => s.statuses)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const openEditPopup = useUIStore((s) => s.openEditPopup)

  const handleSearchChange = useCallback((value: string) => {
    setLocalSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearchText(value), SEARCH_DEBOUNCE_MS)
  }, [setSearchText])

  // A pending debounce must not outlive the bar: it would write a stale query
  // into the global filter store after unmount (and a remounted bar would
  // pick it up, replacing what the user typed since).
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  // The store's search text changed (typed here and debounced in, or
  // cleared elsewhere): show it. Adjusted during render, not in an effect.
  const storeSearchText = filters.searchText
  const [shownStoreSearch, setShownStoreSearch] = useState(storeSearchText)
  if (storeSearchText !== shownStoreSearch) {
    setShownStoreSearch(storeSearchText)
    setLocalSearch(storeSearchText)
  }

  const statusesById = useMemo(() => new Map(statuses.map(s => [s.id!, s])), [statuses])

  const filterPredicate = useMemo<TodoPredicate>(() => criteriaToPredicate(filters), [filters])
  const handleFilterChange = useCallback((next: TodoPredicate) => {
    useFilterStore.getState().setAllFilters(predicateToCriteria(next))
  }, [])

  const searchPillCtx = useMemo<SearchResultPillContext>(() => ({
    peopleByTodoId: assignedPeopleMap,
    statusesById,
  }), [assignedPeopleMap, statusesById])

  const miniListGroups = useMemo(() => {
    if (!localSearch || !searchFocused) return null
    const lookups = { assignedPeopleMap, assignedTagsMap, statusesById }
    return groupTodosByTextMatch(todos, localSearch, (t) => textMatchContextFor(t, lookups))
  }, [localSearch, searchFocused, todos, assignedPeopleMap, assignedTagsMap, statusesById])

  const totalMatchCount = miniListGroups
    ? (Object.values(miniListGroups) as PersistedTodoItem[][]).reduce((n, arr) => n + arr.length, 0)
    : 0
  const showMiniList = searchFocused && localSearch.length > 0 && !!miniListGroups && totalMatchCount > 0

  const location = useLocation()
  const isWorkspace = location.pathname === ROUTE_WORKSPACE
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  // The bar never wraps: below 1280px the filter buttons fold into one
  // Filters menu (search and labels narrow in CSS).
  const foldFilters = useMediaQuery(FOLD_FILTERS_QUERY)

  const handleOpenTodo = useCallback((todoId: number) => {
    openEditPopup(todoId)
    handleSearchChange('')
    setSearchFocused(false)
    searchInputRef.current?.blur()
  }, [openEditPopup, handleSearchChange])

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
    <header className={styles.topBar}>
      <button
        type="button"
        className={styles.newTask}
        onClick={() => useUIStore.getState().openQuickAdd()}
        aria-label="New task"
        title={`New task (${formatShortcut('Mod-Space')})`}
      >
        <PlusIcon size={14} strokeWidth={2} />
        <span className={styles.newTaskLabel}>New task</span>
      </button>
      {isWorkspace && <LayoutControls />}

      <div
        className={`${styles.tray} ${isActive ? styles.trayActive : ''}`}
        role="group"
        aria-label="Screen filters — apply to every widget"
        data-filter-row
        data-filtered={isActive || undefined}
      >
        <div className={styles.searchWrapper}>
          <span className={styles.searchIcon}><SearchIcon size={14} /></span>
          <input
            ref={searchInputRef}
            className={styles.searchInput}
            type="text"
            placeholder="Search…"
            aria-label="Search tasks"
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            aria-controls="search-results"
            aria-expanded={showMiniList}
            onFocus={() => setSearchFocused(true)}
            onBlur={(e) => {
              if (miniListRef.current?.contains(e.relatedTarget as Node)) return
              // Right-click on a search row opens a context menu that autoFocuses
              // its first item; preserve the listbox so the menu's actions can
              // still target the row.
              if (searchContextMenu) return
              setSearchFocused(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleSearchChange('')
                setSearchFocused(false)
                searchInputRef.current?.blur()
              } else if (e.key === 'ArrowDown' && showMiniList) {
                e.preventDefault()
                const first = miniListRef.current?.querySelector<HTMLButtonElement>('[role="option"]')
                first?.focus()
              }
            }}
            data-search-input
          />
          {localSearch ? (
            <button
              type="button"
              className={styles.searchClear}
              aria-label="Clear search"
              onMouseDown={(e) => { e.preventDefault(); handleSearchChange(''); searchInputRef.current?.focus() }}
            >
              <CloseIcon size={8} />
            </button>
          ) : (
            <kbd className={styles.searchKbd} aria-hidden="true">/</kbd>
          )}
          {showMiniList && miniListGroups && (
            <SearchResultsGroups
              ref={miniListRef}
              groups={miniListGroups}
              query={localSearch}
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
          )}
        </div>

        <span className={styles.funnel} title="Filters apply to every widget on screen" aria-hidden="true">
          <FunnelIcon size={14} />
        </span>
        <FilterChipBar
          predicate={filterPredicate}
          onChange={handleFilterChange}
          onClearAll={() => useFilterStore.getState().clearAll()}
          fold={foldFilters}
          compact={foldFilters}
        />
      </div>

      <div className={styles.right}>
        <StoragePill />
        <button
          type="button"
          className={`${styles.gear} ${settingsOpen ? styles.gearOpen : ''}`}
          onClick={() => useUIStore.getState().openSettings()}
          aria-label="Settings"
          title="Settings (G then S)"
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
  )
}
