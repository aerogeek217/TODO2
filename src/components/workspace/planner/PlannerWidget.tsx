import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { PersistedTodoItem } from '../../../models'
import { kindTabTitle, type ListZoom, type PlannerTab } from '../../../models/workspace-layout'
import { useDropRefusedCursor } from '../../../hooks/use-drop-refused-cursor'
import { useElementSize } from '../../../hooks/use-element-size'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { usePlanner, useTasksDoneToday, type PlannerData } from '../../../hooks/use-planner'
import { useRowFieldsUsed } from '../../../hooks/use-row-fields-used'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { movePlannerTask, snoozePlannerTask, unplanDelayedTasks, unplanPlannerTask } from '../../../services/planner-drop'
import { appliedScreenFilter, useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { usePlannerStore, type PlannerDragPreview } from '../../../stores/planner-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUIStore } from '../../../stores/ui-store'
import { LIST_SECTION_ATTR } from '../../../utils/dom-contract'
import { getFilterDefaults } from '../../../utils/filter-defaults'
import { autoListZoom, UNMEASURED_LIST_ZOOM } from '../../../utils/list-zoom'
import { scrollBehavior } from '../../../utils/motion'
import {
  plannerDayLabel,
  plannerDropWrite,
  plannerRangeLabel,
  plannerRowTag,
  type PlannerGroup,
  type PlannerTarget,
} from '../../../utils/planner'
import { rowKey } from '../../../utils/scoped-selection'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { plannerDropId, TASK_DROP_KIND, type PlannerDropData } from '../../../utils/task-dnd'
import { plannerFaceFor, plannerStripFits } from '../../../utils/widget-face'
import { BadgeCapsule } from '../../shared/BadgeCapsule'
import { ArrowDownIcon, CheckIcon, PlusIcon, ResetIcon } from '../../shared/icons'
import { MenuPopover } from '../../shared/MenuPopover'
import { MobileTaskRow } from '../../task/MobileTaskRow'
import { TaskMenuExtrasContext } from '../../task/task-menu-extras'
import { TaskRowExtrasContext } from '../../task/task-row-extras'
import { TaskRowGrid } from '../../task/TaskRowGrid'
import { DropSlot, ListWidgetRow, type ListRowDragLook } from '../list/ListWidgetRow'
import listStyles from '../list/ListWidget.module.css'
import { WidgetNameLine } from '../WidgetTopLine'
import { PLANNER_HEADING_ATTR } from './planner-focus'
import { plannerMenuEntries } from './planner-menu'
import { RESET_PLAN_LABEL, usePlannerResetEntries } from './planner-reset'
import { plannerRowExtras } from './planner-row-extras'
import { PlannerRowTag } from './PlannerRowExtras'
import { PlannerStrip, type PlannerDropMark } from './PlannerStrip'
import { usePlannerDrag, type PlannerActiveDrag } from './use-planner-drag'
import styles from './PlannerWidget.module.css'

type Task = PersistedTodoItem
type Group = PlannerGroup<Task>

/** A group's name: `Today`, a day in words, `Delayed`, `Unplanned`. */
function groupLabel(group: Group): string {
  if (group.kind === 'today') return 'Today'
  if (group.kind === 'delayed') return 'Delayed'
  return group.day ? plannerDayLabel(group.day) : 'Unplanned'
}

/** The drop target a group stands for: its day (Today's: today), or its tray. */
function groupTarget(group: Group): PlannerTarget {
  if (group.day) return { kind: 'day', day: group.day }
  return group.kind === 'delayed' ? { kind: 'delayed' } : { kind: 'unplanned' }
}

/** The scrollers a Planner's groups sit in: the large face's two panes, else its one column. */
const SCROLLERS = '[data-planner-pane], [data-planner-layout="column"]'

/**
 * Scrolls the day list to the day `key` (a tile's click): its scroller —
 * the left pane, or the one column — brings the day's heading to its top,
 * smoothly (at once under reduced motion). A day with no group (the phone
 * leaves the empty days out) stands for the next day that has one. Where
 * the scroller has nothing to scroll, the phone's page scrolls instead
 * (`page`: its cell is as tall as its content); on desktop the day is in
 * view already.
 */
function scrollToDay(host: HTMLElement | null, key: string, page: boolean): void {
  // Today's group and the days' carry their `dayKey` (`YYYY-MM-DD`: in date order as text).
  const days = Array.from(host?.querySelectorAll<HTMLElement>('[data-planner-group-kind="today"], [data-planner-group-kind="day"]') ?? [])
  const group = days.find((el) => (el.getAttribute('data-planner-group') ?? '') >= key)
  if (!group) return
  const scroller = group.closest<HTMLElement>(SCROLLERS)
  const behavior = scrollBehavior()
  if (scroller && scroller.scrollHeight > scroller.clientHeight) {
    // Today, the list's first group: the very top.
    const first = group.getAttribute('data-planner-group-kind') === 'today'
    const top = first ? 0 : group.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior })
    else scroller.scrollTop = top
  } else if (page && typeof group.scrollIntoView === 'function') {
    group.scrollIntoView({ block: 'start', behavior })
  }
}

/**
 * The Planner (widget kind `planner`, no settings): a scratch pad for
 * today and the week ahead. Its top line (alone in its cell): the name,
 * the window's range and **Reset plan** (`PlannerResetButton`; in a cell of
 * tabs the same three choices are under Reset plan › in the widget's ⋯).
 * Large — the strip of seven day tiles (`PlannerStrip`), then two panes:
 * on the left **one scrolling list of days** — Today (its rows, an `N
 * done` line, Add task), then every later day of the window in order, a
 * day with nothing on it a quiet heading —, and on the right, on a darker
 * ground, the trays: **Delayed** (planned for a day that has passed; shown
 * while it holds a task), the **↓ Unplan** button on a rule (every Delayed
 * task to Unplanned; with Delayed) and **Unplanned** (held there, and the
 * Focus tasks with no plan and no date; always there). Medium (a narrow or
 * short cell, and the phone): the strip over one column in that order, in
 * one scroll — the phone, which has no drag, without the empty days and
 * without an empty Unplanned. Small: its name and today's count. A task sits on its
 * planned day, else the day its follow-up or due date puts it
 * (`utils/planner`); rows are the list's (`ListWidgetRow`, `MobileTaskRow`
 * on the phone), a click opening the task. A tile's click scrolls the day
 * list to its day. The window is the tab's in its layout, in memory
 * (`stores/planner-store`).
 *
 * **Rows** carry four Planner-only things (`PlannerRowExtras`, through
 * `TaskRowExtrasContext`; the flag is the Planner's own, around the row): a
 * **corner flag** on every placed row (a planned day, or held in
 * Unplanned); a **tag** after the title — a Delayed row's planned day, a
 * held row's natural day, or `1 day after due` on a row planned past a
 * real date, a button opening its fixes —; that passed date **drawn late**;
 * and **Snooze** / **Unplan** buttons on hover and focus (desktop).
 *
 * **Drops** (desktop): every tile and every group takes a dragged task — a
 * row of this Planner, a list's row, a calendar entry — as a dnd-kit
 * droppable (`TASK_DROP_KIND.plannerDay` / `.plannerGroup`); the page's one
 * dispatcher makes the drop (`services/planner-drop`: the task planned for
 * the day, its plan cleared on its own date's day, held in Unplanned, or
 * refused — Delayed takes no drop — and never a due date or a follow-up),
 * and a drop into a group also stores the row's place in the hand order
 * (the tab's `order`). While a task is dragged over it (`usePlannerDrag`)
 * the target's tile and group are dashed in one neutral color, a blank slot
 * shows where the row would land, and the lifted row carries the label
 * (`PlannerDragLabel`). Without a pointer: **Move to day ›**, **Snooze**
 * and **Unplan** in a row's task menu (`planner-menu`).
 */
export function PlannerWidget({ tab }: { tab: PlannerTab }) {
  const [faceRef, face] = useWidgetFace(plannerFaceFor)
  const [sizeRef, size] = useElementSize()
  const hostRef = useRef<HTMLElement | null>(null)
  const setHost = useCallback((el: HTMLElement | null) => {
    hostRef.current = el
    faceRef(el)
    sizeRef(el)
  }, [faceRef, sizeRef])
  return (
    <div ref={setHost} className={styles.host} data-planner={tab.id} data-planner-face={face}>
      {face === 'small'
        ? <SmallFace tab={tab} />
        : <PlannerBody tab={tab} panes={face === 'large'} tiles={plannerStripFits(size.width)} hostRef={hostRef} />}
    </div>
  )
}

function SmallFace({ tab }: { tab: PlannerTab }) {
  const { view } = usePlanner(tab.id, tab.viewState?.order, false)
  const title = kindTabTitle(tab)
  const count = view.today.tasks.length
  return (
    <div className={styles.smallFace} role="group" aria-label={`${title}: ${count} today`}>
      <span className={styles.smallTitle}>{title}</span>
      <span className={styles.smallFigures}>
        <span className={styles.smallCaption}>Today</span>
        <span className={styles.smallCount} data-testid="planner-face-count">{count}</span>
      </span>
    </div>
  )
}

/** A task drag as the Planner's groups see it. */
interface GroupDrag {
  /** The task dragged anywhere in the workspace; null with none. */
  active: PlannerActiveDrag | null
  /** What a drop on this Planner would do, while the drag is over it. */
  preview: PlannerDragPreview | null
  /** The target's mark, when the drop changes the plan. */
  mark: PlannerDropMark | null
  /** Every task the Planner shows, in display order: their `uid`s. */
  shown: readonly string[]
}

function PlannerBody({ tab, panes, tiles, hostRef }: {
  tab: PlannerTab
  /** Two panes (the large face); else one column. */
  panes: boolean
  /** The strip has room for its tiles. */
  tiles: boolean
  /** The widget's element: its scrollers are measured when a task drag starts, and scrolled by a tile's click. */
  hostRef: RefObject<HTMLElement | null>
}) {
  const isMobile = useIsMobile()
  // The phone has no fold: a completed row leaves at once, as a list's.
  const data = usePlanner(tab.id, tab.viewState?.order, !isMobile)
  const { view, offset, badge, windowKey, keptTodos } = data
  const twoPanes = panes && !isMobile
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  // The phone has no drag, so a day with nothing on it has nothing to offer there.
  const days = useMemo(() => (isMobile ? view.days.filter((g) => g.tasks.length > 0) : view.days), [isMobile, view.days])
  // Delayed takes no drop: it shows only while it holds a task, and the Unplan button with it. Unplanned is a target, so it is always there where rows drag.
  const showDelayed = view.delayed.tasks.length > 0
  const showUnplanned = !isMobile || view.unplanned.tasks.length > 0
  const range = plannerRangeLabel(view.window)
  const tabId = tab.id
  // Each pane's rows share their columns: the days line up, and the trays.
  const dayTasks = useMemo(() => [...view.today.tasks, ...view.days.flatMap((g) => g.tasks)], [view.today, view.days])
  const trayTasks = useMemo(() => [...view.delayed.tasks, ...view.unplanned.tasks], [view.delayed, view.unplanned])
  const allTasks = useMemo(() => [...dayTasks, ...trayTasks], [dayTasks, trayTasks])

  const onGo = useCallback((key: string) => scrollToDay(hostRef.current, key, isMobile), [hostRef, isMobile])
  const onShift = useCallback((weeks: -1 | 1) => usePlannerStore.getState().shift(windowKey, weeks), [windowKey])

  // ── A task dragged over it: the target marked, the place shown; a refused drop, the not-allowed cursor ──
  const active = usePlannerDrag(tabId, hostRef)
  const preview = usePlannerStore((s) => (s.drag?.tabId === tabId ? s.drag : null))
  useDropRefusedCursor(preview?.drop.kind === 'refuse')
  const shown = useMemo(() => view.tasks.map((t) => t.uid), [view.tasks])
  const drag = useMemo<GroupDrag>(() => {
    const writes = preview != null && plannerDropWrite(preview.drop) !== undefined
    return { active, preview, mark: preview && writes ? { key: preview.key } : null, shown }
  }, [active, preview, shown])

  // ── Move to day ›, Snooze and Unplan, in each row's task menu ──
  const plannerWindow = view.window
  const menuExtras = useCallback((todo: Task) => plannerMenuEntries(todo, plannerWindow, {
    move: (target) => { void movePlannerTask(tabId, { todoId: todo.id, target, window: plannerWindow }) },
    snooze: () => { void snoozePlannerTask(tabId, todo.id, plannerWindow) },
    unplan: () => { void unplanPlannerTask(tabId, todo.id, plannerWindow) },
  }), [tabId, plannerWindow])

  // ── Each row's tag, hover buttons and late dates ──
  const { placements } = view
  const rowExtras = useCallback(
    (todo: Task) => plannerRowExtras(todo, placements.get(todo.uid), tabId, plannerWindow),
    [placements, tabId, plannerWindow],
  )

  // Unplan all Delayed: the Delayed rows as they are — a row lingering after its completion left out.
  const unplanAll = useCallback(() => {
    const tasks = view.delayed.tasks.filter((t) => !keptTodos?.has(t.id))
    void unplanDelayedTasks({ window: view.window, delayed: { ...view.delayed, tasks } })
  }, [view.window, view.delayed, keptTodos])

  const today = <TodayGroup tabId={tabId} group={view.today} data={data} mobile={isMobile} drag={drag} />
  const ahead = days.map((g) => <DayGroup key={g.key} tabId={tabId} group={g} data={data} mobile={isMobile} drag={drag} />)
  const trays = (
    <>
      {showDelayed && <DayGroup tabId={tabId} group={view.delayed} data={data} mobile={isMobile} drag={drag} />}
      {showDelayed && <UnplanAll onUnplan={unplanAll} />}
      {showUnplanned && (
        <DayGroup
          tabId={tabId}
          group={view.unplanned}
          data={data}
          mobile={isMobile}
          drag={drag}
          empty={<p className={styles.emptyLine} role="status">Nothing unplanned</p>}
        />
      )}
    </>
  )

  return (
    <TaskMenuExtrasContext.Provider value={menuExtras}>
      <TaskRowExtrasContext.Provider value={rowExtras}>
        <WidgetNameLine name="Planner">
          {offset > 0 ? (
            <button
              type="button"
              className={styles.rangeButton}
              aria-label={`${range}. Back to this week`}
              data-tooltip="Back to this week"
              onClick={() => usePlannerStore.getState().reset(windowKey)}
            >
              {range}
            </button>
          ) : <span className={styles.range} data-testid="planner-range">{range}</span>}
          {badge.counts.due + badge.counts.followup > 0 && (
            <BadgeCapsule counts={badge.counts} label={badge.summary.join('; ')} data-testid="planner-badge" />
          )}
          <span className={styles.topLineGap} aria-hidden="true" />
          <PlannerResetButton tab={tab} />
        </WidgetNameLine>
        <PlannerStrip
          tabId={tabId}
          window={view.window}
          tiles={view.tiles}
          offset={offset}
          showTiles={tiles}
          weekStartsOn={weekStartsOn}
          onGo={onGo}
          onShift={onShift}
          mark={drag.mark}
        />
        {twoPanes ? (
          <div className={styles.panes} data-planner-layout="panes">
            <div ref={trackScrollEdges} className={`${styles.pane} ${styles.daysPane}`} data-planner-pane="days">
              <Rows tasks={dayTasks} data={data} mobile={false}>
                {today}
                {ahead}
              </Rows>
            </div>
            <div ref={trackScrollEdges} className={`${styles.pane} ${styles.traysPane}`} data-planner-pane="trays">
              <Rows tasks={trayTasks} data={data} mobile={false}>{trays}</Rows>
            </div>
          </div>
        ) : (
          <div ref={trackScrollEdges} className={`${styles.pane} ${styles.column}`} data-planner-layout="column" data-touch={isMobile ? '' : undefined}>
            <Rows tasks={allTasks} data={data} mobile={isMobile}>
              {today}
              {ahead}
              {trays}
            </Rows>
          </div>
        )}
      </TaskRowExtrasContext.Provider>
    </TaskMenuExtrasContext.Provider>
  )
}

/**
 * **Reset plan** in the Planner's top line: an icon and the words (the
 * words give way in a narrow widget), opening its menu — This week · Today
 * only · Delayed, each with its count, inert at 0
 * (`usePlannerResetEntries`).
 */
function PlannerResetButton({ tab }: { tab: PlannerTab }) {
  const entries = usePlannerResetEntries(tab)
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={styles.resetButton}
        aria-label={RESET_PLAN_LABEL}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open ? '' : undefined}
        data-tooltip="Clear plans: this week, today or Delayed"
        data-testid="planner-reset"
        onClick={() => setOpen((v) => !v)}
      >
        <ResetIcon size={13} />
        <span className={styles.resetWords}>{RESET_PLAN_LABEL}</span>
      </button>
      {open && <MenuPopover anchorRef={ref} entries={entries} label={RESET_PLAN_LABEL} width={200} placement="bottom-end" onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * The **↓ Unplan** button, centered on a hairline rule between Delayed and
 * Unplanned (only while Delayed holds a task): every Delayed task to
 * Unplanned, one undo step (`services/planner-drop.unplanDelayedTasks`).
 */
function UnplanAll({ onUnplan }: { onUnplan: () => void }) {
  return (
    <div className={styles.unplanAll} data-planner-unplan-all="">
      <span className={styles.unplanRule} aria-hidden="true" />
      <button
        type="button"
        className={styles.unplanButton}
        aria-label="Move all Delayed tasks to Unplanned"
        data-tooltip="Move all Delayed tasks to Unplanned"
        onClick={onUnplan}
      >
        <ArrowDownIcon size={14} />
        Unplan
      </button>
      <span className={styles.unplanRule} aria-hidden="true" />
    </div>
  )
}

/**
 * One list of rows sharing their columns (`TaskRowGrid`; the columns the
 * rows of `tasks` use — a lingering row as it shows): a pane's groups, or
 * one of two lists that line up. The phone's rows lay themselves out.
 */
function Rows({ tasks, data, mobile, children }: { tasks: readonly Task[]; data: PlannerData; mobile: boolean; children: ReactNode }) {
  const { keptTodos } = data
  const shown = useMemo(() => tasks.map((t) => keptTodos?.get(t.id) ?? t), [tasks, keptTodos])
  const used = useRowFieldsUsed(shown)
  const [hostRef, zoom] = useRowsZoom()
  if (mobile) return <div className={styles.rows}>{children}</div>
  return (
    <div ref={hostRef} className={styles.rowsHost} data-zoom={zoom}>
      <RowsZoomContext.Provider value={zoom}>
        <TaskRowGrid className={styles.rows} zoom={zoom} used={used}>{children}</TaskRowGrid>
      </RowsZoomContext.Provider>
    </div>
  )
}

/** The zoom of the rows inside (`Rows`). */
const RowsZoomContext = createContext<ListZoom>(UNMEASURED_LIST_ZOOM)

/**
 * The zoom a list of the Planner's rows shows — a list tab's without a zoom
 * of its own: Settings › Appearance › Default list zoom, Auto by the list's
 * measured width (Stacked in a narrow pane, Rows in a wide one, with the
 * list's hysteresis — `utils/list-zoom.autoListZoom`). Returns the ref of
 * the element measured.
 */
function useRowsZoom(): [(el: HTMLElement | null) => void, ListZoom] {
  const setting = useSettingsStore((s) => s.listZoom)
  const [ref, size] = useElementSize()
  // The level Auto settled on at the last measured width (none before the first).
  const [auto, setAuto] = useState<ListZoom | undefined>(undefined)
  const next = size.width > 0 ? autoListZoom(size.width, auto) : undefined
  if (next !== auto) setAuto(next)
  return [ref, setting === 'auto' ? next ?? UNMEASURED_LIST_ZOOM : setting]
}

/**
 * How a row looks while a task is dragged — the list's manual-order looks:
 * one of this Planner's rows dragged in its own group (or over no target)
 * shows as its slot until the pointer picks another spot (then it is gone
 * and the slot shows there), the other rows dimmed while they make room;
 * headed for another day it stays where it is, faded.
 */
function plannerRowLook(drag: GroupDrag, key: string): ListRowDragLook {
  const row = drag.active?.row
  if (!row) return 'idle'
  const { preview } = drag
  const reordering = !preview || (preview.over === 'group' && preview.key === row.groupKey)
  if (key !== row.key) return reordering ? 'dim' : 'idle'
  if (!reordering) return 'origin'
  return preview?.index != null && preview.index !== row.index ? 'gone' : 'slot'
}

interface GroupProps {
  tabId: string
  group: Group
  data: PlannerData
  mobile: boolean
  drag: GroupDrag
  /** After the rows, inside the group (Today's done line and Add task). */
  children?: ReactNode
  /** In place of the rows of a group with none. */
  empty?: ReactNode
}

/**
 * A group: its header in the list's group-header look (name, count, a rule
 * to the line's end) and its tasks as the list's rows — draggable
 * occurrences (`ListWidgetRow`: the tab's scope, the group's key as their
 * section), a click opening the task; `MobileTaskRow` on the phone. A row
 * completed here lingers, then folds (`PlannerData.leaving`). A day with
 * nothing on it is a quiet heading — its name muted, no count
 * (`data-planner-empty`) — and still takes a drop. A placed row (a planned
 * day, or held in Unplanned) carries the **corner flag** at its top-left
 * (`PlannerRowWrap`).
 *
 * The whole group is a drop target (a droppable, not on the phone): its
 * day — Today's is today —, or its tray (Delayed refuses every drop but a
 * reorder of its own rows); its drop data carries its rows and every row
 * shown, for the hand order. While a task is dragged over it a blank slot
 * (the list's `DropSlot`) shows where the row would land, and the group is
 * dashed while the drop changes the plan (`data-planner-drop`).
 */
function DayGroup({ tabId, group, data, mobile, drag, children, empty }: GroupProps) {
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const onSelect = useCallback((_rowKey: string, todoId: number) => openEditPopup(todoId), [openEditPopup])
  const { keptTodos, leaving } = data
  const zoom = useContext(RowsZoomContext)
  const label = groupLabel(group)
  const count = group.tasks.length
  const { placements } = data.view
  // A day ahead with nothing on it: a quiet heading (Today and the trays keep theirs).
  const quiet = group.kind === 'day' && count === 0

  const { today, last } = data.view.window
  const span = useMemo(() => ({ today, last }), [today, last])
  const rows = useMemo(() => group.tasks.map((t) => t.uid), [group.tasks])
  const dropData: PlannerDropData = {
    type: TASK_DROP_KIND.plannerGroup,
    scope: tabId,
    target: groupTarget(group),
    window: { today, last },
    group: { key: group.key, rows, shown: drag.shown },
  }
  const { setNodeRef } = useDroppable({ id: plannerDropId(tabId, 'group', group.key), disabled: mobile, data: { ...dropData } })

  // Where the dragged row would land here: before row `slotAt` of the rows without it.
  const { active, preview } = drag
  const here = preview?.over === 'group' && preview.key === group.key ? preview : null
  const ownIndex = active?.row?.groupKey === group.key ? active.row.index : null
  const slotAt = here?.index != null && here.index !== ownIndex ? here.index : null
  const draggedKey = active ? rowKey(group.key, active.todo.id) : null
  let placed = 0

  return (
    <div
      ref={setNodeRef}
      className={styles.group}
      role="group"
      aria-label={label}
      data-planner-group={group.key}
      data-planner-group-kind={group.kind}
      data-planner-empty={quiet ? '' : undefined}
      data-planner-drop={drag.mark?.key === group.key ? '' : undefined}
      // A grouped body's rows draw no hairline (TaskRow / MobileTaskRow styles).
      data-row-group=""
      {...{ [LIST_SECTION_ATTR]: group.key }}
    >
      {/* Focusable from code only: where the focus goes when a row moved from the keyboard leaves no row behind (`planner-focus`). */}
      <div className={styles.groupHeader} tabIndex={-1} {...{ [PLANNER_HEADING_ATTR]: '' }}>
        <span className={`${listStyles.groupName} ${quiet ? styles.quietName : ''}`} data-testid="planner-group-name">{label}</span>
        {count > 0 && <span className={listStyles.groupCount} data-testid="planner-group-count">{count}</span>}
        <span className={listStyles.groupRule} aria-hidden="true" />
      </div>
      <div className={styles.groupBody} data-planner-group-body={group.key}>
        {count === 0 && slotAt == null && empty}
        {group.tasks.flatMap((built) => {
          const todo = keptTodos?.get(built.id) ?? built
          const key = rowKey(group.key, todo.id)
          const people = assignedPeopleMap.get(todo.id)
          // A row lingering after its completion carries no Planner marks.
          const placement = todo.isCompleted ? undefined : placements.get(built.uid)
          const flagged = placement?.placed === true
          if (mobile) {
            const tag = plannerRowTag(placement)
            return [
              <PlannerRowWrap key={key} todoId={todo.id} flagged={flagged}>
                <MobileTaskRow todo={todo} assignedPeople={people} onOpenDetail={openEditPopup} />
                {tag && (
                  <div className={styles.mobileTag}>
                    <PlannerRowTag tabId={tabId} todoId={todo.id} tag={tag} window={span} />
                  </div>
                )}
              </PlannerRowWrap>,
            ]
          }
          // The slot's place counts the rows without the dragged one.
          const slot = key !== draggedKey && slotAt === placed ? <DropSlot key="drop-slot" /> : null
          if (key !== draggedKey) placed++
          const look = plannerRowLook(drag, key)
          return [
            slot,
            // Collapsed while its slot shows elsewhere: no flag left floating.
            <PlannerRowWrap key={key} todoId={todo.id} flagged={flagged && look !== 'gone'}>
              <ListWidgetRow
                todo={todo}
                assignedPeople={people}
                tabId={tabId}
                sectionKey={group.key}
                rowKey={key}
                selected={false}
                selFirst
                selLast
                cursor={false}
                look={look}
                leaving={keptTodos?.has(todo.id) ? leaving.get(todo.id)?.phase : undefined}
                zoom={zoom}
                onSelect={onSelect}
                onOpenDetail={openEditPopup}
              />
            </PlannerRowWrap>,
          ]
        })}
        {slotAt != null && slotAt >= placed && <DropSlot key="drop-slot" />}
        {children}
      </div>
    </div>
  )
}

/**
 * A Planner row with its **corner flag**: the row (the list's, untouched)
 * in a box of its own, and — on a placed row (`flagged`) — a small filled
 * triangle at the box's top-left corner, over the row, in the secondary
 * text color. It takes no pointer events and is drawn whatever the row
 * shows: its hover fill, the slot it leaves while it is lifted, the Stacked
 * and Lines styles, the phone row.
 */
function PlannerRowWrap({ todoId, flagged, children }: { todoId: number; flagged: boolean; children: ReactNode }) {
  return (
    <div className={styles.rowWrap} data-planner-row={todoId} data-planner-placed={flagged ? '' : undefined}>
      {children}
      {flagged && <span className={styles.flag} aria-hidden="true" data-planner-flag="" />}
    </div>
  )
}

/** Today: its rows, then `N done` — the tasks completed today, struck, on one line — and Add task, its last row. */
function TodayGroup({ tabId, group, data, mobile, drag }: Omit<GroupProps, 'children' | 'empty'>) {
  const done = useTasksDoneToday()
  const { today } = data
  const addTask = () => {
    // Where Quick Add would start anyway (the screen filter's seeds), plus the hidden planned day: the task is planned for today.
    const seeds = getFilterDefaults(appliedScreenFilter(useFilterStore.getState()))
    useUIStore.getState().openQuickAdd({ defaults: { ...seeds, doDate: today } })
  }
  return (
    <DayGroup
      tabId={tabId}
      group={group}
      data={data}
      mobile={mobile}
      drag={drag}
      empty={<p className={styles.emptyLine} role="status">Nothing for today</p>}
    >
      {done.length > 0 && (
        <div className={styles.done} data-testid="planner-done">
          <span className={styles.doneCheck} aria-hidden="true"><CheckIcon size={14} /></span>
          <span className={styles.doneCount}>{done.length} done</span>
          <span className={styles.doneTitles}>{done.map((t) => t.title).join(' · ')}</span>
        </div>
      )}
      <button type="button" className={`${listStyles.addTask} ${styles.addTask}`} data-tooltip="Add a task for today" onClick={addTask}>
        <span className={listStyles.addTaskIcon} aria-hidden="true"><PlusIcon size={12} strokeWidth={2} /></span>
        Add task
      </button>
    </DayGroup>
  )
}
