import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDndMonitor, useDroppable, type DragStartEvent } from '@dnd-kit/core'
import type { PersistedTodoItem } from '../../../models'
import type { PersistedListDefinition } from '../../../models/list-definition'
import {
  EISENHOWER_QUADRANTS,
  type EisenhowerQuadrant,
  type EisenhowerTab,
} from '../../../models/workspace-layout'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useToday } from '../../../hooks/use-today'
import { useFilterSettings } from '../../../hooks/use-filter-settings'
import { useTooltip } from '../../shared/use-tooltip'
import { useFilterStore } from '../../../stores/filter-store'
import { countActiveFilters } from '../../../utils/filter-criteria'
import { hasNarrowingFilters } from '../../../utils/filter-chips'
import { applyFilter } from '../../../utils/filter-match'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import {
  blockedDropLines,
  buildQuadrants,
  dropPreviewLabel,
  insertionIndex,
  QUADRANT_FLAGS,
  QUADRANT_NAME,
  QUADRANT_SUBTITLE,
  resolveQuadrantDrop,
  type QuadrantDropResult,
} from '../../../utils/eisenhower'
import { getFilterDefaults, predicateToFilterDefaults, withUrgentImportant } from '../../../utils/filter-defaults'
import { rowKey, type ScopedRow } from '../../../utils/scoped-selection'
import { eisenhowerQuadrantDropId, TASK_DROP_KIND } from '../../../utils/task-dnd'
import type { UrgentDueWithinDays } from '../../../utils/urgency'
import { createValueStore, type ValueStore } from '../../../utils/value-store'
import { MobileTaskRow } from '../../task/MobileTaskRow'
import { TaskRowGrid } from '../../task/TaskRowGrid'
import { ImportantIcon, UrgentIcon } from '../../shared/MarkerIcons'
import { ChevronDownIcon, PlusIcon } from '../../shared/icons'
import { useElementSize } from '../../../hooks/use-element-size'
import { ListBulkBar } from '../list/ListBulkBar'
import { ListWidgetRow, type ListRowDragLook, type ListRowSelectMods } from '../list/ListWidgetRow'
import { dragTasks } from './eisenhower-drag'
import tooltipStyles from '../../shared/Tooltip.module.css'
import styles from './EisenhowerWidget.module.css'
import { useWidgetSelection } from '../../../hooks/use-widget-selection'
import { useBuiltList } from '../../../hooks/use-built-list'
import { useEffectiveListDefinition } from '../../../hooks/use-list-draft'
import { ListFilterRow } from '../list/ListFilterRow'
import { openEditList, useTabTitle } from '../widget-hooks'

/** Below this cell width the quadrants stack as collapsible sections. */
export const EISENHOWER_STACK_BREAKPOINT_PX = 560

/** Refusal tooltip offset from the pointer (below the lifted row). */
const REFUSAL_OFFSET = { x: 4, y: 26 }

/** What the widget reports to its cell: the tab count. */
export interface EisenhowerResult {
  /** Open tasks shown; `shown of total` when the screen filter hides some. */
  countLabel: string
}

const EMPTY_LINES: Record<EisenhowerQuadrant, [string, string]> = {
  do: ['Nothing urgent and important', 'Drop a task here to mark it urgent and important.'],
  schedule: ['Nothing to schedule', 'Drop a task here to mark it important.'],
  delegate: ['Nothing to delegate', 'Drop a task here to mark it urgent.'],
  drop: ['Nothing here', 'Tasks with neither flag land here.'],
}

const ADD_HINT: Record<EisenhowerQuadrant, string> = {
  do: 'Opens Quick Add marked urgent and important.',
  schedule: 'Opens Quick Add marked important.',
  delegate: 'Opens Quick Add marked urgent.',
  drop: 'Opens Quick Add.',
}

/** A task drag over the workspace, as this widget sees it. */
interface QuadrantDrag {
  /** The tasks the drag moves (the dragged task, or its selection). */
  tasks: PersistedTodoItem[]
  /** The dragged task. */
  primary: PersistedTodoItem
  /** What a drop on each quadrant would do. */
  results: Record<EisenhowerQuadrant, QuadrantDropResult<PersistedTodoItem>>
  /** The dragged row's key when it came from this widget. */
  sourceKey: string | null
  /** The quadrant of this widget under the pointer. */
  over: EisenhowerQuadrant | null
  /** The pointer (viewport), tracked while over a refusing quadrant. */
  pointer: { x: number; y: number } | null
}

/** Where the pointer is during a drag: where it went down + how far it moved. */
function dragPoint(event: { activatorEvent: Event | null; delta: { x: number; y: number } }): { x: number; y: number } | null {
  const e = event.activatorEvent as { clientX?: unknown; clientY?: unknown } | null
  if (!e || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return null
  return { x: e.clientX + event.delta.x, y: e.clientY + event.delta.y }
}

function dropResults(tasks: PersistedTodoItem[], today: Date, range: UrgentDueWithinDays): QuadrantDrag['results'] {
  return {
    do: resolveQuadrantDrop(tasks, 'do', today, range),
    schedule: resolveQuadrantDrop(tasks, 'schedule', today, range),
    delegate: resolveQuadrantDrop(tasks, 'delegate', today, range),
    drop: resolveQuadrantDrop(tasks, 'drop', today, range),
  }
}

/**
 * Follows task drags (from this widget or any other) and works out, per
 * quadrant, what a drop would do — for the valid-target hairlines, the hover
 * preview and the refusal tooltip. The drop itself is applied by the page
 * (`dispatchTaskDrop`).
 */
function useQuadrantDrag(tabId: string, today: Date, range: UrgentDueWithinDays): QuadrantDrag | null {
  const [drag, setDrag] = useState<QuadrantDrag | null>(null)
  const ctxRef = useLatestRef({ today, range })
  useDndMonitor({
    onDragStart(event: DragStartEvent) {
      const data = event.active.data.current
      if (!data || data.todo == null) return
      const tasks = dragTasks(data)
      const primary = tasks.find((t) => t.id === (data.todo as PersistedTodoItem).id) ?? tasks[0]
      if (!primary) return
      const { today: t, range: r } = ctxRef.current
      setDrag({
        tasks,
        primary,
        results: dropResults(tasks, t, r),
        sourceKey: data.listTabId === tabId && typeof data.rowKey === 'string' ? data.rowKey : null,
        over: null,
        pointer: null,
      })
    },
    onDragOver(event) {
      const o = event.over?.data.current
      const over = o?.type === TASK_DROP_KIND.eisenhowerQuadrant && o.scope === tabId ? (o.quadrant as EisenhowerQuadrant) : null
      const pointer = dragPoint(event)
      setDrag((prev) => {
        if (!prev) return prev
        const refusing = over != null && prev.results[over].kind === 'blocked'
        if (prev.over === over && !refusing) return prev
        return { ...prev, over, pointer: refusing ? pointer : null }
      })
    },
    onDragMove(event) {
      const pointer = dragPoint(event)
      setDrag((prev) => (prev?.over != null && prev.results[prev.over].kind === 'blocked' ? { ...prev, pointer } : prev))
    },
    onDragEnd() { setDrag(null) },
    onDragCancel() { setDrag(null) },
  })
  return drag
}

/**
 * The refusal tooltip for a blocked drop: follows the pointer (below the
 * lifted row), shown at once, kept inside the widget.
 */
function RefusalTooltip({ lines, pointer, boundsRef }: {
  lines: readonly string[]
  pointer: { x: number; y: number }
  boundsRef: React.RefObject<HTMLElement | null>
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const b = el.getBoundingClientRect()
    const box = boundsRef.current?.getBoundingClientRect()
    const right = box ? box.right : window.innerWidth
    const bottom = box ? box.bottom : window.innerHeight
    let left = pointer.x + REFUSAL_OFFSET.x
    let top = pointer.y + REFUSAL_OFFSET.y
    if (left + b.width > right) left = Math.max(box?.left ?? 0, pointer.x - REFUSAL_OFFSET.x - b.width)
    if (top + b.height > bottom) top = Math.max(box?.top ?? 0, pointer.y - REFUSAL_OFFSET.y - b.height)
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }))
  }, [pointer, boundsRef, lines])
  const [first, ...rest] = lines
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className={`${tooltipStyles.tooltip} ${tooltipStyles.multiLine} ${styles.refusal}`}
      style={pos ?? { left: -9999, top: -9999 }}
      data-placed={pos ? 'true' : undefined}
      data-testid="eisenhower-refusal"
    >
      <span>{first}</span>
      {rest.map((line, i) => <span key={i} className={tooltipStyles.line}>{line}</span>)}
    </div>,
    document.body,
  )
}

/** The flag glyphs of a quadrant's header. */
function QuadrantGlyphs({ q }: { q: EisenhowerQuadrant }) {
  const flags = QUADRANT_FLAGS[q]
  if (!flags.urgent && !flags.important) return null
  return (
    <span className={styles.glyphs} aria-hidden="true">
      {flags.urgent && <span className={styles.glyphUrgent}><UrgentIcon /></span>}
      {flags.important && <span className={styles.glyphImportant}><ImportantIcon /></span>}
    </span>
  )
}

function AddButton({ q, onAdd }: { q: EisenhowerQuadrant; onAdd: () => void }) {
  const label = `Add task to ${QUADRANT_NAME[q]}`
  const { triggerProps, tooltip } = useTooltip(`${label}\n${ADD_HINT[q]}`)
  return (
    <button type="button" className={styles.add} aria-label={label} onClick={onAdd} {...triggerProps}>
      <PlusIcon size={12} strokeWidth={2} />
      {tooltip}
    </button>
  )
}

/** What the widget's rows share. */
interface RowContext {
  tabId: string
  isMobile: boolean
  drag: QuadrantDrag | null
  inScope: boolean
  selectedIds: ReadonlySet<number>
  cursorKey: string | null
  onSelect: (key: string, todoId: number, mods: ListRowSelectMods) => void
  onOpen: (todoId: number) => void
  /** The tab's task-row details width (one value for every quadrant). */
  detailsWidth: number | undefined
  onDetailsWidthChange: (width: number | undefined) => void
  /** The width while a quadrant's divider is dragged: every quadrant follows it live. */
  liveDetailsWidth: ValueStore<number | null>
}

interface QuadrantProps {
  q: EisenhowerQuadrant
  tasks: PersistedTodoItem[]
  openCount: number
  stacked: boolean
  collapsed: boolean
  /** The screen filter hides every task: no per-quadrant empty lines. */
  hideEmptyLines: boolean
  ctx: RowContext
  onToggle: (collapse: boolean) => void
  onAdd: () => void
}

function Quadrant({ q, tasks, openCount, stacked, collapsed, hideEmptyLines, ctx, onToggle, onAdd }: QuadrantProps) {
  const { drag, isMobile, tabId } = ctx
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const { setNodeRef } = useDroppable({
    id: eisenhowerQuadrantDropId(tabId, q),
    data: { type: TASK_DROP_KIND.eisenhowerQuadrant, quadrant: q, scope: tabId },
    disabled: isMobile,
  })

  const result = drag?.results[q]
  const isOver = drag?.over === q
  const state = !drag || !result
    ? undefined
    : result.kind === 'apply'
      ? (isOver ? 'over' : 'valid')
      : result.kind === 'blocked'
        ? (isOver ? 'refused' : 'blocked')
        : 'current'
  const preview = isOver && result?.kind === 'apply' ? dropPreviewLabel(result.changes) : ''
  const fromHere = drag?.sourceKey != null && tasks.some((t) => rowKey(q, t.id) === drag.sourceKey)
  const lineAt = isOver && result?.kind === 'apply' && drag ? insertionIndex(tasks, drag.primary) : -1

  const rowLook = (key: string): ListRowDragLook => {
    if (!fromHere || !drag) return 'idle'
    return key === drag.sourceKey ? 'slot' : 'dim'
  }

  const rows: ReactNode[] = []
  let j = 0
  tasks.forEach((todo, i) => {
    const key = rowKey(q, todo.id)
    if (key !== drag?.sourceKey) {
      if (j === lineAt) rows.push(<div key="drop-line" className={styles.dropLine} data-drop-line="" />)
      j++
    }
    const people = assignedPeopleMap.get(todo.id)
    if (isMobile) {
      rows.push(<MobileTaskRow key={key} todo={todo} assignedPeople={people} onOpenDetail={ctx.onOpen} />)
      return
    }
    const prev = tasks[i - 1]
    const next = tasks[i + 1]
    rows.push(
      <ListWidgetRow
        key={key}
        todo={todo}
        assignedPeople={people}
        tabId={tabId}
        sectionKey={q}
        rowKey={key}
        selected={ctx.inScope && ctx.selectedIds.has(todo.id)}
        selFirst={!(prev && ctx.selectedIds.has(prev.id))}
        selLast={!(next && ctx.selectedIds.has(next.id))}
        cursor={ctx.cursorKey === key}
        look={rowLook(key)}
        onSelect={ctx.onSelect}
        onOpenDetail={ctx.onOpen}
      />,
    )
  })
  if (lineAt >= 0 && j === lineAt) rows.push(<div key="drop-line" className={styles.dropLine} data-drop-line="" />)

  const showBody = !stacked || !collapsed
  const [emptyTitle, emptyHint] = EMPTY_LINES[q]
  const headerContent = (
    <>
      {stacked && <span className={styles.chevron} aria-hidden="true"><ChevronDownIcon /></span>}
      <QuadrantGlyphs q={q} />
      <span className={styles.name}>{QUADRANT_NAME[q]}</span>
      <span className={styles.subtitle}>{QUADRANT_SUBTITLE[q]}</span>
    </>
  )

  return (
    <section
      ref={setNodeRef}
      className={styles.quadrant}
      data-eis-quadrant={q}
      data-drop-state={state}
      data-collapsed={stacked && collapsed ? 'true' : undefined}
      aria-label={`${QUADRANT_NAME[q]}: ${QUADRANT_SUBTITLE[q]}`}
    >
      <div className={styles.header}>
        {stacked ? (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={!collapsed}
            onClick={() => onToggle(!collapsed)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' && !collapsed) { e.preventDefault(); onToggle(true) }
              else if (e.key === 'ArrowRight' && collapsed) { e.preventDefault(); onToggle(false) }
            }}
          >
            {headerContent}
          </button>
        ) : (
          <div className={styles.title}>{headerContent}</div>
        )}
        <span className={styles.headerEnd}>
          {!drag && <AddButton q={q} onAdd={onAdd} />}
          {preview && <span className={styles.preview} data-testid="eisenhower-drop-preview">{preview}</span>}
          <span className={styles.count} data-testid="eisenhower-count">{openCount}</span>
        </span>
      </div>
      {showBody && (
        <div className={styles.body}>
          {rows.length > 0 ? (ctx.isMobile ? rows : (
            <TaskRowGrid
              detailsWidth={ctx.detailsWidth}
              onDetailsWidthChange={ctx.onDetailsWidthChange}
              liveDetailsWidth={ctx.liveDetailsWidth}
            >
              {rows}
            </TaskRowGrid>
          )) : !hideEmptyLines && (
            <div className={styles.empty}>
              <span className={styles.emptyTitle}>{emptyTitle}</span>
              <span className={styles.emptyHint}>{emptyHint}</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

interface WidgetProps {
  tab: EisenhowerTab
  onResult?: (r: EisenhowerResult) => void
}

/**
 * The Eisenhower widget: tasks in four quadrants by effective Urgent (flag
 * or due date, `utils/urgency`) × Important, as a 2×2 grid or — in narrow
 * cells and on phones — four collapsible sections. It shows all tasks, or
 * one saved list's (`config.listDefinitionId`: its unsaved draft included,
 * its prompt, group and sort ignored, its filter line above the quadrants);
 * the screen filter narrows either. Rows drag between quadrants (and in
 * from other widgets) to set the flags; a task urgent by its due date can't
 * be dropped on a not-urgent quadrant. Each quadrant's "+" opens Quick Add
 * with its flags (and the list's defaults).
 */
export function EisenhowerWidget({ tab, onResult }: WidgetProps) {
  const listId = tab.config.listDefinitionId
  return listId == null
    ? <AllTasksEisenhower tab={tab} onResult={onResult} />
    : <ListEisenhower tab={tab} listDefinitionId={listId} onResult={onResult} />
}

/** All tasks, through the screen filter. */
function AllTasksEisenhower({ tab, onResult }: WidgetProps) {
  const today = useToday()
  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statuses = useStatusStore((s) => s.statuses)
  const screen = useFilterStore((s) => s.filters)
  const markerSettings = useFilterSettings()
  const shown = useMemo(
    () => applyFilter(screen, todos, assignedPeopleMap, statuses, today, assignedTagsMap, markerSettings),
    [screen, todos, assignedPeopleMap, statuses, today, assignedTagsMap, markerSettings],
  )
  const openTotal = useMemo(() => countOpen(todos), [todos])
  return <EisenhowerBody tab={tab} onResult={onResult} shown={shown} openTotal={openTotal} />
}

/** One saved list's tasks (as edited), through the screen filter, as a list widget runs it. */
function ListEisenhower({ tab, listDefinitionId, onResult }: WidgetProps & { listDefinitionId: number }) {
  const definition = useEffectiveListDefinition(listDefinitionId)
  if (!definition) {
    return (
      <div className={styles.missing}>
        <span className={styles.noteTitle}>This list was deleted</span>
        <button
          type="button"
          className={styles.noteAction}
          onClick={() => useWorkspaceStore.getState().patchTabConfig(tab.id, 'eisenhower', { listDefinitionId: undefined })}
        >
          Show all tasks
        </button>
      </div>
    )
  }
  return <ListEisenhowerBody tab={tab} definition={definition} onResult={onResult} />
}

function ListEisenhowerBody({ tab, definition, onResult }: WidgetProps & { definition: PersistedListDefinition }) {
  const screen = useFilterStore((s) => s.filters)
  const screenActive = useFilterStore((s) => s.isActive)
  const todos = useTodoStore((s) => s.todos)
  const title = useTabTitle(tab)
  // Only the list's members matter here: its prompt (a temporary pick), group
  // and sort don't apply to the quadrants.
  const membersOnly = useMemo<PersistedListDefinition>(
    () => ({ ...definition, runtimeFilter: undefined, grouping: 'none' }),
    [definition],
  )
  const built = useBuiltList(membersOnly, undefined, screenActive ? screen : undefined)
  const shown = built.list?.todos ?? NO_TASKS
  const openTotal = useMemo(() => built.countOpenBase(), [built])
  const appOpen = useMemo(() => countOpen(todos), [todos])
  const list = useMemo<ListSourceContext>(() => ({ definition, title, appOpen }), [definition, title, appOpen])
  return <EisenhowerBody tab={tab} onResult={onResult} shown={shown} openTotal={openTotal} list={list} />
}

const NO_TASKS: PersistedTodoItem[] = []

function countOpen(todos: readonly PersistedTodoItem[]): number {
  let n = 0
  for (const t of todos) if (!t.isCompleted) n++
  return n
}

/** `N tasks are` / `1 task is`. */
function tasksAre(n: number, where = ''): string {
  return n === 1 ? `task${where} is` : `tasks${where} are`
}

/** The saved list an Eisenhower widget shows. */
interface ListSourceContext {
  /** The list as shown (its unsaved draft, else the saved list). */
  definition: PersistedListDefinition
  /** Its name, as the tab shows it. */
  title: string
  /** Open tasks in the app (what the list's own filter can hide). */
  appOpen: number
}

interface BodyProps extends WidgetProps {
  /** The tasks shown: the source's members passing the screen filter. */
  shown: PersistedTodoItem[]
  /** Open tasks of the source before the screen filter (all, or the list's). */
  openTotal: number
  /** Set when the widget shows a saved list. */
  list?: ListSourceContext
}

function EisenhowerBody({ tab, onResult, shown, openTotal, list }: BodyProps) {
  const isMobile = useIsMobile()
  // A quadrant divider's width while it is dragged: every quadrant follows it live.
  // (A store, not state: the drag re-renders the row lists, not the widget.)
  const [liveDetailsWidth] = useState(() => createValueStore<number | null>(null))
  const today = useToday()
  const range = useSettingsStore((s) => s.urgentDueWithinDays)
  const screen = useFilterStore((s) => s.filters)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const [sizeRef, size] = useElementSize()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const setRootRef = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el
    sizeRef(el)
  }, [sizeRef])

  const stacked = isMobile || (size.width > 0 && size.width < EISENHOWER_STACK_BREAKPOINT_PX)
  const collapsed = useMemo(() => new Set(tab.viewState?.collapsed ?? []), [tab.viewState?.collapsed])

  const quadrants = useMemo(() => buildQuadrants(shown, today, range), [shown, today, range])
  const openShown = useMemo(() => countOpen(shown), [shown])
  const countLabel = openShown < openTotal ? `${openShown} of ${openTotal}` : String(openShown)

  const onResultRef = useLatestRef(onResult)
  useEffect(() => {
    onResultRef.current?.({ countLabel })
  }, [countLabel, onResultRef])

  const drag = useQuadrantDrag(tab.id, today, range)
  const overResult = drag?.over ? drag.results[drag.over] : undefined
  const refused = drag?.over != null && overResult?.kind === 'blocked' ? { q: drag.over, blocked: overResult.blocked } : null
  const refusedQ = refused?.q ?? null
  const pointer = drag?.pointer ?? null

  // A refused target shows the not-allowed cursor wherever the pointer is.
  useEffect(() => {
    if (refusedQ == null) return
    const root = document.documentElement
    root.setAttribute('data-drop-refused', '')
    return () => root.removeAttribute('data-drop-refused')
  }, [refusedQ])

  // ── Selection: one widget at a time, rows addressed by occurrence ──
  const rows = useMemo<ScopedRow[]>(
    () => EISENHOWER_QUADRANTS.flatMap((q) =>
      stacked && collapsed.has(q) ? [] : quadrants[q].map((t) => ({ key: rowKey(q, t.id), todoId: t.id }))),
    [quadrants, stacked, collapsed],
  )
  const { inScope, selectedIds, cursorKey, onSelect } = useWidgetSelection(tab.id, () => rows)

  const toggle = (q: EisenhowerQuadrant, collapse: boolean) => {
    const next = EISENHOWER_QUADRANTS.filter((x) => (x === q ? collapse : collapsed.has(x)))
    void useWorkspaceStore.getState().patchTabViewState(tab.id, 'eisenhower', { collapsed: next })
  }

  const add = (q: EisenhowerQuadrant) => {
    // On a list: what the list's own Add task seeds; on all tasks: the screen filter's.
    const seed = list
      ? predicateToFilterDefaults(list.definition.membership.predicate)
      : getFilterDefaults(useFilterStore.getState().filters)
    const defaults = withUrgentImportant(seed, QUADRANT_FLAGS[q])
    useUIStore.getState().openQuickAdd({ defaults, source: list ? `${list.title} · ${QUADRANT_NAME[q]}` : QUADRANT_NAME[q] })
  }

  // What hides every task, if anything: the list's own filter (no open task
  // is in the list), else the screen filter.
  const listHidesAll = list != null && shown.length === 0 && openTotal === 0 && list.appOpen > 0
    && hasNarrowingFilters(list.definition.membership.predicate)
  const screenHidesAll = shown.length === 0 && openTotal > 0
  const filterCount = countActiveFilters(screen)
  const ctx: RowContext = {
    tabId: tab.id, isMobile, drag, inScope, selectedIds, cursorKey, onSelect, onOpen: openEditPopup,
    detailsWidth: tab.viewState?.detailsWidth,
    onDetailsWidthChange: (detailsWidth) => void useWorkspaceStore.getState().patchTabViewState(tab.id, 'eisenhower', { detailsWidth }),
    liveDetailsWidth,
  }
  const showBulkBar = !isMobile && inScope && selectedIds.size >= 2

  return (
    <div
      className={styles.frame}
      data-list-host={list ? tab.id : undefined}
      // Phones: the list's filter chips (a shared stylesheet) get their touch height.
      data-touch-chips={list && isMobile ? '' : undefined}
    >
      {list && <ListFilterRow tabId={tab.id} definition={list.definition} summary={false} />}
      <div
        ref={setRootRef}
        className={`${styles.widget} ${stacked ? styles.stacked : styles.grid} ${isMobile ? styles.touch : ''}`}
        data-eisenhower={tab.id}
        data-layout={stacked ? 'stacked' : 'grid'}
        data-dragging={drag ? 'true' : undefined}
        data-selection-scope={isMobile ? undefined : tab.id}
      >
        {EISENHOWER_QUADRANTS.map((q) => (
          <Quadrant
            key={q}
            q={q}
            tasks={quadrants[q]}
            openCount={quadrants[q].filter((t) => !t.isCompleted).length}
            stacked={stacked}
            collapsed={collapsed.has(q)}
            hideEmptyLines={listHidesAll || screenHidesAll}
            ctx={ctx}
            onToggle={(c) => toggle(q, c)}
            onAdd={() => add(q)}
          />
        ))}
        {listHidesAll && !drag && (
          <div className={styles.notePanel} role="status">
            <span className={styles.noteTitle}>No tasks match</span>
            <span className={styles.noteHint}>
              All {list.appOpen} open {tasksAre(list.appOpen)} hidden by the filters of “{list.title}”.
            </span>
            <button type="button" className={styles.noteAction} onClick={() => openEditList(tab.id, list.definition.id)}>
              Edit list
            </button>
          </div>
        )}
        {screenHidesAll && !drag && (
          <div className={styles.notePanel} role="status">
            <span className={styles.noteTitle}>No tasks match</span>
            <span className={styles.noteHint}>
              All {openTotal} open {tasksAre(openTotal, list ? ` in “${list.title}”` : '')} hidden by the screen filter.
            </span>
            <button type="button" className={styles.noteAction} onClick={() => useFilterStore.getState().clearAll()}>
              {filterCount === 1 ? 'Clear screen filter' : 'Clear screen filters'}
            </button>
          </div>
        )}
        {refused && pointer && drag && (
          <RefusalTooltip
            lines={blockedDropLines(refused.q, refused.blocked, drag.tasks.length, today, range)}
            pointer={pointer}
            boundsRef={rootRef}
          />
        )}
        {showBulkBar && <ListBulkBar ids={[...selectedIds]} bottom={12} />}
      </div>
    </div>
  )
}
