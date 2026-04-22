import { useMemo, useCallback, useRef } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { PersistedTodoItem, Person } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { buildHierarchy, expandWithGhostParents } from '../../utils/hierarchy'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { TaskRow } from './TaskRow'
import { MobileTaskRow } from './MobileTaskRow'
import styles from './TaskList.module.css'

interface TaskListProps {
  todos: PersistedTodoItem[]
  assignedPeopleMap?: Map<number, Person[]>
  ghostIds?: Set<number>
  draggable?: boolean
  sectionKey?: string
  /** Index in the flat visual list where the drop indicator should appear, or undefined to hide */
  dropIndicatorIndex?: number
  /** Optional comparator to order root todos (defaults to sortOrder) */
  rootComparator?: (a: PersistedTodoItem, b: PersistedTodoItem) => number
  /**
   * Unfiltered scope (e.g. all todos). When provided, parents missing from
   * `todos` but referenced by visible children are re-injected as ghost rows
   * so the hierarchy in `todos` matches the data model.
   */
  allTodos?: PersistedTodoItem[]
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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `list-todo-${todo.id}`,
    data: { type: 'list-task', todo, sectionKey },
  })

  if (isDragging) {
    return (
      <div ref={setNodeRef} {...attributes} {...listeners}>
        <div className={styles.dragPlaceholder} />
      </div>
    )
  }

  return (
    <div ref={setNodeRef} {...attributes} {...listeners}>
      {children}
    </div>
  )
}

export function TaskList({
  todos,
  assignedPeopleMap,
  ghostIds,
  draggable,
  sectionKey,
  dropIndicatorIndex,
  rootComparator,
  allTodos,
  onOpenDetail,
}: TaskListProps) {
  const { selectedTodoIds, focusedTodoId, selectOneTodo, toggleSelectTodo, rangeSelectTodo, clipboardTodoIds } = useUIStore()
  const isMobile = useIsMobile()
  const RowComponent = isMobile ? MobileTaskRow : TaskRow

  const clipboardSet = useMemo(() => new Set(clipboardTodoIds), [clipboardTodoIds])

  // Inject ghost parents for children whose real parent is filtered out of
  // `todos`. Merge the resulting ghost ids into the caller's ghostIds so the
  // TaskRow renders them dimmed + non-interactive.
  const { expandedTodos, mergedGhostIds } = useMemo(() => {
    if (!allTodos) return { expandedTodos: todos, mergedGhostIds: ghostIds }
    const { todos: expanded, ghostIds: hiddenParents } = expandWithGhostParents(todos, allTodos)
    if (hiddenParents.size === 0) return { expandedTodos: todos, mergedGhostIds: ghostIds }
    const merged = new Set(ghostIds)
    for (const id of hiddenParents) merged.add(id)
    return { expandedTodos: expanded, mergedGhostIds: merged }
  }, [todos, allTodos, ghostIds])

  const hierarchy = useMemo(() => buildHierarchy(expandedTodos, rootComparator), [expandedTodos, rootComparator])

  // Flatten hierarchy into a visible list so each row is a direct sibling (for CSS selection rectangle)
  const flatItems: { todo: PersistedTodoItem; assignedPeople?: Person[]; indentLevel: number; hasChildren: boolean; isLastChild: boolean; isExpanded: boolean }[] = []
  for (const { parent, children } of hierarchy) {
    const hasChildren = children.length > 0
    const isExpanded = true
    flatItems.push({ todo: parent, assignedPeople: assignedPeopleMap?.get(parent.id), indentLevel: 0, hasChildren, isLastChild: false, isExpanded })
    if (hasChildren && isExpanded) {
      children.forEach((child, i) => {
        flatItems.push({
          todo: child,
          assignedPeople: assignedPeopleMap?.get(child.id),
          indentLevel: 1,
          hasChildren: false,
          isLastChild: i === children.length - 1,
          isExpanded: false,
        })
      })
    }
  }

  const orderedIds = flatItems.map(item => item.todo.id)
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
      {flatItems.map((item, idx) => {
        const isSel = selectedTodoIds.has(item.todo.id)
        const isFocused = item.todo.id === focusedTodoId
        const isMultiSelect = selectedTodoIds.size > 1
        const prevSel = idx > 0 && selectedTodoIds.has(flatItems[idx - 1].todo.id)
        const nextSel = idx < flatItems.length - 1 && selectedTodoIds.has(flatItems[idx + 1].todo.id)
        const selCls = isSel
          ? `${styles.sel} ${!prevSel ? styles.selFirst : ''} ${!nextSel ? styles.selLast : ''}`
          : ''
        const showFocused = isFocused && !(isSel && isMultiSelect)
        const cls = `${selCls} ${showFocused ? styles.focused : ''}`.trim() || undefined

        const row = (
          <RowComponent
            todo={item.todo}
            assignedPeople={item.assignedPeople}
            indentLevel={item.indentLevel}
            hasChildren={item.hasChildren}
            isLastChild={item.isLastChild}
            isSelected={isSel}
            ghost={mergedGhostIds?.has(item.todo.id)}
            cut={clipboardSet.has(item.todo.id)}
            onSelect={handleSelect}
            onOpenDetail={onOpenDetail}
          />
        )

        return (
          <div key={item.todo.id}>
            {dropIndicatorIndex === idx && <div className={styles.dropIndicator} />}
            <div className={cls}>
              {!isMobile && draggable && sectionKey ? (
                <DraggableRow todo={item.todo} sectionKey={sectionKey}>
                  {row}
                </DraggableRow>
              ) : row}
            </div>
          </div>
        )
      })}
      {dropIndicatorIndex != null && dropIndicatorIndex >= flatItems.length && <div className={styles.dropIndicator} />}
    </>
  )
}
