import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDndMonitor, useDroppable, type DragStartEvent } from '@dnd-kit/core'
import type { PersistedTodoItem } from '../../../models'
import {
  EISENHOWER_QUADRANTS,
  type EisenhowerQuadrant,
  type EisenhowerTab,
} from '../../../models/workspace-layout'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { usePaneContext } from '../../../hooks/use-pane-context'
import { useEqualValue } from '../../../hooks/use-equal-value'
import { useTooltip } from '../../shared/use-tooltip'
import { useFilterStore } from '../../../stores/filter-store'
import { countActiveFilters } from '../../../utils/filter-criteria'
import type { FilterChipNames } from '../../../utils/filter-chips'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import {
  blockedPaneLines,
  classifyPanes,
  dropPreviewLabel,
  insertionIndex,
  paneAddHint,
  resolvePaneDrops,
  type PaneContext,
  type PaneDropResult,
} from '../../../utils/eisenhower'
import {
  paneSubtitle,
  paneWrites,
  resolvePanes,
  samePaneFilters,
  withPaneConfig,
  withPaneSeed,
  type EisenhowerPane,
} from '../../../utils/eisenhower-panes'
import { getFilterDefaults, predicateToFilterDefaults } from '../../../utils/filter-defaults'
import { isHotFilter, markerCondition } from '../../../utils/markers'
import { noPaneTaskDialog } from '../../../services/task-dialog'
import { rowKey, type ScopedRow } from '../../../utils/scoped-selection'
import { eisenhowerQuadrantDropId, TASK_DROP_KIND } from '../../../utils/task-dnd'
import { createValueStore, type ValueStore } from '../../../utils/value-store'
import { MobileTaskRow } from '../../task/MobileTaskRow'
import { TaskRowGrid } from '../../task/TaskRowGrid'
import { FocusIcon, HotIcon, ImportantIcon, UrgentIcon } from '../../shared/MarkerIcons'
import { ChevronDownIcon, PlusIcon } from '../../shared/icons'
import { MenuPopover, type MenuEntry } from '../../shared/MenuPopover'
import { useChipNames } from '../../shared/filters/filter-menu'
import { useElementSize } from '../../../hooks/use-element-size'
import { ListBulkBar } from '../list/ListBulkBar'
import { ListWidgetRow, type ListRowDragLook, type ListRowSelectMods } from '../list/ListWidgetRow'
import { dragTasks } from './eisenhower-drag'
import { RefusalTooltip } from '../../shared/RefusalTooltip'
import { useDropRefusedCursor } from '../../../hooks/use-drop-refused-cursor'
import styles from './EisenhowerWidget.module.css'
import { useWidgetSelection } from '../../../hooks/use-widget-selection'
import { ListFilterRow } from '../list/ListFilterRow'
import { openEditList } from '../widget-hooks'
import { countOpen, useEisenhowerSource, type ListSourceContext } from '../../../hooks/use-eisenhower-source'
import { openEisenhowerSettings } from './eisenhower-settings-link'
import { SELECTION_SCOPE_ATTR } from '../../../utils/dom-contract'

/** Below this cell width the quadrants stack as collapsible sections. */
export const EISENHOWER_STACK_BREAKPOINT_PX = 560

/** What the widget reports to its cell: the tab count. */
export interface EisenhowerResult {
  /** Open tasks shown; `shown of total` when the screen filter (or the panes) hide some. */
  countLabel: string
}

/** The default panes' empty lines (their `QUADRANT_FLAGS` in words). */
const EMPTY_LINES: Record<EisenhowerQuadrant, [string, string]> = {
  do: ['Nothing urgent and important', 'Drop a task here to mark it urgent and important.'],
  schedule: ['Nothing to schedule', 'Drop a task here to mark it important.'],
  delegate: ['Nothing to delegate', 'Drop a task here to mark it urgent.'],
  drop: ['Nothing here', 'Tasks with neither flag land here.'],
}

/** A custom pane's empty lines. */
function emptyLines(pane: EisenhowerPane): [string, string] {
  return pane.customFilter ? [`Nothing in ${pane.name}`, 'Tasks that match this pane show here.'] : EMPTY_LINES[pane.id]
}

/** A task drag over the workspace, as this widget sees it. */
interface QuadrantDrag {
  /** The tasks the drag moves (the dragged task, or its selection). */
  tasks: PersistedTodoItem[]
  /** The dragged task. */
  primary: PersistedTodoItem
  /** What a drop on each pane would do. */
  results: Record<EisenhowerQuadrant, PaneDropResult<PersistedTodoItem>>
  /** The dragged row's key when it came from this widget. */
  sourceKey: string | null
  /** The pane of this widget under the pointer. */
  over: EisenhowerQuadrant | null
  /** The pointer (viewport), tracked while over a refusing pane. */
  pointer: { x: number; y: number } | null
}

/** Where the pointer is during a drag: where it went down + how far it moved. */
function dragPoint(event: { activatorEvent: Event | null; delta: { x: number; y: number } }): { x: number; y: number } | null {
  const e = event.activatorEvent as { clientX?: unknown; clientY?: unknown } | null
  if (!e || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return null
  return { x: e.clientX + event.delta.x, y: e.clientY + event.delta.y }
}

/**
 * Follows task drags (from this widget or any other) and works out, per
 * pane, what a drop would do — for the valid-target hairlines, the hover
 * preview and the refusal tooltip. The drop itself is applied by the page
 * (`dispatchTaskDrop`), with the same rules (`resolvePaneDrop`).
 */
function useQuadrantDrag(tabId: string, panes: readonly EisenhowerPane[], ctx: PaneContext): QuadrantDrag | null {
  const [drag, setDrag] = useState<QuadrantDrag | null>(null)
  const latest = useLatestRef({ panes, ctx })
  useDndMonitor({
    onDragStart(event: DragStartEvent) {
      const data = event.active.data.current
      if (!data || data.todo == null) return
      const tasks = dragTasks(data)
      const primary = tasks.find((t) => t.id === (data.todo as PersistedTodoItem).id) ?? tasks[0]
      if (!primary) return
      const { panes: p, ctx: c } = latest.current
      setDrag({
        tasks,
        primary,
        results: resolvePaneDrops(tasks, p, c),
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

/** The marker glyphs of a pane's header: the markers its filter wants (Yes), or the flame for Hot. */
function PaneGlyphs({ pane }: { pane: EisenhowerPane }) {
  const m = pane.filter.markers
  if (isHotFilter(m)) {
    return <span className={styles.glyphs} aria-hidden="true"><span className={styles.glyphHot}><HotIcon /></span></span>
  }
  const urgent = markerCondition(m, 'urgent') === true
  const important = markerCondition(m, 'important') === true
  const focus = markerCondition(m, 'focus') === true
  if (!urgent && !important && !focus) return null
  return (
    <span className={styles.glyphs} aria-hidden="true">
      {urgent && <span className={styles.glyphUrgent}><UrgentIcon /></span>}
      {important && <span className={styles.glyphImportant}><ImportantIcon /></span>}
      {focus && <span className={styles.glyphFocus}><FocusIcon /></span>}
    </span>
  )
}

function AddButton({ pane, hint, onAdd }: { pane: EisenhowerPane; hint: string; onAdd: () => void }) {
  const label = `Add task to ${pane.name}`
  const { triggerProps, tooltip } = useTooltip(`${label}\n${hint}`)
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
  /** The tab's task-row details width (one value for every pane). */
  detailsWidth: number | undefined
  onDetailsWidthChange: (width: number | undefined) => void
  /** The width while a pane's divider is dragged: every pane follows it live. */
  liveDetailsWidth: ValueStore<number | null>
}

interface QuadrantProps {
  pane: EisenhowerPane
  subtitle: string
  addHint: string
  tasks: PersistedTodoItem[]
  openCount: number
  stacked: boolean
  collapsed: boolean
  /** The screen filter hides every task: no per-pane empty lines. */
  hideEmptyLines: boolean
  ctx: RowContext
  names: FilterChipNames
  onToggle: (collapse: boolean) => void
  onAdd: () => void
  /** Opens the pane's header menu (right-click / Shift+F10); absent on phones. */
  onOpenMenu?: (at: { x: number; y: number }) => void
}

function Quadrant({ pane, subtitle, addHint: hint, tasks, openCount, stacked, collapsed, hideEmptyLines, ctx, names, onToggle, onAdd, onOpenMenu }: QuadrantProps) {
  const q = pane.id
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
  const preview = isOver && result?.kind === 'apply' ? dropPreviewLabel(result.changes, names) : ''
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
  const [emptyTitle, emptyHint] = emptyLines(pane)
  const headerContent = (
    <>
      {stacked && <span className={styles.chevron} aria-hidden="true"><ChevronDownIcon /></span>}
      <PaneGlyphs pane={pane} />
      <span className={styles.name}>{pane.name}</span>
      {pane.customFilter && <span className={styles.customDot} role="img" aria-label="custom filter" title="This pane’s filter differs from its default" data-testid="eisenhower-pane-custom" />}
      <span className={styles.subtitle} data-testid="eisenhower-pane-subtitle">{subtitle}</span>
    </>
  )

  return (
    <section
      ref={setNodeRef}
      className={styles.quadrant}
      data-eis-quadrant={q}
      data-drop-state={state}
      data-collapsed={stacked && collapsed ? 'true' : undefined}
      aria-label={`${pane.name}: ${subtitle}`}
    >
      <div
        className={styles.header}
        onContextMenu={onOpenMenu ? (e) => {
          e.preventDefault()
          onOpenMenu({ x: e.clientX, y: e.clientY })
        } : undefined}
        onKeyDown={onOpenMenu ? (e) => {
          if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            onOpenMenu({ x: r.left + 8, y: r.bottom + 4 })
          }
        } : undefined}
      >
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
          {!drag && <AddButton pane={pane} hint={hint} onAdd={onAdd} />}
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
 * The Eisenhower widget: four panes, as a 2×2 grid or — in narrow cells and
 * on phones — four collapsible sections. Its panes and its list are
 * app-wide, the same in every Eisenhower tab: it considers the tasks of the
 * Eisenhower's own list (`settings-store.eisenhowerListId`, a hidden list —
 * no filter = every task; its unsaved draft included, its prompt, group and
 * sort ignored, its filter line above the panes), the screen filter
 * narrowing them. Each task shows in the first
 * pane whose filter it matches (`settings-store.eisenhowerPanes`; by default
 * the quadrants of effective Urgent × Important, `utils/urgency`); tasks in
 * no pane are counted under the grid. Rows drag
 * between panes (and in from other widgets) to get what the pane's filter
 * implies; a drop that wouldn't land the task there is refused, with why.
 * Each pane's "+" opens Quick Add with the same writes (and the list's
 * defaults).
 */
export function EisenhowerWidget({ tab, onResult }: WidgetProps) {
  const source = useEisenhowerSource()
  return (
    <EisenhowerBody
      tab={tab}
      onResult={onResult}
      shown={source.shown}
      openTotal={source.openTotal}
      list={source.list}
    />
  )
}

/** Resets pane `q` (named `name`) to its defaults, from the panes as they are now (one undo step). */
function resetPane(q: EisenhowerQuadrant, name: string): void {
  const store = useSettingsStore.getState()
  void store.setEisenhowerPanes(withPaneConfig(store.eisenhowerPanes, q, null), `Reset pane “${name}”`)
}

/** `N tasks are` / `1 task is`. */
function tasksAre(n: number, where = ''): string {
  return n === 1 ? `task${where} is` : `tasks${where} are`
}

interface BodyProps extends WidgetProps {
  /** The tasks considered: the source's members passing the screen filter. */
  shown: PersistedTodoItem[]
  /** Open tasks of the list before the screen filter. */
  openTotal: number
  /** The Eisenhower's list (absent only until it is loaded). */
  list?: ListSourceContext
}

function EisenhowerBody({ tab, onResult, shown, openTotal, list }: BodyProps) {
  const isMobile = useIsMobile()
  // A pane divider's width while it is dragged: every pane follows it live.
  // (A store, not state: the drag re-renders the row lists, not the widget.)
  const [liveDetailsWidth] = useState(() => createValueStore<number | null>(null))
  const paneCtx = usePaneContext()
  const names = useChipNames()
  const screen = useFilterStore((s) => s.filters)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const [sizeRef, size] = useElementSize()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const setRootRef = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el
    sizeRef(el)
  }, [sizeRef])
  const [paneMenu, setPaneMenu] = useState<{ q: EisenhowerQuadrant; x: number; y: number } | null>(null)

  const stacked = isMobile || (size.width > 0 && size.width < EISENHOWER_STACK_BREAKPOINT_PX)
  const collapsed = useMemo(() => new Set(tab.viewState?.collapsed ?? []), [tab.viewState?.collapsed])

  const storedPanes = useSettingsStore((s) => s.eisenhowerPanes)
  const panes = useMemo(() => resolvePanes(storedPanes), [storedPanes])
  // Classified again only when a filter changes (not on a rename).
  const sortingPanes = useEqualValue(panes, samePaneFilters)
  const { byPane, none } = useMemo(() => classifyPanes(shown, sortingPanes, paneCtx), [shown, sortingPanes, paneCtx])
  const labels = useMemo(
    () => new Map(panes.map((p) => [p.id, { subtitle: paneSubtitle(p, names), addHint: paneAddHint(p, names) }])),
    [panes, names],
  )
  const noneOpen = useMemo(() => none.filter((t) => !t.isCompleted), [none])
  const openShown = useMemo(() => countOpen(shown) - noneOpen.length, [shown, noneOpen])
  const countLabel = openShown < openTotal ? `${openShown} of ${openTotal}` : String(openShown)

  const onResultRef = useLatestRef(onResult)
  useEffect(() => {
    onResultRef.current?.({ countLabel })
  }, [countLabel, onResultRef])

  const drag = useQuadrantDrag(tab.id, panes, paneCtx)
  const overResult = drag?.over ? drag.results[drag.over] : undefined
  const refusedPane = drag?.over != null && overResult?.kind === 'blocked' ? panes.find((p) => p.id === drag.over) : undefined
  const refused = refusedPane && overResult?.kind === 'blocked' ? { pane: refusedPane, blocked: overResult.blocked } : null
  const refusedQ = refused?.pane.id ?? null
  const pointer = drag?.pointer ?? null

  // A refused target shows the not-allowed cursor wherever the pointer is.
  useDropRefusedCursor(refusedQ != null)

  // ── Selection: one widget at a time, rows addressed by occurrence ──
  const rows = useMemo<ScopedRow[]>(
    () => EISENHOWER_QUADRANTS.flatMap((q) =>
      stacked && collapsed.has(q) ? [] : byPane[q].map((t) => ({ key: rowKey(q, t.id), todoId: t.id }))),
    [byPane, stacked, collapsed],
  )
  const { inScope, selectedIds, cursorKey, onSelect } = useWidgetSelection(tab.id, () => rows)

  const toggle = (q: EisenhowerQuadrant, collapse: boolean) => {
    const next = EISENHOWER_QUADRANTS.filter((x) => (x === q ? collapse : collapsed.has(x)))
    void useWorkspaceStore.getState().patchTabViewState(tab.id, 'eisenhower', { collapsed: next })
  }

  const add = (pane: EisenhowerPane) => {
    // A list that narrows: what the list's own Add task seeds; else (every
    // task) the screen filter's.
    const narrowing = list?.narrows ? list : undefined
    const seed = narrowing
      ? predicateToFilterDefaults(narrowing.definition.membership.predicate)
      : getFilterDefaults(useFilterStore.getState().filters)
    const defaults = withPaneSeed(seed, paneWrites(pane.filter, names))
    useUIStore.getState().openQuickAdd({ defaults, source: narrowing ? `${pane.name} · ${narrowing.title}` : pane.name })
  }

  // What hides every task, if anything: the list's own filter (no open task
  // is in the list), else the screen filter.
  const listHidesAll = list != null && shown.length === 0 && openTotal === 0 && list.appOpen > 0 && list.narrows
  const screenHidesAll = shown.length === 0 && openTotal > 0
  const filterCount = countActiveFilters(screen)
  const ctx: RowContext = {
    tabId: tab.id, isMobile, drag, inScope, selectedIds, cursorKey, onSelect, onOpen: openEditPopup,
    detailsWidth: tab.viewState?.detailsWidth,
    onDetailsWidthChange: (detailsWidth) => void useWorkspaceStore.getState().patchTabViewState(tab.id, 'eisenhower', { detailsWidth }),
    liveDetailsWidth,
  }
  const showBulkBar = !isMobile && inScope && selectedIds.size >= 2

  const menuPane = paneMenu ? panes.find((p) => p.id === paneMenu.q) : undefined
  // Phones: no pane menu (the panes are edited in Settings on a wider screen).
  const paneMenuEntries: MenuEntry[] = menuPane && !isMobile ? [
    { kind: 'item', label: 'Edit pane…', onSelect: () => openEisenhowerSettings(menuPane.id) },
    ...(menuPane.customName || menuPane.customFilter ? [{
      kind: 'item' as const,
      label: 'Reset pane',
      onSelect: () => resetPane(menuPane.id, menuPane.name),
    }] : []),
  ] : []

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
        {...{ [SELECTION_SCOPE_ATTR]: isMobile ? undefined : tab.id }}
      >
        {panes.map((pane) => (
          <Quadrant
            key={pane.id}
            pane={pane}
            subtitle={labels.get(pane.id)?.subtitle ?? ''}
            addHint={labels.get(pane.id)?.addHint ?? ''}
            tasks={byPane[pane.id]}
            openCount={byPane[pane.id].filter((t) => !t.isCompleted).length}
            stacked={stacked}
            collapsed={collapsed.has(pane.id)}
            hideEmptyLines={listHidesAll || screenHidesAll}
            ctx={ctx}
            names={names}
            onToggle={(c) => toggle(pane.id, c)}
            onAdd={() => add(pane)}
            onOpenMenu={!isMobile ? (at) => setPaneMenu({ q: pane.id, ...at }) : undefined}
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
              All {openTotal} open {tasksAre(openTotal, list?.narrows ? ` in “${list.title}”` : '')} hidden by the screen filter.
            </span>
            <button type="button" className={styles.noteAction} onClick={() => useFilterStore.getState().clearAll()}>
              {filterCount === 1 ? 'Clear screen filter' : 'Clear screen filters'}
            </button>
          </div>
        )}
        {refused && pointer && drag && (
          <RefusalTooltip
            lines={blockedPaneLines(refused.pane, refused.blocked, drag.tasks.length, panes, paneCtx, names)}
            pointer={pointer}
            boundsRef={rootRef}
            testId="eisenhower-refusal"
          />
        )}
        {showBulkBar && <ListBulkBar ids={[...selectedIds]} bottom={12} />}
      </div>
      {noneOpen.length > 0 && (
        <button
          type="button"
          className={styles.noPane}
          data-testid="eisenhower-no-pane"
          onClick={() => useUIStore.getState().showTaskDialog(noPaneTaskDialog(noneOpen.map((t) => t.id)))}
        >
          {noneOpen.length} open {noneOpen.length === 1 ? 'task' : 'tasks'} in no pane
        </button>
      )}
      {paneMenu && paneMenuEntries.length > 0 && (
        <MenuPopover
          point={{ x: paneMenu.x, y: paneMenu.y }}
          label={`${menuPane?.name ?? 'Pane'} pane`}
          entries={paneMenuEntries}
          restoreFocus
          onClose={() => setPaneMenu(null)}
        />
      )}
    </div>
  )
}
