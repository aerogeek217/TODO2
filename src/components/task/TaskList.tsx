import { useMemo, useCallback, useRef } from 'react'
import type { PersistedTodoItem, Person } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { bySortOrder } from '../../utils/sort-order'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { TaskRow } from './TaskRow'
import { MobileTaskRow } from './MobileTaskRow'
import { TaskDraggable } from './dnd/TaskDraggable'
import styles from './TaskList.module.css'

interface TaskListProps {
  todos: PersistedTodoItem[]
  assignedPeopleMap?: Map<number, Person[]>
  draggable?: boolean
  sectionKey?: string
  /** Index in the flat visual list where the drop indicator should appear, or undefined to hide */
  dropIndicatorIndex?: number
  /** Optional comparator to order todos (defaults to sortOrder) */
  rootComparator?: (a: PersistedTodoItem, b: PersistedTodoItem) => number
  onOpenDetail?: (todoId: number) => void
}


function DraggableRow({
  todo,
  sectionKey,
  children,
}: {
  todo: PersistedTodoItem
  sectionKey: string
  children: React.ReactNode
}) {
  return (
    <TaskDraggable todo={todo} surface="list" extraData={{ sectionKey }}>
      {({ attributes, listeners, setNodeRef, isDragging }) => (
        <div ref={setNodeRef} {...attributes} {...listeners}>
          {isDragging ? <div className={styles.dragPlaceholder} /> : children}
        </div>
      )}
    </TaskDraggable>
  )
}

export function TaskList({
  todos,
  assignedPeopleMap,
  draggable,
  sectionKey,
  dropIndicatorIndex,
  rootComparator,
  onOpenDetail,
}: TaskListProps) {
  const { selectedTodoIds, focusedTodoId, selectOneTodo, toggleSelectTodo, rangeSelectTodo, clipboardTodoIds } = useUIStore()
  const isMobile = useIsMobile()
  const RowComponent = isMobile ? MobileTaskRow : TaskRow

  const clipboardSet = useMemo(() => new Set(clipboardTodoIds), [clipboardTodoIds])

  const sortedTodos = useMemo(
    () => [...todos].sort(rootComparator ?? bySortOrder),
    [todos, rootComparator],
  )

  const orderedIds = sortedTodos.map(t => t.id)
  const orderedIdsRef = useRef(orderedIds)
  orderedIdsRef.current = orderedIds

  // Stable callbacks — identity doesn't change between renders
  const handleSelect = useCallback((todoId: number, mods: { shift: boolean; ctrl: boolean }) => {
    if (mods.shift) {
      rangeSelectTodo(todoId, orderedIdsRef.current)
    } else if (mods.ctrl) {
      toggleSelectTodo(todoId)
    } else {
      selectOneTodo(todoId)
    }
  }, [rangeSelectTodo, toggleSelectTodo, selectOneTodo])

  return (
    <>
      {sortedTodos.map((todo, idx) => {
        const isSel = selectedTodoIds.has(todo.id)
        const isFocused = todo.id === focusedTodoId
        const isMultiSelect = selectedTodoIds.size > 1
        const prevSel = idx > 0 && selectedTodoIds.has(sortedTodos[idx - 1].id)
        const nextSel = idx < sortedTodos.length - 1 && selectedTodoIds.has(sortedTodos[idx + 1].id)
        const selCls = isSel
          ? `${styles.sel} ${!prevSel ? styles.selFirst : ''} ${!nextSel ? styles.selLast : ''}`
          : ''
        const showFocused = isFocused && !(isSel && isMultiSelect)
        const cls = `${selCls} ${showFocused ? styles.focused : ''}`.trim() || undefined

        const row = (
          <RowComponent
            todo={todo}
            assignedPeople={assignedPeopleMap?.get(todo.id)}
            isSelected={isSel}
            cut={clipboardSet.has(todo.id)}
            onSelect={handleSelect}
            onOpenDetail={onOpenDetail}
          />
        )

        return (
          <div key={todo.id}>
            {dropIndicatorIndex === idx && <div className={styles.dropIndicator} />}
            <div className={cls}>
              {!isMobile && draggable && sectionKey ? (
                <DraggableRow todo={todo} sectionKey={sectionKey}>
                  {row}
                </DraggableRow>
              ) : row}
            </div>
          </div>
        )
      })}
      {dropIndicatorIndex != null && dropIndicatorIndex >= sortedTodos.length && <div className={styles.dropIndicator} />}
    </>
  )
}
