import { useEffect, useRef, useState, type RefObject } from 'react'
import { useDndMonitor, type DragMoveEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core'
import type { PersistedTodoItem } from '../../../models'
import { usePlannerStore, type PlannerDragPreview } from '../../../stores/planner-store'
import { contentY, listRowDropTarget, measureListGeometry, type ListGeometry } from '../../../utils/list-row-drop'
import { plannerDrop, plannerTargetKey, type PlannerDrop } from '../../../utils/planner'
import { rowKey } from '../../../utils/scoped-selection'
import { isPlannerDropData, TASK_DROP_KIND, type PlannerDropData } from '../../../utils/task-dnd'
import { watchDragRelease } from '../drag-release'
import type { ListRowDragData } from '../list/ListWidgetRow'

/** A task drag in progress anywhere in the workspace, as a Planner sees it. */
export interface PlannerActiveDrag {
  todo: PersistedTodoItem
  /**
   * One of this Planner's own rows: its occurrence key, its group and its
   * place among the group's rows. Null for a task from elsewhere (a list's
   * row, a calendar entry, another Planner's row).
   */
  row: { key: string; groupKey: string; index: number } | null
}

/** The scrollers a Planner's groups sit in: the large face's three panes (Today, the days ahead, the trays), else its one column. */
const SCROLLERS = '[data-planner-pane], [data-planner-layout="column"]'

interface Measured {
  scrollEl: HTMLElement
  geometry: ListGeometry
}

function ownRow(data: unknown, tabId: string): ListRowDragData | null {
  if (data == null || typeof data !== 'object') return null
  const row = data as Partial<ListRowDragData>
  return row.listTabId === tabId && typeof row.sectionKey === 'string' && typeof row.rowKey === 'string'
    ? { listTabId: tabId, sectionKey: row.sectionKey, rowKey: row.rowKey }
    : null
}

/** A drop's day (planned for it, or its own date's) or whether it holds, for comparing two. */
const dropDetail = (drop: PlannerDrop): number | boolean | null => ('day' in drop ? drop.day.getTime() : 'hold' in drop ? drop.hold : null)

const samePreview = (a: PlannerDragPreview | null, b: PlannerDragPreview | null): boolean =>
  a === b || (a != null && b != null && a.tabId === b.tabId && a.over === b.over && a.key === b.key && a.index === b.index
    && a.drop.kind === b.drop.kind && dropDetail(a.drop) === dropDetail(b.drop))

/**
 * Follows a task drag over the Planner `tabId` (the surrounding `DndContext`
 * does the dragging; any task drag — this Planner's rows, a list's, a
 * calendar entry) and says what a drop would do: `stores/planner-store`'s
 * `drag` (`PlannerDragPreview`), which its tiles and groups mark the target
 * from and the page's overlay labels the lifted row from. It writes nothing:
 * the drop itself is the page's (`dispatchTaskDrop` → the Planner's one
 * write), which reads the place in the group from the preview.
 *
 * The target is dnd-kit's (`over`: the Planner's tiles and groups are its
 * droppables, so a clipped or covered one never counts); this adds the place
 * in a hovered group, from the groups' geometry as measured when the drag
 * started — so rows making room don't move the spots under the pointer — and
 * the pointer's own position.
 */
export function usePlannerDrag(tabId: string, hostRef: RefObject<HTMLElement | null>): PlannerActiveDrag | null {
  const [active, setActiveState] = useState<PlannerActiveDrag | null>(null)
  const activeRef = useRef<PlannerActiveDrag | null>(null)
  /** Each group's scroller and its rows, by group key, as the drag started. */
  const measuredRef = useRef<Map<string, Measured>>(new Map())
  /** This Planner's droppable under the pointer, as dnd-kit last said. */
  const overRef = useRef<PlannerDropData | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  /** Stops following the drag; set while one is on. */
  const stopRef = useRef<(() => void) | null>(null)

  const setPreview = (next: PlannerDragPreview | null) => {
    const store = usePlannerStore.getState()
    const current = store.drag
    if (next) {
      if (!samePreview(current, next)) store.setDrag(next)
    } else if (current?.tabId === tabId) {
      // Only this Planner's: another one's stays its own to clear.
      store.setDrag(null)
    }
  }

  /** The preview for what is hovered now, at the pointer. */
  const compute = () => {
    const current = activeRef.current
    const over = overRef.current
    if (!current || !over) {
      setPreview(null)
      return
    }
    const { todo } = current
    const drop = plannerDrop(todo, over.window, over.target)
    const group = over.type === TASK_DROP_KIND.plannerGroup ? over.group : undefined
    let index: number | null = null
    const pointer = pointerRef.current
    // A place only where the drop brings the row into the group (an Unplan always does: held, or kept there by Focus), or it is there already.
    const lands = drop.kind === 'plan' || drop.kind === 'own' || drop.kind === 'unplan'
      || (drop.kind === 'none' && group?.rows.includes(todo.uid) === true)
    if (group && pointer && lands) {
      const measured = measuredRef.current.get(group.key)
      const section = measured?.geometry.sections.find((s) => s.key === group.key)
      if (measured && section) {
        const source = { key: rowKey(group.key, todo.id), todoId: todo.id, sectionKey: group.key, index: 0 }
        index = listRowDropTarget({ sections: [section] }, contentY(measured.scrollEl, pointer.y), source, true)?.index ?? null
      }
    }
    setPreview({ tabId, over: group ? 'group' : 'tile', key: plannerTargetKey(over.target), drop, index })
  }

  const end = () => {
    stopRef.current?.()
    stopRef.current = null
    measuredRef.current = new Map()
    overRef.current = null
    pointerRef.current = null
    activeRef.current = null
    setActiveState(null)
    setPreview(null)
  }

  const follow = (event: DragOverEvent | DragMoveEvent) => {
    if (!activeRef.current) return
    const data: unknown = event.over?.data.current
    overRef.current = isPlannerDropData(data) && data.scope === tabId ? data : null
    compute()
  }

  useDndMonitor({
    onDragStart(event: DragStartEvent) {
      const data = event.active.data.current
      const todo = data?.todo as PersistedTodoItem | undefined
      const host = hostRef.current
      if (!todo || !host) return
      stopRef.current?.()
      const measured = new Map<string, Measured>()
      const scrollers = Array.from(host.querySelectorAll<HTMLElement>(SCROLLERS))
      for (const scrollEl of scrollers) {
        const geometry = measureListGeometry(scrollEl)
        for (const section of geometry.sections) measured.set(section.key, { scrollEl, geometry })
      }
      measuredRef.current = measured
      const own = ownRow(data, tabId)
      const rows = own ? measured.get(own.sectionKey)?.geometry.sections.find((s) => s.key === own.sectionKey)?.rows : undefined
      const next: PlannerActiveDrag = {
        todo,
        row: own ? { key: own.rowKey, groupKey: own.sectionKey, index: Math.max(0, rows?.findIndex((r) => r.key === own.rowKey) ?? 0) } : null,
      }
      activeRef.current = next
      setActiveState(next)
      overRef.current = null
      const at = event.activatorEvent as Partial<PointerEvent> | null
      pointerRef.current = typeof at?.clientX === 'number' && typeof at.clientY === 'number' ? { x: at.clientX, y: at.clientY } : null

      // The pointer itself (dnd-kit's travel also counts its row's scroll), from here on.
      const onMove = (e: PointerEvent) => {
        pointerRef.current = { x: e.clientX, y: e.clientY }
        compute()
      }
      // A pane scrolling under a still pointer moves the landing spot too.
      const onScroll = () => compute()
      window.addEventListener('pointermove', onMove)
      for (const el of scrollers) el.addEventListener('scroll', onScroll, { passive: true })
      // A drag dnd-kit ends without telling us (a quick flick) ends here too.
      const stopWatching = watchDragRelease(() => activeRef.current === next, end)
      stopRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        for (const el of scrollers) el.removeEventListener('scroll', onScroll)
        stopWatching()
      }
    },
    onDragOver: follow,
    onDragMove: follow,
    onDragEnd() {
      if (activeRef.current) end()
    },
    onDragCancel() {
      if (activeRef.current) end()
    },
  })

  // The Planner unmounted mid-drag (a face change, its tab closed): stop following, and take its preview with it.
  useEffect(() => () => {
    stopRef.current?.()
    const store = usePlannerStore.getState()
    if (store.drag?.tabId === tabId) store.setDrag(null)
  }, [tabId])

  return active
}
