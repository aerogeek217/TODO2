import { useMemo, useContext, useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable'
import type { PersistedTodoItem, Person } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { TaskRow } from '../task/TaskRow'
import { buildHierarchy } from '../../utils/hierarchy'
import { DragInsertContext, DragPreviewContext } from './DragInsertContext'
import { InsertTrigger } from './InsertTrigger'
import { CanvasContextMenu, type ContextMenuItem } from '../overlays/CanvasContextMenu'
import { pasteTasksAt } from '../../services/clipboard'
import styles from './SortableTaskList.module.css'

interface SortableTaskListProps {
  projectId: number
  todos: PersistedTodoItem[]
  assignedPeopleMap?: Map<number, Person[]>
  ghostTodoIds?: Set<number>
  onOpenDetail?: (todoId: number) => void
  onInsertTask?: (title: string, beforeTodoId: number | null, parentId: number | undefined) => Promise<number>
}

function SortableTaskRow({
  todo,
  assignedPeople,
  indentLevel,
  hasChildren,
  isSelected,
  ghost,
  cut,
  disabledDrop,
  onSelect,
  onOpenDetail,
}: {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  indentLevel?: number
  hasChildren?: boolean
  isSelected?: boolean
  ghost?: boolean
  cut?: boolean
  disabledDrop?: boolean
  onSelect?: (todoId: number, mods: { shift: boolean; ctrl: boolean }) => void
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
    disabled: disabledDrop || ghost,
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
        indentLevel={indentLevel}
        hasChildren={hasChildren}
        isSelected={isSelected}
        ghost={ghost}
        cut={cut}
        onSelect={onSelect}
        onOpenDetail={onOpenDetail}
        compact
      />
    </div>
  )
}

/** Sentinel id for the "before first item" InsertTrigger. */
const BEFORE_FIRST = -1

/** Matches .dragPlaceholder (28px height + 2px vertical margin) in SortableTaskList.module.css */
const ROW_HEIGHT_PX = 30

export function SortableTaskList({
  projectId,
  todos,
  assignedPeopleMap,
  ghostTodoIds,
  onOpenDetail,
  onInsertTask,
}: SortableTaskListProps) {
  const { activeDragTodoId, dragGroupIds } = useContext(DragInsertContext)
  const { insertTodoId: insertBeforeTodoId, insertIndentLevel, insertAtEnd, insertProjectId } = useContext(DragPreviewContext)
  const isDragActive = activeDragTodoId != null
  const dropCount = isDragActive ? (dragGroupIds?.size ?? 0) + 1 : 1
  const { collapsedParents, selectedTodoIds, focusedTodoId, selectOneTodo, toggleSelectTodo, rangeSelectTodo, inlineCreateAfterId, clearInlineCreate, clipboardTodoIds } = useUIStore()
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
  const visibleItems = useMemo(() => {
    const items: { todo: PersistedTodoItem; indentLevel: number; hasChildren: boolean; isExpanded: boolean }[] = []
    for (const { parent, children } of hierarchy) {
      const hasChildren = children.length > 0
      const isExpanded = !collapsedParents.has(parent.id)
      items.push({ todo: parent, indentLevel: 0, hasChildren, isExpanded })
      if (hasChildren && isExpanded) {
        for (const child of children) {
          items.push({ todo: child, indentLevel: 1, hasChildren: false, isExpanded: false })
        }
      }
    }
    return items
  }, [hierarchy, collapsedParents])

  // During drag: hide children of the actively dragged parent and multi-selected siblings (they're in the overlay)
  const displayItems = useMemo(() => {
    if (!activeDragTodoId) return visibleItems
    return visibleItems.filter(item => {
      if (item.todo.parentId === activeDragTodoId) return false
      if (dragGroupIds && dragGroupIds.has(item.todo.id)) return false
      return true
    })
  }, [visibleItems, activeDragTodoId, dragGroupIds])

  const items = displayItems.map((v) => `todo-${v.todo.id}`)

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

  // ── FLIP animation: animate tasks to new positions after a drop ──
  const containerRef = useRef<HTMLDivElement>(null)
  const prevRectsRef = useRef<Map<number, number>>(new Map())  // todoId → relative top
  const prevOrderRef = useRef<string>('')
  const dropTimestampRef = useRef(0)
  const lastDraggedIdRef = useRef<number | null>(null)
  const wasDragActiveRef = useRef(false)

  // Track which item is being dragged, and when a drop occurs (in useLayoutEffect to avoid concurrent-mode issues)
  useLayoutEffect(() => {
    if (isDragActive && activeDragTodoId != null) {
      lastDraggedIdRef.current = activeDragTodoId
    }
    if (wasDragActiveRef.current && !isDragActive) {
      dropTimestampRef.current = performance.now()
    }
    wasDragActiveRef.current = isDragActive
  }, [isDragActive, activeDragTodoId])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const orderKey = displayItems.map(v => v.todo.id).join(',')
    const orderChanged = orderKey !== prevOrderRef.current
    const isRecentDrop = performance.now() - dropTimestampRef.current < 500

    // Skip expensive rect measurement when no animation is needed
    if (!isRecentDrop && !orderChanged) return

    // Measure current (new) positions before applying any transforms.
    // :scope > avoids TaskRow's inner data-todo-id (we only measure the wrapper).
    const containerTop = container.getBoundingClientRect().top
    const newRects = new Map<number, number>()
    container.querySelectorAll<HTMLElement>(':scope > [data-todo-id]').forEach(el => {
      const id = Number(el.dataset.todoId)
      if (!isNaN(id)) newRects.set(id, el.getBoundingClientRect().top - containerTop)
    })

    const prefersReducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    // Animate on drop when order actually changed
    if (isRecentDrop && orderChanged && prevRectsRef.current.size > 0 && !prefersReducedMotion) {
      dropTimestampRef.current = 0  // consume — don't re-animate
      const draggedId = lastDraggedIdRef.current
      const phantom = document.querySelector<HTMLElement>('[data-drop-phantom]')
      const animating: HTMLElement[] = []
      let phantomDx = 0, phantomDy = 0
      let phantomTargetFound = false

      // Compute scale for coordinate space conversion (React Flow viewport may be zoomed)
      const scale = container.offsetHeight > 0
        ? container.getBoundingClientRect().height / container.offsetHeight
        : 1

      container.querySelectorAll<HTMLElement>(':scope > [data-todo-id]').forEach(el => {
        const id = Number(el.dataset.todoId)

        if (id === draggedId) {
          if (phantom) {
            // Compute phantom → list-item delta for the slide animation
            const elRect = el.getBoundingClientRect()
            const phantomRect = phantom.getBoundingClientRect()
            phantomDx = elRect.left - phantomRect.left
            phantomDy = elRect.top - phantomRect.top
            phantomTargetFound = true
          }
          return
        }

        // Other tasks: FLIP from previous position to new position
        const prevTop = prevRectsRef.current.get(id)
        const newTop = newRects.get(id)
        if (prevTop == null || newTop == null) return
        const dy = (prevTop - newTop) / scale
        if (Math.abs(dy) > 1) {
          el.style.transform = `translateY(${dy}px)`
          animating.push(el)
        }
      })

      requestAnimationFrame(() => {
        // Phantom: slide to target position + fade out (only if this container has the dropped task)
        if (phantom && phantomTargetFound) {
          const tid = phantom.dataset.cleanupTimeout
          if (tid) clearTimeout(Number(tid))
          phantom.style.transition = 'transform var(--transition-spring), opacity var(--transition-spring)'
          phantom.style.transform = `translate(${phantomDx}px, ${phantomDy}px)`
          phantom.style.opacity = '0'
          phantom.addEventListener('transitionend', () => phantom.remove(), { once: true })
          // Safety net: remove phantom if transitionend never fires
          setTimeout(() => { if (phantom.isConnected) phantom.remove() }, 600)
        }

        // Other tasks: slide into new positions
        for (const el of animating) {
          el.style.transition = 'transform var(--transition-spring)'
          el.style.transform = ''
        }
        if (animating.length > 0) {
          const onEnd = () => {
            for (const el of animating) el.style.transition = ''
          }
          animating[0]?.addEventListener('transitionend', onEnd, { once: true })
          // Safety net: if animating[0] unmounts before transitionend, clear transitions on the rest anyway
          setTimeout(onEnd, 600)
        }
      })
    } else if (isRecentDrop && orderChanged && prefersReducedMotion) {
      // Reduced motion: skip animation, remove phantom immediately
      dropTimestampRef.current = 0
      document.querySelector<HTMLElement>('[data-drop-phantom]')?.remove()
    }

    // Save current state for next comparison
    prevRectsRef.current = newRects
    prevOrderRef.current = orderKey
  })

  return (
    <SortableContext items={items}>
      <div ref={containerRef} style={isDragActive ? { pointerEvents: 'none' } : undefined}>
      {displayItems.map((item, idx) => {
        const isDragging = activeDragTodoId === item.todo.id
        const isSel = !isDragging && selectedTodoIds.has(item.todo.id)
        const isFocused = !isDragging && item.todo.id === focusedTodoId
        const isMultiSelect = selectedTodoIds.size > 1
        const prevSel = idx > 0 && selectedTodoIds.has(displayItems[idx - 1].todo.id) && activeDragTodoId !== displayItems[idx - 1].todo.id
        const nextSel = idx < displayItems.length - 1 && selectedTodoIds.has(displayItems[idx + 1].todo.id) && activeDragTodoId !== displayItems[idx + 1].todo.id
        const selCls = isSel
          ? `${styles.sel} ${!prevSel ? styles.selFirst : ''} ${!nextSel ? styles.selLast : ''}`
          : ''
        const showFocused = isFocused && !(isSel && isMultiSelect)
        const cls = `${selCls} ${showFocused ? styles.focused : ''}`.trim() || undefined
        return (
        <div key={item.todo.id} data-todo-id={item.todo.id} className={cls} onContextMenu={(e) => buildPasteMenu(e, item.todo.id, item.todo.parentId ?? undefined)}>
          {insertBeforeTodoId === item.todo.id && (
            dropCount > 1
              ? <div className={`${styles.dropPreviewGroup} ${insertIndentLevel > 0 ? styles.dropPreviewChild : ''}`} style={{ height: `${dropCount * ROW_HEIGHT_PX}px` }} />
              : <div className={`${styles.dropPreview} ${insertIndentLevel > 0 ? styles.dropPreviewChild : ''}`} />
          )}
          {!isDragActive && onInsertTask && idx === 0 && item.indentLevel === 0 && (
            <InsertTrigger
              editing={activeInsertAfterId === BEFORE_FIRST}
              onActivate={() => setActiveInsertAfterId(BEFORE_FIRST)}
              onCommit={async (title) => {
                const newId = await onInsertTask(title, item.todo.id, undefined)
                // Route through ui-store so the useEffect above waits for the new todo to appear in `todos` before opening its trigger
                useUIStore.getState().triggerInlineCreate(newId)
              }}
              onCancel={closeInsert}
              onContextMenu={(e) => buildPasteMenu(e, item.todo.id, undefined)}
              onPasteFromClipboard={clipboardTodoIds.length > 0 ? () => { handlePasteAt(item.todo.id, undefined); closeInsert() } : undefined}
            />
          )}
          <SortableTaskRow
            todo={item.todo}
            assignedPeople={assignedPeopleMap?.get(item.todo.id)}
            indentLevel={item.indentLevel}
            hasChildren={item.hasChildren}
            isSelected={isSel}
            ghost={ghostTodoIds?.has(item.todo.id)}
            cut={clipboardSet.has(item.todo.id)}
            disabledDrop={dragGroupIds?.has(item.todo.id)}
            onSelect={handleSelect}
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
                  useUIStore.getState().triggerInlineCreate(newId)
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
      {displayItems.length === 0 && !isDragActive && onInsertTask && (
        <InsertTrigger
          editing={activeInsertAfterId === BEFORE_FIRST}
          onActivate={() => setActiveInsertAfterId(BEFORE_FIRST)}
          onCommit={async (title) => {
            const newId = await onInsertTask(title, null, undefined)
            useUIStore.getState().triggerInlineCreate(newId)
          }}
          onCancel={closeInsert}
          onContextMenu={(e) => buildPasteMenu(e, null, undefined)}
          onPasteFromClipboard={clipboardTodoIds.length > 0 ? () => { handlePasteAt(null, undefined); closeInsert() } : undefined}
        />
      )}
      {insertAtEnd && !insertBeforeTodoId && insertProjectId === projectId && (
        dropCount > 1
          ? <div className={styles.dropPreviewGroup} style={{ height: `${dropCount * ROW_HEIGHT_PX}px` }} />
          : <div className={styles.dropPreview} />
      )}
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
