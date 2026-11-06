import { forwardRef, useRef, useState, type ReactNode } from 'react'
import type { Person, PersistedTodoItem, Status, StatusUpdate, Subtask } from '../../models'
import { formatDateNumeric, startOfToday } from '../../utils/date'
import type { TextMatchField } from '../../utils/filter'
import { collapseWhitespace } from '../../utils/text'
import { useTaskRowActions } from '../../hooks/use-task-row-actions'
import { TaskPillBar } from '../shared/TaskPillBar'
import { PopoverRoot } from '../shared/PopoverRoot'
import { TaskMenu } from '../task/TaskMenu'
import { searchMenuHandlers } from './top-bar-search-menu'
import styles from './TopBar.module.css'

/**
 * The top bar's search results (cr31 A7 moved them out of `TopBar`, which
 * keeps the box, its state and the lookups): the dropdown's groups by the
 * field each task matched on, its rows (a complete box, the title, a
 * snippet, the pills) and a row's context menu.
 */

const SEARCH_FIELD_ORDER: TextMatchField[] = ['title', 'notes', 'statusUpdate', 'subtask', 'person', 'status', 'tag']
const SEARCH_FIELD_LABELS: Record<TextMatchField, string> = {
  title: 'Title',
  notes: 'Notes',
  statusUpdate: 'Status updates',
  subtask: 'Subtasks',
  person: 'Person',
  status: 'Status',
  tag: 'Tags',
}
const MAX_GROUP_PREVIEW = 5

function SearchFieldIcon({ field }: { field: TextMatchField }) {
  const common = { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (field) {
    case 'title':
      return <svg {...common}><path d="M3 3h10M3 6h10M3 9h7M3 12h10" /></svg>
    case 'notes':
      return <svg {...common}><path d="M4 2h6l2 2v10H4z" /><path d="M6 6h4M6 8h4M6 10h3" /></svg>
    case 'statusUpdate':
      return <svg {...common}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></svg>
    case 'subtask':
      return <svg {...common}><path d="M3 3.5h10M6 8h7M6 12.5h7M3 8v4.5" /></svg>
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
 * to the assigned-people / status / status update stores.
 */
export interface SearchResultPillContext {
  peopleByTodoId: ReadonlyMap<number, readonly Person[]>
  statusesById: ReadonlyMap<number, Status>
  /** Each task's status updates, newest first (a Status updates hit's snippet). */
  statusUpdatesByTodo: ReadonlyMap<number, readonly StatusUpdate[]>
  /** Each task's checklist, in order (a Subtasks hit's snippet). */
  subtasksByTodo: ReadonlyMap<number, readonly Subtask[]>
}

/** A Subtasks hit's snippet: the first subtask the query hits, `☐ title` (`☑` when done). */
function subtaskSnippet(subtasks: readonly Subtask[] | undefined, query: string): string | undefined {
  const q = query.toLowerCase().trim()
  const hit = subtasks?.find((s) => s.title.toLowerCase().includes(q))
  return hit ? `${hit.isCompleted ? '☑' : '☐'} ${hit.title}` : undefined
}

/** A Status updates hit's snippet: the newest entry the query hits, `MM/DD · text`. */
function statusUpdateSnippet(updates: readonly StatusUpdate[] | undefined, query: string): string | undefined {
  const q = query.toLowerCase().trim()
  const hit = updates?.find((u) => u.text.toLowerCase().includes(q))
  return hit ? `${formatDateNumeric(hit.date)} · ${hit.text}` : undefined
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
function SearchResultRow({ todo, field, query, pillCtx, onOpen, onKeyDown, onOpenContextMenu }: {
  todo: PersistedTodoItem
  field: TextMatchField
  query: string
  pillCtx: SearchResultPillContext
  onOpen: (todoId: number) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, todoId: number) => void
  onOpenContextMenu: (todo: PersistedTodoItem, x: number, y: number) => void
}) {
  const { handleToggleComplete } = useTaskRowActions({ todo })
  const updateSnippet = field === 'statusUpdate' ? statusUpdateSnippet(pillCtx.statusUpdatesByTodo.get(todo.id), query) : undefined
  const subtaskHit = field === 'subtask' ? subtaskSnippet(pillCtx.subtasksByTodo.get(todo.id), query) : undefined
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
        {updateSnippet && <span className={styles.miniListMatchSnippet}>{updateSnippet}</span>}
        {subtaskHit && <span className={styles.miniListMatchSnippet} data-subtask-snippet="">{subtaskHit}</span>}
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
export function SearchResultContextMenu({ x, y, todo, onOpen, onClose }: {
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

export const SearchResultsGroups = forwardRef<HTMLDivElement, {
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
    <PopoverRoot
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
                query={query}
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
    </PopoverRoot>
  )
})
