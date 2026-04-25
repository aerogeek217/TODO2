import { Fragment, memo, useMemo, useCallback, useState, useRef } from 'react'
import { type NodeProps } from '@xyflow/react'
import { useDroppable, useDndMonitor, type DragMoveEvent } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PersistedTodoItem, Person, FloatingTaskboard, TaskboardEntry } from '../../models'
import { useFloatingTaskboardStore } from '../../stores/floating-taskboard-store'
import { useStatusStore } from '../../stores/status-store'
import { TaskRow } from '../task/TaskRow'
import { SortableTaskDraggable } from '../task/dnd/TaskDraggable'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useFloatingWidget } from '../../hooks/use-floating-widget'
import {
  TASK_DRAG_KIND,
  TASK_DROP_KIND,
  taskDragId,
  taskboardFloatDropId,
} from '../../utils/task-dnd'
import { DropIndicator, dropCellClassName } from '../shared/DropIndicator'
import styles from './TaskboardNode.module.css'

export interface TaskboardNodeData {
  floatingId: number
  entries: TaskboardEntry[]
  allTodos: PersistedTodoItem[]
  assignedPeopleMap: Map<number, Person[]>
  ghostTodoIds?: Set<number>
  showCompleted?: boolean
  showHiddenStatuses?: boolean
  onOpenDetail?: (todoId: number) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  onClose: () => void
  width: number
  height: number
  onResize?: (width: number, height: number) => void
}

type TaskboardNodeType = TaskboardNodeData

function SortableTaskboardEntry({
  floatingId, panelId, index, todo, assignedPeople, ghost, onOpenDetail,
}: {
  floatingId: number
  panelId: string
  index: number
  todo: PersistedTodoItem
  assignedPeople: Person[] | undefined
  ghost?: boolean
  onOpenDetail?: (todoId: number) => void
}) {
  return (
    <SortableTaskDraggable
      todo={todo}
      surface="taskboard-float"
      floatingId={floatingId}
      kind={TASK_DRAG_KIND.taskboardTask}
      extraData={{ panelId }}
    >
      {({ attributes, listeners, setNodeRef, transform, transition, isDragging }) => {
        const style = { transform: CSS.Transform.toString(transform), transition }
        return (
          <div
            ref={setNodeRef}
            style={style}
            data-tbp-entry
            data-todo-id={todo.id}
            className={`${styles.sortableItem} ${isDragging ? styles.dragging : ''}`}
            {...attributes}
            {...listeners}
          >
            <span className={styles.orderNumber}>{index + 1}</span>
            <div className={styles.taskWrapper}>
              <TaskRow todo={todo} assignedPeople={assignedPeople} ghost={ghost} compact onOpenDetail={onOpenDetail} onTaskboard />
            </div>
          </div>
        )
      }}
    </SortableTaskDraggable>
  )
}

function TaskboardNodeInner({ data }: NodeProps & { data: TaskboardNodeType }) {
  const {
    floatingId,
    entries,
    allTodos,
    assignedPeopleMap,
    ghostTodoIds,
    showCompleted,
    showHiddenStatuses,
    onOpenDetail,
    isCollapsed,
    onToggleCollapse,
    onClose,
    width,
    height,
    onResize,
  } = data

  const droppableId = taskboardFloatDropId(floatingId)
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: droppableId,
    data: { type: TASK_DROP_KIND.taskboard, panelId: droppableId },
  })

  // Read the row's x/y from the store at hook-call time so the kind-switch
  // dispatcher has the live position; the floatingId is the entire identity
  // surface for the canvas-rails store.
  const row = useFloatingTaskboardStore((s) => s.taskboards.find((t) => t.id === floatingId))
  const rect = useMemo(
    () => ({ x: row?.x ?? 0, y: row?.y ?? 0, width, height }),
    [row?.x, row?.y, width, height],
  )

  const { headerProps, handleChangeKind, kindAnchor, setKindAnchor } = useFloatingWidget({
    kind: 'taskboard',
    id: floatingId,
    rect,
    onDelete: onClose,
  })

  const [isExternalDragOver, setIsExternalDragOver] = useState(false)
  const [tbInsertIndex, setTbInsertIndex] = useState<number | null>(null)

  const todoMap = useMemo(() => {
    const map = new Map<number, PersistedTodoItem>()
    for (const t of allTodos) map.set(t.id, t)
    return map
  }, [allTodos])

  const statuses = useStatusStore((s) => s.statuses)
  const hiddenStatusIds = useMemo(
    () => new Set(statuses.filter((s) => s.hideByDefault).map((s) => s.id!)),
    [statuses],
  )

  const visibleEntries = useMemo(
    () => entries.filter((e) => {
      const t = todoMap.get(e.todoId)
      if (!t) return false
      if (!showCompleted && t.isCompleted) return false
      if (!showHiddenStatuses && t.statusId != null && hiddenStatusIds.has(t.statusId)) return false
      return true
    }),
    [entries, todoMap, showCompleted, showHiddenStatuses, hiddenStatusIds],
  )

  const entryIds = useMemo(
    () => visibleEntries.map((e) => taskDragId('taskboard-float', e.todoId, { floatingId })),
    [visibleEntries, floatingId],
  )

  // Ref-synced view of `visibleEntries` so `onDragMove` can append without
  // re-registering with `useDndMonitor` when the list changes.
  const visibleEntriesRef = useRef<TaskboardEntry[]>([])
  visibleEntriesRef.current = visibleEntries

  const onDragMove = useCallback((event: DragMoveEvent) => {
    const activeType = event.active.data.current?.type
    if (activeType === TASK_DRAG_KIND.taskboardTask) {
      setIsExternalDragOver(false)
      setTbInsertIndex(null)
      return
    }
    const overData = event.over?.data.current
    const overPanelId = overData?.panelId as string | undefined
    // The over target is *this* floating taskboard when it's either the
    // panel droppable or one of its sortable entries — both carry the same
    // `panelId`. Avoids `useDroppable.isOver`, which flips false the moment
    // dnd-kit picks an inner sortable entry as the over target.
    const belongs = (overData?.type === TASK_DROP_KIND.taskboard || overData?.type === TASK_DROP_KIND.taskboardTask)
      && overPanelId === droppableId
    setIsExternalDragOver(belongs)
    if (!belongs) { setTbInsertIndex(null); return }

    // Insertion index comes straight from dnd-kit's sortable data — Phase 6
    // of the DnD unification replaced the DOM scan here with the shared
    // sortable context so indicator + drop share a single source of truth.
    if (overData?.type === TASK_DROP_KIND.taskboardTask) {
      const sortable = overData.sortable as { index?: number } | undefined
      setTbInsertIndex(typeof sortable?.index === 'number' ? sortable.index : visibleEntriesRef.current.length)
    } else {
      setTbInsertIndex(visibleEntriesRef.current.length)
    }
  }, [droppableId])

  const onDragClear = useCallback(() => {
    setIsExternalDragOver(false)
    setTbInsertIndex(null)
  }, [])

  const dndListeners = useMemo(
    () => ({ onDragMove, onDragEnd: onDragClear, onDragCancel: onDragClear }),
    [onDragMove, onDragClear],
  )
  useDndMonitor(dndListeners)

  // Phase 7 of DnD unification retired the native-HTML5 drop path; all
  // external drops (calendar events included) now flow through the shared
  // dnd-kit dispatch pipeline via `onDragMove`.
  const effectiveInsertIndex = tbInsertIndex

  return (
    <div
      ref={setDropRef}
      data-taskboard-panel-id={droppableId}
      className={`${styles.node} ${dropCellClassName(isOver || isExternalDragOver)}`}
      style={{ width }}
    >
      <WidgetHeader
        kind="taskboard"
        title="Taskboard"
        meta={visibleEntries.length}
        collapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
        {...headerProps}
        floating
      />

      <div
        className={`${isCollapsed ? styles.collapsedBody : styles.body} nopan nodrag nowheel`}
        style={!isCollapsed ? { maxHeight: height || 400 } : undefined}
      >
        {visibleEntries.length === 0 ? (
          <div className={styles.emptyMessage}>No tasks queued</div>
        ) : (
          <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
            {visibleEntries.map((entry, i) => {
              const todo = todoMap.get(entry.todoId)
              if (!todo) return null
              return (
                <Fragment key={entry.todoId}>
                  {effectiveInsertIndex === i && <DropIndicator kind="line" />}
                  <SortableTaskboardEntry
                    floatingId={floatingId}
                    panelId={droppableId}
                    index={i}
                    todo={todo}
                    assignedPeople={assignedPeopleMap.get(todo.id)}
                    ghost={ghostTodoIds?.has(todo.id)}
                    onOpenDetail={onOpenDetail}
                  />
                </Fragment>
              )
            })}
            {effectiveInsertIndex === visibleEntries.length && <DropIndicator kind="line" />}
          </SortableContext>
        )}
      </div>

      <ResizeHandle
        axis="x"
        width={width}
        height={height}
        minW={220}
        className={`${styles.resizeHandle} nopan nodrag`}
        bodySelector={`.${styles.node}`}
        onResize={(w) => onResize?.(w, height)}
      />
      {kindAnchor && (
        <WidgetKindMenu
          anchor={kindAnchor}
          currentKind="taskboard"
          onChangeKind={(k) => { void handleChangeKind(k) }}
          onClose={() => setKindAnchor(null)}
        />
      )}
    </div>
  )
}

export const TaskboardNode = memo(TaskboardNodeInner)

/** Floating placement row referenced by CanvasPage when building node data. */
export type FloatingTaskboardRow = FloatingTaskboard
