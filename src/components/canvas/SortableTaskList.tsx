import { useMemo, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable'
import type { PersistedTodoItem, Person, Tag } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { TaskRow } from '../task/TaskRow'
import { buildHierarchy } from '../../utils/hierarchy'
import { DragInsertContext } from './DragInsertContext'
import { InsertTrigger } from './InsertTrigger'
import { CanvasContextMenu, type ContextMenuItem } from '../overlays/CanvasContextMenu'
import { pasteTasksAt } from '../../services/clipboard'
import styles from './SortableTaskList.module.css'

interface SortableTaskListProps {
  projectId: number
  todos: PersistedTodoItem[]
  assignedPeopleMap?: Map<number, Person[]>
  assignedTagsMap?: Map<number, Tag[]>
  ghostTodoIds?: Set<number>
  onOpenDetail?: (todoId: number) => void
  onInsertTask?: (title: string, beforeTodoId: number | null, parentId: number | undefined) => Promise<number>
}

function SortableTaskRow({
  todo,
  assignedPeople,
  assignedTags,
  indentLevel,
  hasChildren,
  isExpanded,
  isSelected,
  ghost,
  cut,
  disabledDrop,
  onSelect,
  onToggleExpand,
  onOpenDetail,
}: {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  assignedTags?: Tag[]
  indentLevel?: number
  hasChildren?: boolean
  isExpanded?: boolean
  isSelected?: boolean
  ghost?: boolean
  cut?: boolean
  disabledDrop?: boolean
  onSelect?: (todoId: number, mods: { shift: boolean; ctrl: boolean }) => void
  onToggleExpand?: (todoId: number) => void
  onOpenDetail?: (todoId: number) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useSortable({
    id: `todo-${todo.id}`,
    data: { type: 'task', todo },
    disabled: disabledDrop,
  })

  if (isDragging) {
    return (
      <div ref={setNodeRef} style={{ outline: 'none' }} {...attributes} {...listeners}>
        <div className={styles.dragPlaceholder} />
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={{ outline: 'none' }} {...attributes} {...listeners}>
      <TaskRow
        todo={todo}
        assignedPeople={assignedPeople}
        assignedTags={assignedTags}
        indentLevel={indentLevel}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        isSelected={isSelected}
        ghost={ghost}
        cut={cut}
        onSelect={onSelect}
        onToggleExpand={onToggleExpand}
        onOpenDetail={onOpenDetail}
        compact
      />
    </div>
  )
}

/** Sentinel id for the "before first item" InsertTrigger. */
const BEFORE_FIRST = -1

export function SortableTaskList({
  projectId,
  todos,
  assignedPeopleMap,
  assignedTagsMap,
  ghostTodoIds,
  onOpenDetail,
  onInsertTask,
}: SortableTaskListProps) {
  const { insertTodoId: insertBeforeTodoId, insertIndentLevel, insertAtEnd, insertProjectId, activeDragTodoId, dragGroupIds } = useContext(DragInsertContext)
  const isDragActive = activeDragTodoId != null
  const { collapsedParents, toggleCollapseParent, selectedTodoIds, focusedTodoId, selectOneTodo, toggleSelectTodo, rangeSelectTodo, inlineCreateAfterId, clearInlineCreate, clipboardTodoIds } = useUIStore()
  const hierarchy = useMemo(() => buildHierarchy(todos), [todos])

  // Which InsertTrigger is currently open (keyed by the todo id it follows, or BEFORE_FIRST)
  const [activeInsertAfterId, setActiveInsertAfterId] = useState<number | null>(null)
  const closeInsert = useCallback(() => { setActiveInsertAfterId(null); clearInlineCreate() }, [clearInlineCreate])

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  // Respond to hotkey-triggered inline create from ui-store
  useEffect(() => {
    if (inlineCreateAfterId != null && todos.some(t => t.id === inlineCreateAfterId)) {
      setActiveInsertAfterId(inlineCreateAfterId)
      clearInlineCreate()
    }
  }, [inlineCreateAfterId, todos, clearInlineCreate])

  // Build flat visible list for sortable context
  const visibleItems: { todo: PersistedTodoItem; indentLevel: number; hasChildren: boolean; isExpanded: boolean }[] = []
  for (const { parent, children } of hierarchy) {
    const hasChildren = children.length > 0
    const isExpanded = !collapsedParents.has(parent.id)
    visibleItems.push({ todo: parent, indentLevel: 0, hasChildren, isExpanded })
    if (hasChildren && isExpanded) {
      for (const child of children) {
        visibleItems.push({ todo: child, indentLevel: 1, hasChildren: false, isExpanded: false })
      }
    }
  }

  const items = visibleItems.map((v) => `todo-${v.todo.id}`)

  // Stable refs for ordered IDs (used in range-select without recreating callback)
  const visibleIdsRef = useRef<number[]>([])
  visibleIdsRef.current = visibleItems.map(v => v.todo.id)

  // Stable callbacks shared across all rows
  const handleSelect = useCallback((todoId: number, mods: { shift: boolean; ctrl: boolean }) => {
    if (mods.shift) {
      rangeSelectTodo(todoId, visibleIdsRef.current)
    } else if (mods.ctrl) {
      toggleSelectTodo(todoId)
    } else {
      selectOneTodo(todoId)
    }
  }, [rangeSelectTodo, toggleSelectTodo, selectOneTodo])

  const handleToggleExpand = useCallback((todoId: number) => {
    toggleCollapseParent(todoId)
  }, [toggleCollapseParent])

  /** Build context menu for a paste target position */
  const buildPasteMenu = (e: React.MouseEvent, beforeTodoId: number | null, parentId: number | undefined) => {
    const { clipboardTodoIds: cbIds, selectedTodoIds: selIds } = useUIStore.getState()
    const menuItems: ContextMenuItem[] = []
    if (selIds.size > 0) {
      const label = selIds.size === 1 ? 'Cut' : `Cut ${selIds.size} tasks`
      menuItems.push({
        label,
        action: () => {
          const first = todos.find(t => selIds.has(t.id))
          useUIStore.getState().cutTasks(Array.from(selIds), first?.projectId ?? null)
        },
      })
    }
    if (cbIds.length > 0) {
      const label = cbIds.length === 1 ? 'Paste' : `Paste ${cbIds.length} tasks`
      menuItems.push({
        label,
        action: () => { pasteTasksAt({ projectId, parentId, beforeTodoId }) },
      })
    }
    if (menuItems.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems })
    }
  }

  /** Compute the insert position (parentId, beforeId) for a trigger after visibleItems[idx] */
  const getInsertPosition = (idx: number) => {
    const item = visibleItems[idx]
    const parentId = item.indentLevel > 0 ? (item.todo.parentId ?? undefined) : undefined
    let beforeId: number | null = null
    if (parentId != null) {
      for (let i = idx + 1; i < visibleItems.length; i++) {
        if (visibleItems[i].todo.parentId === parentId) { beforeId = visibleItems[i].todo.id; break }
        if (visibleItems[i].indentLevel === 0) break
      }
    } else {
      for (let i = idx + 1; i < visibleItems.length; i++) {
        if (visibleItems[i].indentLevel === 0) { beforeId = visibleItems[i].todo.id; break }
      }
    }
    return { parentId, beforeId }
  }

  /** Handle paste for a given insert position */
  const handlePasteAt = (beforeTodoId: number | null, parentId: number | undefined) => {
    if (clipboardTodoIds.length > 0) {
      pasteTasksAt({ projectId, parentId, beforeTodoId })
    }
  }

  const clipboardSet = useMemo(() => new Set(clipboardTodoIds), [clipboardTodoIds])

  return (
    <SortableContext items={items}>
      <div style={isDragActive ? { pointerEvents: 'none' } : undefined}>
      {visibleItems.map((item, idx) => {
        const isDragging = activeDragTodoId === item.todo.id
        const isSel = !isDragging && selectedTodoIds.has(item.todo.id)
        const isFocused = !isDragging && item.todo.id === focusedTodoId
        const isMultiSelect = selectedTodoIds.size > 1
        const prevSel = idx > 0 && selectedTodoIds.has(visibleItems[idx - 1].todo.id) && activeDragTodoId !== visibleItems[idx - 1].todo.id
        const nextSel = idx < visibleItems.length - 1 && selectedTodoIds.has(visibleItems[idx + 1].todo.id) && activeDragTodoId !== visibleItems[idx + 1].todo.id
        const selCls = isSel
          ? `${styles.sel} ${!prevSel ? styles.selFirst : ''} ${!nextSel ? styles.selLast : ''}`
          : ''
        const showFocused = isFocused && !(isSel && isMultiSelect)
        const cls = `${selCls} ${showFocused ? styles.focused : ''}`.trim() || undefined
        return (
        <div key={item.todo.id} className={cls} onContextMenu={(e) => buildPasteMenu(e, item.todo.id, item.todo.parentId ?? undefined)}>
          {insertBeforeTodoId === item.todo.id && (
            <div className={`${styles.dropPreview} ${insertIndentLevel > 0 ? styles.dropPreviewChild : ''}`} />
          )}
          {!isDragActive && onInsertTask && idx === 0 && item.indentLevel === 0 && (
            <InsertTrigger
              editing={activeInsertAfterId === BEFORE_FIRST}
              onActivate={() => setActiveInsertAfterId(BEFORE_FIRST)}
              onCommit={async (title) => {
                const newId = await onInsertTask(title, item.todo.id, undefined)
                setActiveInsertAfterId(newId)
              }}
              onCancel={closeInsert}
              onContextMenu={(e) => buildPasteMenu(e, item.todo.id, undefined)}
              onPasteFromClipboard={clipboardTodoIds.length > 0 ? () => { handlePasteAt(item.todo.id, undefined); closeInsert() } : undefined}
            />
          )}
          <SortableTaskRow
            todo={item.todo}
            assignedPeople={assignedPeopleMap?.get(item.todo.id)}
            assignedTags={assignedTagsMap?.get(item.todo.id)}
            indentLevel={item.indentLevel}
            hasChildren={item.hasChildren}
            isExpanded={item.isExpanded}
            isSelected={isSel}
            ghost={ghostTodoIds?.has(item.todo.id)}
            cut={clipboardSet.has(item.todo.id)}
            disabledDrop={dragGroupIds?.has(item.todo.id)}
            onSelect={handleSelect}
            onToggleExpand={item.hasChildren ? handleToggleExpand : undefined}
            onOpenDetail={onOpenDetail}
          />
          {!isDragActive && onInsertTask && (() => {
            const { parentId, beforeId } = getInsertPosition(idx)
            return (
              <InsertTrigger
                editing={activeInsertAfterId === item.todo.id}
                onActivate={() => setActiveInsertAfterId(item.todo.id)}
                onCommit={async (title) => {
                  const newId = await onInsertTask(title, beforeId, parentId)
                  setActiveInsertAfterId(newId)
                }}
                onCancel={closeInsert}
                onContextMenu={(e) => buildPasteMenu(e, beforeId, parentId)}
                onPasteFromClipboard={clipboardTodoIds.length > 0 ? () => { handlePasteAt(beforeId, parentId); closeInsert() } : undefined}
              />
            )
          })()}
        </div>
        )
      })}
      {insertAtEnd && !insertBeforeTodoId && insertProjectId === projectId && <div className={styles.dropPreview} />}
      </div>
      {contextMenu && createPortal(
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />,
        document.body,
      )}
    </SortableContext>
  )
}
