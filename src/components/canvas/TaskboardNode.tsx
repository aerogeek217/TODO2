import { Fragment, memo, useMemo, useCallback, useState, useRef, useEffect } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import { useDroppable, useDndMonitor, type DragMoveEvent } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PersistedTodoItem, Person, FloatingTaskboard, TaskboardEntry } from '../../models'
import type { SlotKind } from '../../models/canvas-rails'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { useCanvasStore } from '../../stores/canvas-store'
import { useFloatingTaskboardStore } from '../../stores/floating-taskboard-store'
import { useStatusStore } from '../../stores/status-store'
import { TaskRow } from '../task/TaskRow'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { convertFloatingKind } from '../../services/float-kind-switch'
import { useExternalTaskboardDrop } from '../../hooks/use-external-taskboard-drop'
import { computeTaskboardInsertIndex } from '../../utils/taskboard-insert'
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
  entryId, panelId, index, todo, assignedPeople, ghost, onOpenDetail,
}: {
  entryId: string
  panelId: string
  index: number
  todo: PersistedTodoItem
  assignedPeople: Person[] | undefined
  ghost?: boolean
  onOpenDetail?: (todoId: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entryId,
    data: { type: TASK_DRAG_KIND.taskboardTask, todo, entryId, panelId },
  })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} data-tbp-entry data-todo-id={todo.id} className={`${styles.sortableItem} ${isDragging ? styles.dragging : ''}`} {...attributes} {...listeners}>
      <span className={styles.orderNumber}>{index + 1}</span>
      <div className={styles.taskWrapper}>
        <TaskRow todo={todo} assignedPeople={assignedPeople} ghost={ghost} compact onOpenDetail={onOpenDetail} onTaskboard />
      </div>
    </div>
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
  const { getZoom } = useReactFlow()
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  const droppableId = taskboardFloatDropId(floatingId)
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: droppableId,
    data: { type: TASK_DROP_KIND.taskboard, panelId: droppableId },
  })

  const handleChangeKind = useCallback(async (nextKind: SlotKind) => {
    if (nextKind === 'taskboard') return
    const canvasId = useCanvasStore.getState().selectedCanvasId
    if (canvasId == null) return
    const row = useFloatingTaskboardStore.getState().taskboards.find((t) => t.id === floatingId)
    if (!row) return
    await convertFloatingKind({
      sourceKind: 'taskboard',
      sourceId: floatingId,
      canvasId,
      rect: { x: row.x, y: row.y, width, height },
      nextKind,
    })
  }, [floatingId, width, height])

  const [isExternalDragOver, setIsExternalDragOver] = useState(false)
  const [tbInsertIndex, setTbInsertIndex] = useState<number | null>(null)
  const [kindAnchor, setKindAnchor] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => () => { resizeCleanupRef.current?.() }, [])

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

    // Translated-rect center as the Y reference — same source as the drop
    // handler in use-canvas-dnd so indicator + drop stay in lockstep.
    const translated = event.active.rect.current.translated
    const initial = event.active.rect.current.initial
    let pointerY = 0
    if (translated) pointerY = translated.top + translated.height / 2
    else if (initial) pointerY = initial.top + initial.height / 2 + event.delta.y
    setTbInsertIndex(computeTaskboardInsertIndex(droppableId, pointerY))
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

  // Native HTML5 drop path for non-dnd-kit sources (e.g. calendar events).
  const {
    externalInsertIndex,
    isExternalDragOver: isNativeDragOver,
    onDragOver: onExternalDragOver,
    onDragLeave: onExternalDragLeave,
    onDrop: onExternalDrop,
  } = useExternalTaskboardDrop(droppableId)
  const effectiveInsertIndex = tbInsertIndex ?? externalInsertIndex

  return (
    <div
      ref={setDropRef}
      data-taskboard-panel-id={droppableId}
      className={`${styles.node} ${dropCellClassName(isOver || isExternalDragOver || isNativeDragOver)}`}
      style={{ width }}
      onDragOver={onExternalDragOver}
      onDragLeave={onExternalDragLeave}
      onDrop={onExternalDrop}
    >
      <WidgetHeader
        kind="taskboard"
        title="Taskboard"
        meta={visibleEntries.length}
        collapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
        onDock={() => {
          useCanvasRailsStore.getState().createAndDockSlot('taskboard')
          onClose()
        }}
        onClose={onClose}
        onTitleClick={(a) => setKindAnchor(a)}
        titleMenuOpen={kindAnchor !== null}
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
                    entryId={taskDragId('taskboard-float', entry.todoId, { floatingId })}
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

      <div
        className={`${styles.resizeHandle} nopan nodrag`}
        onMouseDown={(e) => {
          e.stopPropagation()
          const startX = e.clientX
          const startW = width
          const zoom = getZoom()
          const nodeEl = (e.currentTarget as HTMLElement).closest('.react-flow__node')
          const nodeDiv = nodeEl?.querySelector('.' + styles.node) as HTMLElement | null

          const onMouseMove = (ev: MouseEvent) => {
            const newW = Math.max(220, startW + (ev.clientX - startX) / zoom)
            if (nodeDiv) {
              nodeDiv.style.width = `${newW}px`
            }
          }

          const onMouseUp = (ev: MouseEvent) => {
            const newW = Math.max(220, startW + (ev.clientX - startX) / zoom)
            onResize?.(newW, height)
            cleanup()
          }

          const cleanup = () => {
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            resizeCleanupRef.current = null
          }
          resizeCleanupRef.current = cleanup
          window.addEventListener('mousemove', onMouseMove)
          window.addEventListener('mouseup', onMouseUp)
        }}
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
