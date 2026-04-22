import type React from 'react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  useDroppable,
  useDndMonitor,
  type DragMoveEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { useFilterStore } from '../../stores/filter-store'
import { useUIStore } from '../../stores/ui-store'
import { TaskRow } from '../task/TaskRow'
import { SortableTaskDraggable } from '../task/dnd/TaskDraggable'
import type { PersistedTodoItem, TaskboardEntry } from '../../models'
import { useExternalTaskboardDrop } from '../../hooks/use-external-taskboard-drop'
import {
  TASK_DRAG_KIND,
  TASK_DROP_KIND,
  TASKBOARD_SINGLETON_DROP_ID,
  taskDragId,
} from '../../utils/task-dnd'
import { DropIndicator, dropCellClassName } from '../shared/DropIndicator'
import styles from './TaskboardPanel.module.css'

interface SortableEntryProps {
  panelId: string
  index: number
  todo: PersistedTodoItem
  assignedPeople: import('../../models').Person[] | undefined
  onOpenDetail: (todoId: number) => void
}

function SortableEntry({ panelId, index, todo, assignedPeople, onOpenDetail }: SortableEntryProps) {
  return (
    // Route through the canvas-level DndContext so entry drags outside the
    // panel (→ remove) and cross-view drops (→ reorder across dashboard +
    // floating taskboard views of the singleton) reach use-canvas-dnd.
    // `panelId` lets onDragMove recognize which panel the over entry belongs
    // to without DOM walking; the sortable id (read from `over.id` by the
    // drop dispatcher) carries the todo id so no extra `entryId` payload is
    // needed.
    <SortableTaskDraggable
      todo={todo}
      surface="taskboard-panel"
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
              <TaskRow todo={todo} assignedPeople={assignedPeople} compact onOpenDetail={onOpenDetail} onTaskboard />
            </div>
          </div>
        )
      }}
    </SortableTaskDraggable>
  )
}

type HeaderDragProps = React.HTMLAttributes<HTMLDivElement>

interface TaskboardPanelProps {
  dragHandleIcon?: ReactNode
  dragHandleProps?: HeaderDragProps
  /** Hide the panel's own "Taskboard" header — used when a caller (e.g. a rail slot) already renders its own chrome. */
  hideHeader?: boolean
}

export function TaskboardPanel({ dragHandleIcon, dragHandleProps, hideHeader }: TaskboardPanelProps = {}) {
  const board = useTaskboardStore((s) => s.board)
  const ensureLoaded = useTaskboardStore((s) => s.ensureLoaded)
  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const statuses = useStatusStore((s) => s.statuses)
  const showCompleted = useFilterStore((s) => s.filters.showCompleted)
  const showHiddenStatuses = useFilterStore((s) => s.filters.showHiddenStatuses)
  const { openEditPopup } = useUIStore()

  useEffect(() => {
    if (!board) void ensureLoaded()
  }, [board, ensureLoaded])

  const entries: TaskboardEntry[] = useMemo(
    () => board?.entries ?? [],
    [board],
  )

  const droppableId = TASKBOARD_SINGLETON_DROP_ID
  const { setNodeRef: setDropRef } = useDroppable({
    id: droppableId,
    data: { type: TASK_DROP_KIND.taskboard, panelId: droppableId },
  })
  const listRef = useRef<HTMLDivElement | null>(null)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)
  const [isDndDragOver, setIsDndDragOver] = useState(false)

  // Ref so `onDragMove` can read the current visible-entries list without
  // re-registering with `useDndMonitor` every render.
  const visibleEntriesRef = useRef<TaskboardEntry[]>([])

  // Surface an insertion line for external drags (not taskboard-task reorders)
  // whose `over` is either this panel or one of its sortable entries — entry
  // ids include `panelId` so we can isolate per-panel without leaning on
  // `useDroppable.isOver`, which flips false the moment dnd-kit picks an
  // inner sortable entry as the over target. Insertion index reads directly
  // from dnd-kit's sortable data so the indicator and the drop handler can
  // never disagree — Phase 6 of the DnD unification replaced the DOM scan
  // here with a single source of truth (`over.data.current.sortable.index`
  // for a hover over an entry; `visibleEntries.length` for a hover over the
  // panel container itself).
  const onDragMove = useCallback((event: DragMoveEvent) => {
    const activeType = event.active.data.current?.type
    if (activeType === TASK_DRAG_KIND.taskboardTask) {
      setInsertIndex(null)
      setIsDndDragOver(false)
      return
    }
    const overData = event.over?.data.current
    const overPanelId = overData?.panelId as string | undefined
    const belongs = (overData?.type === TASK_DROP_KIND.taskboard || overData?.type === TASK_DROP_KIND.taskboardTask)
      && overPanelId === droppableId
    setIsDndDragOver(belongs)
    if (!belongs) { setInsertIndex(null); return }
    if (overData?.type === TASK_DROP_KIND.taskboardTask) {
      const sortable = overData.sortable as { index?: number } | undefined
      setInsertIndex(typeof sortable?.index === 'number' ? sortable.index : visibleEntriesRef.current.length)
    } else {
      setInsertIndex(visibleEntriesRef.current.length)
    }
  }, [droppableId])

  const onDragClear = useCallback(() => {
    setInsertIndex(null)
    setIsDndDragOver(false)
  }, [])
  useDndMonitor({ onDragMove, onDragEnd: onDragClear, onDragCancel: onDragClear })

  // Native HTML5 drop path for non-dnd-kit sources (e.g. calendar events).
  const {
    externalInsertIndex,
    isExternalDragOver,
    onDragOver: onExternalDragOver,
    onDragLeave: onExternalDragLeave,
    onDrop: onExternalDrop,
  } = useExternalTaskboardDrop(droppableId)
  const effectiveInsertIndex = insertIndex ?? externalInsertIndex
  const isAnyDragOver = isDndDragOver || isExternalDragOver

  const todoMap = useMemo(() => {
    const map = new Map<number, PersistedTodoItem>()
    for (const t of todos) map.set(t.id, t)
    return map
  }, [todos])

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

  const entryIds = useMemo(() => visibleEntries.map((e) => taskDragId('taskboard-panel', e.todoId)), [visibleEntries])

  // Keep the ref synced so `onDragMove` always reads the current visible list
  // without re-registering with `useDndMonitor`.
  visibleEntriesRef.current = visibleEntries

  const handleOpenDetail = useCallback((todoId: number) => { openEditPopup(todoId) }, [openEditPopup])

  return (
    <div
      ref={setDropRef}
      data-taskboard-panel-id={droppableId}
      className={`${styles.panel} ${hideHeader ? styles.panelFill : ''} ${dropCellClassName(isAnyDragOver)}`}
      onDragOver={onExternalDragOver}
      onDragLeave={onExternalDragLeave}
      onDrop={onExternalDrop}
    >
      {!hideHeader && (
        <div
          {...(dragHandleProps ?? {})}
          className={`${styles.header} ${dragHandleProps?.className ?? ''}`.trim()}
        >
          {dragHandleIcon}
          <span className={styles.headerTitle}>Taskboard</span>
          <span className={styles.headerCount}>{visibleEntries.length}</span>
        </div>
      )}
      <div ref={listRef} className={styles.list}>
        {visibleEntries.length === 0 ? (
          <>
            {isAnyDragOver && effectiveInsertIndex !== null && <DropIndicator kind="line" />}
            <div className={styles.empty}>
              No tasks queued
              <span className={styles.dropHint}>Drag a task here or right-click to add</span>
            </div>
          </>
        ) : (
          <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
            {visibleEntries.map((entry, i) => {
              const todo = todoMap.get(entry.todoId)
              if (!todo) return null
              return (
                <Fragment key={entry.todoId}>
                  {effectiveInsertIndex === i && <DropIndicator kind="line" />}
                  <SortableEntry
                    panelId={droppableId}
                    index={i}
                    todo={todo}
                    assignedPeople={assignedPeopleMap.get(todo.id)}
                    onOpenDetail={handleOpenDetail}
                  />
                </Fragment>
              )
            })}
            {effectiveInsertIndex === visibleEntries.length && <DropIndicator kind="line" />}
          </SortableContext>
        )}
      </div>
    </div>
  )
}
