import { Fragment, createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { PersistedTodoItem } from '../../../models'
import { kindTabTitle, plannerUnplannedFilter, type ListZoom, type PlannerTab, type PlannerTabConfig } from '../../../models/workspace-layout'
import { useDropRefusedCursor } from '../../../hooks/use-drop-refused-cursor'
import { useElementSize } from '../../../hooks/use-element-size'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { usePlanner, useTasksDoneToday, type PlannerData } from '../../../hooks/use-planner'
import { useRowFieldsUsed } from '../../../hooks/use-row-fields-used'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { clearDelayedPlans, movePlannerTask, snoozePlannerTask, unplanPlannerTask } from '../../../services/planner-drop'
import { doneTodayTaskDialog } from '../../../services/task-dialog'
import { usePersonStore } from '../../../stores/person-store'
import { usePlannerStore, type PlannerDragPreview } from '../../../stores/planner-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWidgetPreviewStore } from '../../../stores/widget-preview-store'
import { LIST_SECTION_ATTR } from '../../../utils/dom-contract'
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
import { plannerFaceFor, plannerPortrait, plannerStripFits } from '../../../utils/widget-face'
import { CellControlsContext } from '../cell-controls'
import { BadgeCapsule } from '../../shared/BadgeCapsule'
import { CheckIcon, ResetIcon } from '../../shared/icons'
import { MenuPopover } from '../../shared/MenuPopover'
import { useTooltip } from '../../shared/use-tooltip'
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
import { WeekLoadMeter } from './WeekLoadMeter'
import { plannerRowExtras } from './planner-row-extras'
import { PlannerRowTag } from './PlannerRowExtras'
import { PlannerDock, PlannerFoldedDock } from './PlannerDock'
import { PlannerFilterLine } from './PlannerFilterLine'
import { useDaysInView } from './planner-dock'
import { PlannerStrip, WeekArrow, type PlannerDropMark } from './PlannerStrip'
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
 * The Planner (widget kind `planner`; its one setting the Unplanned filter): a scratch pad for
 * today and the week ahead. Its top line (alone in its cell): the name,
 * the window's range, the week load meter (`WeekLoadMeter`; Week load… in
 * the widget's ⋯ elsewhere) and **Reset plan** (`PlannerResetButton`; in a
 * cell of tabs the same three choices are under Reset plan › in the widget's ⋯).
 * Large — the strip of seven day tiles (`PlannerStrip`), then two panes:
 * on the left **one scrolling list of days** — Today (its rows, an `N
 * done` line, Add task), then every later day of the window in order, a
 * day with nothing on it a quiet heading —, and on the right, on a darker
 * ground, the trays: **Delayed** (planned for a day that has passed; shown
 * while it holds a task), the **Clear plans** button on a rule (every
 * Delayed task's plan cleared; with Delayed) and **Unplanned** (the tasks
 * with no plan and no date that match its filter — read back in words
 * under the heading, `PlannerFilterLine`; always there). Medium in a tall,
 * narrow cell (`plannerPortrait`, board R1): the strip over the day list,
 * and the trays **docked** under it on the darker ground (`PlannerDock`:
 * its top edge shares the height, its chevron folds it to one bar that
 * still takes a drop to Unplanned); the week arrows sit in the top line,
 * and a line under the tiles marks the days in view. Medium otherwise (a
 * short or squarish narrow cell, and the phone): the strip over one column
 * in that order, in one scroll — the phone, which has no drag, without the
 * empty days and without an empty Unplanned. The strip shows only where
 * its tiles have room for their ticks (`plannerStripFits`); else the week's
 * range and arrows sit in the top line, or in a slim range row with none.
 * Small: its name and today's count. A task sits on its
 * planned day, else the day its follow-up or due date puts it
 * (`utils/planner`); rows are the list's (`ListWidgetRow`, `MobileTaskRow`
 * on the phone), a click opening the task. A tile's click scrolls the day
 * list to its day. The window is the tab's in its layout, in memory
 * (`stores/planner-store`).
 *
 * **Rows** carry four Planner-only things (`PlannerRowExtras`, through
 * `TaskRowExtrasContext`; the flag is the Planner's own, around the row): a
 * **corner flag** on every placed row (a planned day); a **tag** after the
 * title — a Delayed row's planned day, or `1 day after due` on a row
 * planned past a real date, a button opening its fixes —; that passed date
 * **drawn late**;
 * and **Snooze** / **Unplan** buttons on hover and focus (desktop).
 *
 * **Drops** (desktop): every tile and every group takes a dragged task — a
 * row of this Planner, a list's row, a calendar entry — as a dnd-kit
 * droppable (`TASK_DROP_KIND.plannerDay` / `.plannerGroup`); the page's one
 * dispatcher makes the drop (`services/planner-drop`: the task planned for
 * the day, its plan cleared on its own date's day or on Unplanned, or
 * refused — Delayed takes no drop — and never a due date or a follow-up),
 * and a drop into a group also stores the row's place in the hand order
 * (the tab's `order`). While a task is dragged over it (`usePlannerDrag`)
 * the target's tile and group are dashed in one neutral color, a blank slot
 * shows where the row would land, and the lifted row carries the label
 * (`PlannerDragLabel`). Without a pointer: **Plan for day ›**, **Snooze**
 * and **Unplan** in a row's task menu (`planner-menu`).
 */
export function PlannerWidget({ tab: stored }: { tab: PlannerTab }) {
  // Its settings as their open editor holds them, unsaved (`widget-preview-store`), else as stored.
  const preview = useWidgetPreviewStore((s) => s.configs[stored.id])
  const tab = useMemo(() => (preview ? { ...stored, config: preview as PlannerTabConfig } : stored), [stored, preview])
  const [faceRef, face] = useWidgetFace(plannerFaceFor)
  const [sizeRef, size] = useElementSize()
  const isMobile = useIsMobile()
  const hostRef = useRef<HTMLElement | null>(null)
  const setHost = useCallback((el: HTMLElement | null) => {
    hostRef.current = el
    faceRef(el)
    sizeRef(el)
  }, [faceRef, sizeRef])
  // The phone keeps its one column; a tall, narrow cell docks the trays under the days (board R1).
  const layout: PlannerLayout = isMobile ? 'column' : face === 'large' ? 'panes' : plannerPortrait(size) ? 'stack' : 'column'
  return (
    <div ref={setHost} className={styles.host} data-planner={tab.id} data-planner-face={face}>
      {face === 'small'
        ? <SmallFace tab={tab} />
        : <PlannerBody tab={tab} layout={layout} size={size} hostRef={hostRef} />}
    </div>
  )
}

/**
 * How a Planner's body lays out its groups: `panes` — the large face's days
 * and trays side by side; `stack` — the portrait layout, the days over the
 * trays dock (`PlannerDock`); `column` — one scroll (a short or squarish
 * narrow cell, the phone).
 */
type PlannerLayout = 'panes' | 'stack' | 'column'

function SmallFace({ tab }: { tab: PlannerTab }) {
  const { view } = usePlanner(tab, false)
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

function PlannerBody({ tab, layout, size, hostRef }: {
  tab: PlannerTab
  layout: PlannerLayout
  /** The widget's size: whether the strip fits (`plannerStripFits`). */
  size: { width: number; height: number }
  /** The widget's element: its scrollers are measured when a task drag starts, and scrolled by a tile's click. */
  hostRef: RefObject<HTMLElement | null>
}) {
  const isMobile = useIsMobile()
  // The phone has no fold: a completed row leaves at once, as a list's.
  const data = usePlanner(tab, !isMobile)
  const { view, offset, badge, windowKey, keptTodos } = data
  const stack = layout === 'stack'
  // Alone in its cell the top line shows: in the portrait layout the week arrows move there, giving the tiles the strip's width.
  const alone = useContext(CellControlsContext) != null
  // The strip shows only where every tile has room for its ticks and the widget room for it over Today's first row.
  const tiles = plannerStripFits(size, { arrows: !(stack && alone), topLine: alone })
  // Without the strip the week's range and arrows sit in the top line — or, with none, in a slim row of their own.
  const arrowsInTopLine = alone && (stack || !tiles)
  const stackRef = useRef<HTMLDivElement | null>(null)
  // The portrait layout's day list, for the strip's "days in view" line.
  const [daysPane, setDaysPane] = useState<HTMLElement | null>(null)
  const daysPaneRef = useCallback((el: HTMLDivElement | null) => {
    setDaysPane(el)
    return trackScrollEdges(el)
  }, [])
  const inView = useDaysInView(stack ? daysPane : null)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  // The phone has no drag, so a day with nothing on it has nothing to offer there.
  const days = useMemo(() => (isMobile ? view.days.filter((g) => g.tasks.length > 0) : view.days), [isMobile, view.days])
  // Delayed takes no drop: it shows only while it holds a task, and the Clear plans button with it. Unplanned is a target, so it is always there where rows drag.
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

  // ── Plan for day ›, Snooze and Unplan, in each row's task menu ──
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

  // Clear Delayed plans: the Delayed rows as they are — a row lingering after its completion left out.
  const clearDelayed = useCallback(() => {
    const tasks = view.delayed.tasks.filter((t) => !keptTodos?.has(t.id))
    void clearDelayedPlans({ window: view.window, delayed: { ...view.delayed, tasks } })
  }, [view.window, view.delayed, keptTodos])

  const today = <TodayGroup tabId={tabId} group={view.today} data={data} mobile={isMobile} drag={drag} />
  const ahead = days.map((g) => <DayGroup key={g.key} tabId={tabId} group={g} data={data} mobile={isMobile} drag={drag} />)
  const unplannedFilter = plannerUnplannedFilter(tab.config)
  const trays = (
    <>
      {showDelayed && <DayGroup tabId={tabId} group={view.delayed} data={data} mobile={isMobile} drag={drag} />}
      {showDelayed && <ClearDelayed onClear={clearDelayed} />}
      {showUnplanned && (
        <DayGroup
          tabId={tabId}
          group={view.unplanned}
          data={data}
          mobile={isMobile}
          drag={drag}
          under={<PlannerFilterLine tabId={tabId} filter={unplannedFilter} />}
          empty={<p className={styles.emptyLine} role="status">Nothing unplanned</p>}
        />
      )}
    </>
  )

  return (
    <TaskMenuExtrasContext.Provider value={menuExtras}>
      <TaskRowExtrasContext.Provider value={rowExtras}>
        <WidgetNameLine name="Planner">
          {arrowsInTopLine && <WeekArrow direction={-1} disabled={offset <= 0} onShift={onShift} compact />}
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
          {arrowsInTopLine && <WeekArrow direction={1} disabled={false} onShift={onShift} compact />}
          {badge.counts.due + badge.counts.followup > 0 && (
            <BadgeCapsule counts={badge.counts} label={badge.summary.join('; ')} data-testid="planner-badge" />
          )}
          <span className={styles.topLineGap} aria-hidden="true" />
          <WeekLoadMeter />
          <PlannerResetButton tab={tab} />
        </WidgetNameLine>
        {(tiles || !alone) && (
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
            arrows={!arrowsInTopLine}
            inView={stack && tiles ? inView : undefined}
          />
        )}
        {stack ? (
          <div ref={stackRef} className={styles.stack} data-planner-layout="stack">
            <div ref={daysPaneRef} className={`${styles.pane} ${styles.stackDays}`} data-planner-pane="days">
              <Rows tasks={dayTasks} data={data} mobile={false}>
                {today}
                {ahead}
              </Rows>
            </div>
            {tab.viewState?.dockFolded ? (
              <PlannerFoldedDock
                tabId={tabId}
                window={view.window}
                delayed={view.delayed.tasks.length}
                unplanned={view.unplanned.tasks.length}
                marked={drag.mark?.key === view.unplanned.key}
                filter={<PlannerFilterLine tabId={tabId} filter={unplannedFilter} />}
              />
            ) : (
              <PlannerDock tabId={tabId} share={tab.viewState?.dockShare} stackRef={stackRef}>
                <Rows tasks={trayTasks} data={data} mobile={false}>{trays}</Rows>
              </PlannerDock>
            )}
          </div>
        ) : layout === 'panes' ? (
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
 * The **Clear plans** button, centered on a hairline rule between Delayed
 * and Unplanned (only while Delayed holds a task): every Delayed task's plan
 * cleared, one undo step (`services/planner-drop.clearDelayedPlans`). Named
 * `Clear Delayed plans`.
 */
function ClearDelayed({ onClear }: { onClear: () => void }) {
  return (
    <div className={styles.clearDelayed} data-planner-clear-delayed="">
      <span className={styles.clearDelayedRule} aria-hidden="true" />
      <button
        type="button"
        className={styles.clearDelayedButton}
        aria-label="Clear Delayed plans"
        data-tooltip="Clear the plan of every Delayed task: each goes back to where its own dates put it"
        onClick={onClear}
      >
        Clear plans
      </button>
      <span className={styles.clearDelayedRule} aria-hidden="true" />
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
  /** Under its heading, before its rows (Unplanned's filter line). */
  under?: ReactNode
}

/**
 * A group: its header in the list's group-header look (name, count, a rule
 * to the line's end) and its tasks as the list's rows — draggable
 * occurrences (`ListWidgetRow`: the tab's scope, the group's key as their
 * section), a click opening the task; `MobileTaskRow` on the phone. A row
 * completed here lingers, then folds (`PlannerData.leaving`). A day with
 * nothing on it is a quiet heading — its name muted, no count
 * (`data-planner-empty`) — and still takes a drop. A placed row (a planned
 * day) carries the **corner flag** at its top-left
 * (`PlannerRowWrap`).
 *
 * The whole group is a drop target (a droppable, not on the phone): its
 * day — Today's is today —, or its tray (Delayed refuses every drop but a
 * reorder of its own rows); its drop data carries its rows and every row
 * shown, for the hand order. While a task is dragged over it a blank slot
 * (the list's `DropSlot`) shows where the row would land, and the group is
 * dashed while the drop changes the plan (`data-planner-drop`).
 */
function DayGroup({ tabId, group, data, mobile, drag, children, empty, under }: GroupProps) {
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

  // The window as it shows, its Unplanned filter included: what a placement is read against.
  const span = data.view.window
  const rows = useMemo(() => group.tasks.map((t) => t.uid), [group.tasks])
  const dropData: PlannerDropData = {
    type: TASK_DROP_KIND.plannerGroup,
    scope: tabId,
    target: groupTarget(group),
    window: span,
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
      {under}
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
 * and Lines styles, the phone row. It is drawn only (`aria-hidden`): the
 * row's accessible description says the same in words (`planned`, `set
 * aside` — `TaskRowExtras.description`).
 */
function PlannerRowWrap({ todoId, flagged, children }: { todoId: number; flagged: boolean; children: ReactNode }) {
  return (
    <div className={styles.rowWrap} data-planner-row={todoId} data-planner-placed={flagged ? '' : undefined}>
      {children}
      {flagged && <span className={styles.flag} aria-hidden="true" data-planner-flag="" />}
    </div>
  )
}

/** `N done` under Today: opens the tasks completed today in the task dialog, as the top bar's tally does. */
function DoneCount({ count }: { count: number }) {
  const { triggerProps, tooltip } = useTooltip('Show the tasks done today')
  return (
    <button
      type="button"
      className={styles.doneCount}
      data-planner-done-count=""
      aria-label={`${count} done today. Show them`}
      onClick={() => useUIStore.getState().showTaskDialog(doneTodayTaskDialog())}
      {...triggerProps}
    >
      <span className={styles.doneCheck} aria-hidden="true"><CheckIcon size={14} /></span>
      {count} done
      {tooltip}
    </button>
  )
}

/**
 * Today: its rows, then `N done` — the tasks completed today, struck, on one
 * line. The count opens them in the task dialog, as the top bar's tally does;
 * a title opens its task.
 */
function TodayGroup({ tabId, group, data, mobile, drag }: Omit<GroupProps, 'children' | 'empty'>) {
  const done = useTasksDoneToday()
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
          <DoneCount count={done.length} />
          <span className={styles.doneTitles}>
            {done.map((t, i) => (
              <Fragment key={t.id}>
                {i > 0 && ' · '}
                <button
                  type="button"
                  className={styles.doneTitle}
                  data-planner-done-task={t.id}
                  aria-label={`${t.title}, done today. Open`}
                  onClick={() => useUIStore.getState().openEditPopup(t.id)}
                >
                  {t.title}
                </button>
              </Fragment>
            ))}
          </span>
        </div>
      )}
    </DayGroup>
  )
}
