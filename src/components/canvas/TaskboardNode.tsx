import { memo, useMemo, useCallback, useState, useRef, useEffect } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PersistedTodoItem, Person, Tag } from '../../models'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { TaskRow } from '../task/TaskRow'
import styles from './TaskboardNode.module.css'

export interface TaskboardNodeData {
  entries: import('../../models').TaskboardEntry[]
  allTodos: PersistedTodoItem[]
  assignedPeopleMap: Map<number, Person[]>
  assignedTagsMap?: Map<number, Tag[]>
  ghostTodoIds?: Set<number>
  completedFilter?: string
  assignedFilter?: string
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
  entryId, index, todo, assignedPeople, assignedTags, ghost, onOpenDetail,
}: {
  entryId: number
  index: number
  todo: PersistedTodoItem
  assignedPeople: Person[] | undefined
  assignedTags: Tag[] | undefined
  ghost?: boolean
  onOpenDetail?: (todoId: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entryId })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useTaskboardStore.getState().remove(todo.id)
  }, [todo.id])

  return (
    <div ref={setNodeRef} style={style} className={`${styles.sortableItem} ${isDragging ? styles.dragging : ''}`} {...attributes} {...listeners}>
      <span className={styles.orderNumber}>{index + 1}</span>
      <div className={styles.taskWrapper}>
        <TaskRow todo={todo} assignedPeople={assignedPeople} assignedTags={assignedTags} ghost={ghost} compact onOpenDetail={onOpenDetail} />
      </div>
      <button className={styles.removeBtn} onClick={handleRemove} title="Remove from taskboard">&times;</button>
    </div>
  )
}

function TaskboardNodeInner({ data }: NodeProps & { data: TaskboardNodeType }) {
  const { entries, allTodos, assignedPeopleMap, assignedTagsMap, ghostTodoIds, completedFilter, assignedFilter, onOpenDetail, isCollapsed, onToggleCollapse, onClose, width, height, onResize } = data
  const [reorderKey, setReorderKey] = useState(0)
  const { getZoom } = useReactFlow()
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: 'taskboard-drop',
    data: { type: 'taskboard' },
  })

  useEffect(() => () => { resizeCleanupRef.current?.() }, [])

  const todoMap = useMemo(() => {
    const map = new Map<number, PersistedTodoItem>()
    for (const t of allTodos) map.set(t.id, t)
    return map
  }, [allTodos])

  const visibleEntries = useMemo(
    () => entries.filter(e => {
      const t = todoMap.get(e.todoId)
      if (!t) return false
      if (completedFilter === 'incomplete-only' && t.isCompleted) return false
      if (completedFilter === 'completed' && !t.isCompleted) return false
      if (assignedFilter === 'unassigned-only' && t.isAssigned) return false
      return true
    }),
    [entries, todoMap, completedFilter, assignedFilter],
  )

  const entryIds = useMemo(() => visibleEntries.map(e => e.id!), [visibleEntries])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const allEntries = useTaskboardStore.getState().entries
    const fromIndex = allEntries.findIndex(e => e.id === active.id)
    const toIndex = allEntries.findIndex(e => e.id === over.id)
    if (fromIndex !== -1 && toIndex !== -1) {
      useTaskboardStore.getState().reorder(fromIndex, toIndex)
      setReorderKey(k => k + 1)
    }
  }, [])

  return (
    <div ref={setDropRef} className={`${styles.node} ${isOver ? styles.dropTarget : ''}`} style={{ width }}>
      <div className={styles.titleBar}>
        <button className={`${styles.collapseButton} ${isCollapsed ? styles.collapsed : ''}`} onClick={onToggleCollapse}>&#9662;</button>
        <span className={styles.icon}>&#9776;</span>
        <span className={styles.name}>Taskboard</span>
        <span className={styles.taskCount}>{visibleEntries.length}</span>
        <button className={styles.closeButton} onClick={onClose}>&times;</button>
      </div>

      <div className={`${isCollapsed ? styles.collapsedBody : styles.body} nopan nodrag nowheel`}>
        {visibleEntries.length === 0 ? (
          <div className={styles.emptyMessage}>No tasks queued</div>
        ) : (
          <DndContext key={reorderKey} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
              {visibleEntries.map((entry, i) => {
                const todo = todoMap.get(entry.todoId)
                if (!todo) return null
                return (
                  <SortableTaskboardEntry
                    key={entry.id}
                    entryId={entry.id!}
                    index={i}
                    todo={todo}
                    assignedPeople={assignedPeopleMap.get(todo.id)}
                    assignedTags={assignedTagsMap?.get(todo.id)}
                    ghost={ghostTodoIds?.has(todo.id)}
                    onOpenDetail={onOpenDetail}
                  />
                )
              })}
            </SortableContext>
          </DndContext>
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
    </div>
  )
}

export const TaskboardNode = memo(TaskboardNodeInner)
