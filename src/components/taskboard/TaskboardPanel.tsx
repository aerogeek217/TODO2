import { useCallback, useMemo, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
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
import { useTagStore } from '../../stores/tag-store'
import { useUIStore } from '../../stores/ui-store'
import { TaskRow } from '../task/TaskRow'
import type { PersistedTodoItem } from '../../models'
import styles from './TaskboardPanel.module.css'

interface SortableEntryProps {
  entryId: number
  index: number
  todo: PersistedTodoItem
  assignedPeople: import('../../models').Person[] | undefined
  assignedTags: import('../../models').Tag[] | undefined
  onRemove: (todoId: number) => void
  onOpenDetail: (todoId: number) => void
}

function SortableEntry({ entryId, index, todo, assignedPeople, assignedTags, onRemove, onOpenDetail }: SortableEntryProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entryId })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} className={`${styles.sortableItem} ${isDragging ? styles.dragging : ''}`} {...attributes} {...listeners}>
      <span className={styles.orderNumber}>{index + 1}</span>
      <div className={styles.taskWrapper}>
        <TaskRow todo={todo} assignedPeople={assignedPeople} assignedTags={assignedTags} compact onOpenDetail={onOpenDetail} />
      </div>
      <button className={styles.removeBtn} onClick={(e) => { e.stopPropagation(); onRemove(todo.id) }} title="Remove from taskboard">&times;</button>
    </div>
  )
}

export function TaskboardPanel() {
  const { entries, remove, reorder } = useTaskboardStore()
  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const { openEditPopup } = useUIStore()
  const [reorderKey, setReorderKey] = useState(0)

  const todoMap = useMemo(() => {
    const map = new Map<number, PersistedTodoItem>()
    for (const t of todos) map.set(t.id, t)
    return map
  }, [todos])

  const visibleEntries = useMemo(
    () => entries.filter(e => { const t = todoMap.get(e.todoId); return t && !t.isCompleted }),
    [entries, todoMap],
  )

  const entryIds = useMemo(() => visibleEntries.map(e => e.id!), [visibleEntries])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = visibleEntries.findIndex(e => e.id === active.id)
    const toIndex = visibleEntries.findIndex(e => e.id === over.id)
    if (fromIndex !== -1 && toIndex !== -1) {
      reorder(fromIndex, toIndex)
      setReorderKey(k => k + 1)
    }
  }, [visibleEntries, reorder])

  const handleRemove = useCallback((todoId: number) => { remove(todoId) }, [remove])
  const handleOpenDetail = useCallback((todoId: number) => { openEditPopup(todoId) }, [openEditPopup])

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Taskboard</span>
        <span className={styles.headerCount}>{visibleEntries.length}</span>
      </div>
      <div className={styles.list}>
        {visibleEntries.length === 0 ? (
          <div className={styles.empty}>
            No tasks queued
            <span className={styles.dropHint}>Right-click a task to add it</span>
          </div>
        ) : (
          <DndContext key={reorderKey} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
              {visibleEntries.map((entry, i) => {
                const todo = todoMap.get(entry.todoId)
                if (!todo) return null
                return (
                  <SortableEntry
                    key={entry.id}
                    entryId={entry.id!}
                    index={i}
                    todo={todo}
                    assignedPeople={assignedPeopleMap.get(todo.id)}
                    assignedTags={assignedTagsMap.get(todo.id)}
                    onRemove={handleRemove}
                    onOpenDetail={handleOpenDetail}
                  />
                )
              })}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  )
}
