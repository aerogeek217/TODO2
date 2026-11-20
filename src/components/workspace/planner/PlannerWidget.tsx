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
import { movePlannerTask, snoozePlannerTask, unplanPlannerTask } from '../../../services/planner-drop'
import { appliedScreenFilter, useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { usePlannerStore, type PlannerDragPreview } from '../../../stores/planner-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUIStore } from '../../../stores/ui-store'
import { LIST_SECTION_ATTR } from '../../../utils/dom-contract'
import { getFilterDefaults } from '../../../utils/filter-defaults'
import { autoListZoom, UNMEASURED_LIST_ZOOM } from '../../../utils/list-zoom'
import { plannerDayLabel, plannerDropWrite, plannerRangeLabel, type PlannerGroup, type PlannerTarget } from '../../../utils/planner'
import { rowKey } from '../../../utils/scoped-selection'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { plannerDropId, TASK_DROP_KIND, type PlannerDropData } from '../../../utils/task-dnd'
import { plannerFaceFor, plannerStripFits } from '../../../utils/widget-face'
import { BadgeCapsule } from '../../shared/BadgeCapsule'
import { CheckIcon, PlusIcon } from '../../shared/icons'
import { MobileTaskRow } from '../../task/MobileTaskRow'
import { TaskMenuExtrasContext } from '../../task/task-menu-extras'
import { TaskRowGrid } from '../../task/TaskRowGrid'
import { DropSlot, ListWidgetRow, type ListRowDragLook } from '../list/ListWidgetRow'
import listStyles from '../list/ListWidget.module.css'
import { WidgetNameLine } from '../WidgetTopLine'
import { plannerMenuEntries } from './planner-menu'
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

/**
 * The Planner (widget kind `planner`, no settings): a scratch pad for
 * today and the week ahead. Large — the strip of seven day tiles
 * (`PlannerStrip`), then two panes: **Today** on the left (the open tasks
 * planned for today or put there by their own dates, an `N done` line, Add
 * task) and on the right a group per day ahead, with the two trays pinned
 * under them — **Delayed** (planned for a day that has passed; shown while
 * it holds a task) over **Unplanned** (held there, and the Focus tasks with
 * no plan and no date). Medium (a narrow or short cell, and the phone): the
 * strip over one column — Today, the days ahead, Delayed, Unplanned — in
 * one scroll. Small: its name and today's count. A task sits on its planned
 * day, else the day its follow-up or due date puts it (`utils/planner`);
 * rows are the list's (`ListWidgetRow`, `MobileTaskRow` on the phone), a
 * click opening the task. The window and the picked day are the tab's in
 * its layout, in memory (`stores/planner-store`).
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
  /** The widget's element: its scrollers are measured when a task drag starts. */
  hostRef: RefObject<HTMLElement | null>
}) {
  const isMobile = useIsMobile()
  // The phone has no fold: a completed row leaves at once, as a list's.
  const data = usePlanner(tab.id, tab.viewState?.order, !isMobile)
  const { view, offset, picked, badge, windowKey } = data
  const twoPanes = panes && !isMobile
  // The phone has no drag, so a day with nothing on it has nothing to offer there.
  const days = useMemo(() => (isMobile ? view.days.filter((g) => g.tasks.length > 0) : view.days), [isMobile, view.days])
  // Delayed takes no drop: it shows only while it holds a task. Unplanned is a target, so it always shows where rows drag.
  const showDelayed = view.delayed.tasks.length > 0
  const showUnplanned = !isMobile || view.unplanned.tasks.length > 0
  const range = plannerRangeLabel(view.window)
  const tabId = tab.id
  // The right pane's two lists share their columns: the days ahead and the trays line up.
  const aheadTasks = useMemo(
    () => [...days.flatMap((g) => g.tasks), ...view.delayed.tasks, ...view.unplanned.tasks],
    [days, view.delayed, view.unplanned],
  )
  const allTasks = useMemo(() => [...view.today.tasks, ...aheadTasks], [view.today, aheadTasks])

  const onPick = useCallback((day: Date | null) => usePlannerStore.getState().pick(windowKey, day), [windowKey])
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

  const today = <TodayGroup tabId={tabId} group={view.today} data={data} mobile={isMobile} drag={drag} />
  const ahead = days.map((g) => <DayGroup key={g.key} tabId={tabId} group={g} data={data} mobile={isMobile} drag={drag} />)
  const trays = (
    <>
      {showDelayed && <DayGroup tabId={tabId} group={view.delayed} data={data} mobile={isMobile} drag={drag} />}
      {showUnplanned && <DayGroup tabId={tabId} group={view.unplanned} data={data} mobile={isMobile} drag={drag} />}
    </>
  )

  return (
    <TaskMenuExtrasContext.Provider value={menuExtras}>
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
      </WidgetNameLine>
      <PlannerStrip
        tabId={tabId}
        window={view.window}
        tiles={view.tiles}
        picked={picked}
        offset={offset}
        showTiles={tiles}
        onPick={onPick}
        onShift={onShift}
        mark={drag.mark}
      />
      {twoPanes ? (
        <div className={styles.panes} data-planner-layout="panes">
          <div ref={trackScrollEdges} className={`${styles.pane} ${styles.todayPane}`} data-planner-pane="today">
            <Rows tasks={view.today.tasks} data={data} mobile={false}>{today}</Rows>
          </div>
          <div className={styles.aheadPane}>
            <div ref={trackScrollEdges} className={styles.pane} data-planner-pane="ahead">
              <Rows tasks={aheadTasks} data={data} mobile={false}>{ahead}</Rows>
            </div>
            <div ref={trackScrollEdges} className={`${styles.pane} ${styles.pinned}`} data-planner-pane="trays">
              <Rows tasks={aheadTasks} data={data} mobile={false}>{trays}</Rows>
            </div>
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
    </TaskMenuExtrasContext.Provider>
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
 * completed here lingers, then folds (`PlannerData.leaving`).
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

  const { today, last } = data.view.window
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
      data-planner-drop={drag.mark?.key === group.key ? '' : undefined}
      // A grouped body's rows draw no hairline (TaskRow / MobileTaskRow styles).
      data-row-group=""
      {...{ [LIST_SECTION_ATTR]: group.key }}
    >
      <div className={styles.groupHeader}>
        <span className={listStyles.groupName} data-testid="planner-group-name">{label}</span>
        {count > 0 && <span className={listStyles.groupCount} data-testid="planner-group-count">{count}</span>}
        <span className={listStyles.groupRule} aria-hidden="true" />
      </div>
      <div className={styles.groupBody} data-planner-group-body={group.key}>
        {count === 0 && slotAt == null && empty}
        {group.tasks.flatMap((built) => {
          const todo = keptTodos?.get(built.id) ?? built
          const key = rowKey(group.key, todo.id)
          const people = assignedPeopleMap.get(todo.id)
          if (mobile) return [<MobileTaskRow key={key} todo={todo} assignedPeople={people} onOpenDetail={openEditPopup} />]
          // The slot's place counts the rows without the dragged one.
          const slot = key !== draggedKey && slotAt === placed ? <DropSlot key="drop-slot" /> : null
          if (key !== draggedKey) placed++
          return [
            slot,
            <ListWidgetRow
              key={key}
              todo={todo}
              assignedPeople={people}
              tabId={tabId}
              sectionKey={group.key}
              rowKey={key}
              selected={false}
              selFirst
              selLast
              cursor={false}
              look={plannerRowLook(drag, key)}
              leaving={keptTodos?.has(todo.id) ? leaving.get(todo.id)?.phase : undefined}
              zoom={zoom}
              onSelect={onSelect}
              onOpenDetail={openEditPopup}
            />,
          ]
        })}
        {slotAt != null && slotAt >= placed && <DropSlot key="drop-slot" />}
        {children}
      </div>
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
