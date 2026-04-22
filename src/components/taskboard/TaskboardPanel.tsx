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
import { useExternalTaskboardDrop } from '../../hooks/use-external-taskboard-drop'
import styles from './TaskboardPanel.module.css'

interface SortableEntryProps {
  entryId: string
  panelId: string
  index: number
  todo: PersistedTodoItem
  assignedPeople: import('../../models').Person[] | undefined
  onOpenDetail: (todoId: number) => void
}

function SortableEntry({ entryId, panelId, index, todo, assignedPeople, onOpenDetail }: SortableEntryProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entryId,
    // Route through the canvas-level DndContext so entry drags outside the
    // panel (→ remove) and cross-view drops (→ reorder across dashboard +
    // floating taskboard views of the singleton) reach use-canvas-dnd.
    // `panelId` lets onDragMove + handleDragEnd recognize which panel the
    // entry belongs to without DOM walking.
    data: { type: 'taskboard-task', todo, entryId, panelId },
  })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} data-tbp-entry data-todo-id={todo.id} className={`${styles.sortableItem} ${isDragging ? styles.dragging : ''}`} {...attributes} {...listeners}>
      <span className={styles.orderNumber}>{index + 1}</span>
      <div className={styles.taskWrapper}>
        <TaskRow todo={todo} assignedPeople={assignedPeople} compact onOpenDetail={onOpenDetail} onTaskboard />
      </div>
    </div>
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

  const droppableId = 'dashboard-taskboard-drop'
  const { setNodeRef: setDropRef } = useDroppable({
    id: droppableId,
    data: { type: 'taskboard', panelId: droppableId },
  })
  const listRef = useRef<HTMLDivElement | null>(null)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)
  const [isDndDragOver, setIsDndDragOver] = useState(false)

  // Surface an insertion line for external drags (not taskboard-task reorders)
  // whose `over` is either this panel or one of its sortable entries — entry
  // ids include `panelId` so we can isolate per-panel without leaning on
  // `useDroppable.isOver`, which flips false the moment dnd-kit picks an
  // inner sortable entry as the over target. Pointer Y comes from the
  // dragged-overlay rect center; `use-canvas-dnd.handleDragEnd` reads from
  // the same source so indicator + drop stay in lockstep.
  const onDragMove = useCallback((event: DragMoveEvent) => {
    const activeType = event.active.data.current?.type
    if (activeType === 'taskboard-task') {
      setInsertIndex(null)
      setIsDndDragOver(false)
      return
    }
    const overData = event.over?.data.current
    const overPanelId = overData?.panelId as string | undefined
    const belongs = (overData?.type === 'taskboard' || overData?.type === 'taskboard-task')
      && overPanelId === droppableId
    setIsDndDragOver(belongs)
    if (!belongs) { setInsertIndex(null); return }
    const translated = event.active.rect.current.translated
    const initial = event.active.rect.current.initial
    let pointerY = 0
    if (translated) pointerY = translated.top + translated.height / 2
    else if (initial) pointerY = initial.top + initial.height / 2 + event.delta.y
    setInsertIndex(computeTaskboardInsertIndex(droppableId, pointerY))
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

  const entryIds = useMemo(() => visibleEntries.map((e) => `tbp-${e.todoId}`), [visibleEntries])

  const handleOpenDetail = useCallback((todoId: number) => { openEditPopup(todoId) }, [openEditPopup])

  return (
    <div
      ref={setDropRef}
      data-taskboard-panel-id={droppableId}
      className={`${styles.panel} ${hideHeader ? styles.panelFill : ''} ${isAnyDragOver ? styles.dropTarget : ''}`}
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
            {isAnyDragOver && effectiveInsertIndex !== null && <div className={styles.dropPreview} />}
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
                  {effectiveInsertIndex === i && <div className={styles.dropPreview} />}
                  <SortableEntry
                    entryId={`tbp-${entry.todoId}`}
                    panelId={droppableId}
                    index={i}
                    todo={todo}
                    assignedPeople={assignedPeopleMap.get(todo.id)}
                    onOpenDetail={handleOpenDetail}
                  />
                </Fragment>
              )
            })}
            {effectiveInsertIndex === visibleEntries.length && <div className={styles.dropPreview} />}
          </SortableContext>
        )}
      </div>
    </div>
  )
}
