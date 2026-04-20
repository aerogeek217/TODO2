import type React from 'react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDndMonitor,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { useFilterStore } from '../../stores/filter-store'
import { useUIStore } from '../../stores/ui-store'
import { TaskRow } from '../task/TaskRow'
import type { PersistedTodoItem, TaskboardEntry } from '../../models'
import { computeTaskboardInsertIndex } from '../../utils/taskboard-insert'
import styles from './TaskboardPanel.module.css'

interface SortableEntryProps {
  entryId: string
  index: number
  todo: PersistedTodoItem
  assignedPeople: import('../../models').Person[] | undefined
  taskboardId: number
  onOpenDetail: (todoId: number) => void
}

function SortableEntry({ entryId, index, todo, assignedPeople, taskboardId, onOpenDetail }: SortableEntryProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entryId })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} data-tbp-entry className={`${styles.sortableItem} ${isDragging ? styles.dragging : ''}`} {...attributes} {...listeners}>
      <span className={styles.orderNumber}>{index + 1}</span>
      <div className={styles.taskWrapper}>
        <TaskRow todo={todo} assignedPeople={assignedPeople} compact onOpenDetail={onOpenDetail} taskboardId={taskboardId} />
      </div>
    </div>
  )
}

type HeaderDragProps = React.HTMLAttributes<HTMLDivElement>

interface TaskboardPanelProps {
  /** When omitted, falls back to the store's defaultBoardId (seeding one if needed). */
  taskboardId?: number
  dragHandleIcon?: ReactNode
  dragHandleProps?: HeaderDragProps
  /** Hide the panel's own "Taskboard" header — used when a caller (e.g. a rail slot) already renders its own chrome. */
  hideHeader?: boolean
}

export function TaskboardPanel({ taskboardId, dragHandleIcon, dragHandleProps, hideHeader }: TaskboardPanelProps = {}) {
  const boards = useTaskboardStore((s) => s.boards)
  const defaultBoardId = useTaskboardStore((s) => s.defaultBoardId)
  const ensureDefault = useTaskboardStore((s) => s.ensureDefault)
  const reorder = useTaskboardStore((s) => s.reorder)
  const removeEntry = useTaskboardStore((s) => s.removeEntry)
  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const statuses = useStatusStore((s) => s.statuses)
  const showCompleted = useFilterStore((s) => s.filters.showCompleted)
  const showHiddenStatuses = useFilterStore((s) => s.filters.showHiddenStatuses)
  const { openEditPopup } = useUIStore()
  const [reorderKey, setReorderKey] = useState(0)

  const resolvedId = taskboardId ?? defaultBoardId
  useEffect(() => {
    if (taskboardId == null && defaultBoardId == null) {
      void ensureDefault()
    }
  }, [taskboardId, defaultBoardId, ensureDefault])

  const entries: TaskboardEntry[] = useMemo(
    () => (resolvedId != null ? boards.get(resolvedId)?.entries ?? [] : []),
    [boards, resolvedId],
  )

  const droppableId = resolvedId != null ? `dashboard-taskboard-drop-${resolvedId}` : 'dashboard-taskboard-drop'
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: droppableId,
    data: { type: 'taskboard', taskboardId: resolvedId },
  })
  const listRef = useRef<HTMLDivElement | null>(null)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)

  // Track external drags (not taskboard-task reorders) over the panel so we
  // can surface an insertion line. Mirrors TaskboardNode's behaviour — the
  // panel has its own nested DndContext for reorder, so entry rects are
  // resolved from the DOM via `data-tbp-entry` attributes.
  const onDragMove = useCallback((event: DragMoveEvent) => {
    const activeType = event.active.data.current?.type
    if (activeType === 'taskboard-task') { setInsertIndex(null); return }
    if (!isOver) { setInsertIndex(null); return }
    const translated = event.active.rect.current.translated
    const pointerY = translated ? translated.top + translated.height / 2 : 0
    setInsertIndex(computeTaskboardInsertIndex(droppableId, pointerY))
  }, [isOver, droppableId])

  const onDragClear = useCallback(() => { setInsertIndex(null) }, [])
  useDndMonitor({ onDragMove, onDragEnd: onDragClear, onDragCancel: onDragClear })

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

  const entryIds = useMemo(() => visibleEntries.map((e) => `tbp-${e.todoId}`), [visibleEntries])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (resolvedId == null) return
    const { active, over } = event
    const fromIndex = entries.findIndex((e) => `tbp-${e.todoId}` === active.id)
    if (fromIndex === -1) return
    // Dropped outside any sortable → remove from the board
    if (!over) {
      void removeEntry(resolvedId, entries[fromIndex].todoId)
      setReorderKey((k) => k + 1)
      return
    }
    if (active.id === over.id) return
    const toIndex = entries.findIndex((e) => `tbp-${e.todoId}` === over.id)
    if (toIndex !== -1) {
      reorder(resolvedId, fromIndex, toIndex)
      setReorderKey((k) => k + 1)
    }
  }, [entries, reorder, removeEntry, resolvedId])

  const handleOpenDetail = useCallback((todoId: number) => { openEditPopup(todoId) }, [openEditPopup])

  return (
    <div
      ref={setDropRef}
      data-taskboard-panel-id={droppableId}
      className={`${styles.panel} ${hideHeader ? styles.panelFill : ''} ${isOver ? styles.dropTarget : ''}`}
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
            {isOver && insertIndex !== null && <div className={styles.dropPreview} />}
            <div className={styles.empty}>
              No tasks queued
              <span className={styles.dropHint}>Drag a task here or right-click to add</span>
            </div>
          </>
        ) : (
          <DndContext key={reorderKey} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
              {visibleEntries.map((entry, i) => {
                const todo = todoMap.get(entry.todoId)
                if (!todo || resolvedId == null) return null
                return (
                  <Fragment key={entry.todoId}>
                    {insertIndex === i && <div className={styles.dropPreview} />}
                    <SortableEntry
                      entryId={`tbp-${entry.todoId}`}
                      index={i}
                      todo={todo}
                      assignedPeople={assignedPeopleMap.get(todo.id)}
                      taskboardId={resolvedId}
                      onOpenDetail={handleOpenDetail}
                    />
                  </Fragment>
                )
              })}
              {insertIndex === visibleEntries.length && <div className={styles.dropPreview} />}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  )
}
