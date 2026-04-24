import { useMemo, useContext, useState, useCallback, useEffect, useRef, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SortableContext } from '@dnd-kit/sortable'
import type { PersistedTodoItem, Person, ProjectGroupBy } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { TaskRow } from '../task/TaskRow'
import { SortableTaskDraggable } from '../task/dnd/TaskDraggable'
import { bySortOrder } from '../../utils/sort-order'
import { taskDragId } from '../../utils/task-dnd'
import { DropIndicator } from '../shared/DropIndicator'
import { DragInsertContext, DragPreviewContext } from './DragInsertContext'
import { InsertTrigger } from './InsertTrigger'
import { CanvasContextMenu, type ContextMenuItem } from '../overlays/CanvasContextMenu'
import { pasteTasksAt } from '../../services/clipboard'
import { partitionByGroup } from '../../utils/task-grouping'
import { startOfToday } from '../../utils/date'
import { TaskGroup } from './shared/TaskGroup'
import styles from './SortableTaskList.module.css'

interface SortableTaskListProps {
  projectId: number
  todos: PersistedTodoItem[]
  /** Group dimension. Null/undefined → flat render (single SortableContext). */
  groupBy?: ProjectGroupBy | null
  assignedPeopleMap?: Map<number, Person[]>
  ghostTodoIds?: Set<number>
  onOpenDetail?: (todoId: number) => void
  onInsertTask?: (title: string, beforeTodoId: number | null) => Promise<number>
}

function SortableTaskRow({
  todo,
  assignedPeople,
  isSelected,
  ghost,
  cut,
  disabledDrop,
  onSelect,
  onOpenDetail,
}: {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  isSelected?: boolean
  ghost?: boolean
  cut?: boolean
  disabledDrop?: boolean
  onSelect?: (todoId: number, mods: { shift: boolean; ctrl: boolean }) => void
  onOpenDetail?: (todoId: number) => void
}) {
  return (
    <SortableTaskDraggable
      todo={todo}
      surface="canvas-project"
      disabled={disabledDrop || ghost}
    >
      {({ attributes, listeners, setNodeRef, isDragging }) => (
        <div ref={setNodeRef} style={{ outline: 'none' }} {...attributes} {...listeners}>
          {isDragging ? (
            <div className={styles.dragPlaceholder} />
          ) : (
            <TaskRow
              todo={todo}
              assignedPeople={assignedPeople}
              isSelected={isSelected}
              ghost={ghost}
              cut={cut}
              onSelect={onSelect}
              onOpenDetail={onOpenDetail}
              compact
            />
          )}
        </div>
      )}
    </SortableTaskDraggable>
  )
}

/** Sentinel id for the "before first item" InsertTrigger. */
const BEFORE_FIRST = -1

/** Matches .dragPlaceholder (28px height + 2px vertical margin) in SortableTaskList.module.css */
const ROW_HEIGHT_PX = 30

/** A rendered block: either the ungrouped collection or one named group. */
interface RenderBlock {
  /** Stable React/SortableContext key. `__ungrouped` for the no-header block. */
  key: string
  /** Group label, or null for the ungrouped block (no TaskGroup wrapper). */
  label: string | null
  todos: PersistedTodoItem[]
  /** First todo id of the next block (or null if this is the last block).
   * Used as `beforeId` for the trigger after this block's last row, so
   * insertions land at the boundary without needing a trigger that lives
   * between groups. */
  nextBlockFirstId: number | null
}

export function SortableTaskList({
  projectId,
  todos,
  groupBy,
  assignedPeopleMap,
  ghostTodoIds,
  onOpenDetail,
  onInsertTask,
}: SortableTaskListProps) {
  const { activeDragTodoId, dragSelectionIds } = useContext(DragInsertContext)
  const { insertTodoId: insertBeforeTodoId, insertAtEnd, insertProjectId } = useContext(DragPreviewContext)
  const isDragActive = activeDragTodoId != null
  const dropCount = isDragActive ? (dragSelectionIds?.size ?? 0) + 1 : 1
  const { selectedTodoIds, focusedTodoId, selectOneTodo, toggleSelectTodo, rangeSelectTodo, inlineCreateAfterId, clearInlineCreate, clipboardTodoIds } = useUIStore()

  // Grouping context: read from stores so callers don't need to thread the
  // full ctx through. assignedPeopleMap stays as a prop because callers
  // already pass a per-canvas filtered/stable reference.
  const assignedOrgsMap = useOrgStore((s) => s.assignedOrgsMap)
  const statuses = useStatusStore((s) => s.statuses)
  const today = useMemo(() => startOfToday(), [])

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

  // After Enter-chain insert: open the trigger on the new task.
  // Same-project path sets local state directly so the todos update AND the
  // activeInsertAfterId update land in the SAME render — the new InsertTrigger
  // mounts with editing=true on its first render, autoFocus fires on the
  // input's first DOM insertion (no unmount/mount interleave from a
  // two-render ui-store round-trip, which is harder on real browser focus
  // bookkeeping). Cross-project (NLP /proj redirected the task) falls back
  // to the ui-store path since the target project's useEffect is the only
  // path that can land it there.
  const openTriggerAfterInsert = useCallback((newId: number) => {
    const newTask = useTodoStore.getState().todos.find((t) => t.id === newId)
    if (newTask?.projectId === projectId) setActiveInsertAfterId(newId)
    else useUIStore.getState().triggerInlineCreate(newId)
  }, [projectId])

  // Flat list sorted by sortOrder
  const visibleItems = useMemo(() => [...todos].sort(bySortOrder), [todos])

  // During drag: hide multi-selected siblings (they're in the overlay)
  const displayItems = useMemo(() => {
    if (!activeDragTodoId) return visibleItems
    return visibleItems.filter(item => {
      if (dragSelectionIds && dragSelectionIds.has(item.id)) return false
      return true
    })
  }, [visibleItems, activeDragTodoId, dragSelectionIds])

  // Grouped layout: partition displayItems into ungrouped + named groups.
  // Null when groupBy is unset → flat render path.
  const blocks = useMemo<RenderBlock[] | null>(() => {
    if (!groupBy) return null
    const partition = partitionByGroup(displayItems, groupBy, {
      assignedPeopleMap: assignedPeopleMap ?? new Map(),
      assignedOrgsMap,
      statuses,
      today,
    })
    const out: RenderBlock[] = []
    if (partition.ungrouped.length > 0) {
      out.push({ key: '__ungrouped', label: null, todos: partition.ungrouped, nextBlockFirstId: null })
    }
    for (const g of partition.groups) {
      out.push({ key: g.key, label: g.label, todos: g.todos, nextBlockFirstId: null })
    }
    for (let i = 0; i < out.length - 1; i++) {
      out[i].nextBlockFirstId = out[i + 1].todos[0]?.id ?? null
    }
    return out
  }, [groupBy, displayItems, assignedPeopleMap, assignedOrgsMap, statuses, today])

  // Stable refs for ordered IDs (used in range-select without recreating callback)
  const visibleIdsRef = useRef<number[]>([])
  visibleIdsRef.current = visibleItems.map(t => t.id)

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
  const buildPasteMenu = (e: React.MouseEvent, beforeTodoId: number | null) => {
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
        action: () => { pasteTasksAt({ projectId, beforeTodoId }) },
      })
    }
    if (menuItems.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems })
    }
  }

  /** Handle paste for a given insert position */
  const handlePasteAt = (beforeTodoId: number | null) => {
    if (clipboardTodoIds.length > 0) {
      pasteTasksAt({ projectId, beforeTodoId })
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

    const orderKey = displayItems.map(t => t.id).join(',')
    const orderChanged = orderKey !== prevOrderRef.current
    const isRecentDrop = performance.now() - dropTimestampRef.current < 500

    // Skip expensive rect measurement when no animation is needed
    if (!isRecentDrop && !orderChanged) return

    // Measure current (new) positions before applying any transforms.
    // [data-stl-row] is on the wrapper only (TaskRow uses data-todo-id),
    // so we don't need :scope > here — works in flat and grouped layouts.
    const containerTop = container.getBoundingClientRect().top
    const newRects = new Map<number, number>()
    container.querySelectorAll<HTMLElement>('[data-stl-row]').forEach(el => {
      const id = Number(el.dataset.stlRow)
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

      container.querySelectorAll<HTMLElement>('[data-stl-row]').forEach(el => {
        const id = Number(el.dataset.stlRow)

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

  /**
   * Render a single task row + its surrounding insert-triggers and drop
   * indicator. `neighbors` are siblings within the same visual block; we
   * use them for the rounded multi-select corners and to compute the
   * "before next sibling" `beforeId` for the after-row trigger.
   *
   * `isFirstInList` controls the once-per-list "before-first" trigger so
   * it appears above the very first row only — never between groups.
   *
   * `nextOverallId` is the id of the first row in the next block (or null
   * if this is the last block); used as the `beforeId` of the trigger
   * after a block's final row.
   */
  const renderRow = (
    todo: PersistedTodoItem,
    indexInBlock: number,
    neighbors: PersistedTodoItem[],
    isFirstInList: boolean,
    nextOverallId: number | null,
    blockKey: string,
  ): ReactNode => {
    const isDragging = activeDragTodoId === todo.id
    const isSel = !isDragging && selectedTodoIds.has(todo.id)
    const isFocused = !isDragging && todo.id === focusedTodoId
    const isMultiSelect = selectedTodoIds.size > 1
    const prev = neighbors[indexInBlock - 1]
    const next = neighbors[indexInBlock + 1]
    const prevSel = prev != null && selectedTodoIds.has(prev.id) && activeDragTodoId !== prev.id
    const nextSel = next != null && selectedTodoIds.has(next.id) && activeDragTodoId !== next.id
    const selCls = isSel
      ? `${styles.sel} ${!prevSel ? styles.selFirst : ''} ${!nextSel ? styles.selLast : ''}`
      : ''
    const showFocused = isFocused && !(isSel && isMultiSelect)
    const cls = `${selCls} ${showFocused ? styles.focused : ''}`.trim() || undefined

    const isFirstOfList = isFirstInList && indexInBlock === 0
    // After-row trigger inserts before the next sibling in this block; if
    // none, before the first row of the next block; if no next block, at end.
    const afterRowBeforeId = next?.id ?? nextOverallId

    return (
      <div
        key={`${blockKey}|${todo.id}`}
        data-todo-id={todo.id}
        data-stl-row={todo.id}
        className={cls}
        onContextMenu={(e) => buildPasteMenu(e, todo.id)}
      >
        {insertBeforeTodoId === todo.id && (
          dropCount > 1
            ? <DropIndicator kind="group" height={dropCount * ROW_HEIGHT_PX} />
            : <DropIndicator kind="line" />
        )}
        {!isDragActive && onInsertTask && isFirstOfList && (
          <InsertTrigger
            editing={activeInsertAfterId === BEFORE_FIRST}
            onActivate={() => setActiveInsertAfterId(BEFORE_FIRST)}
            onCommit={async (title) => {
              const newId = await onInsertTask(title, todo.id)
              openTriggerAfterInsert(newId)
            }}
            onCancel={closeInsert}
            onContextMenu={(e) => buildPasteMenu(e, todo.id)}
            onPasteFromClipboard={clipboardTodoIds.length > 0 ? () => { handlePasteAt(todo.id); closeInsert() } : undefined}
          />
        )}
        <SortableTaskRow
          todo={todo}
          assignedPeople={assignedPeopleMap?.get(todo.id)}
          isSelected={isSel}
          ghost={ghostTodoIds?.has(todo.id)}
          cut={clipboardSet.has(todo.id)}
          disabledDrop={dragSelectionIds?.has(todo.id)}
          onSelect={handleSelect}
          onOpenDetail={onOpenDetail}
        />
        {!isDragActive && onInsertTask && (
          <InsertTrigger
            editing={activeInsertAfterId === todo.id}
            onActivate={() => setActiveInsertAfterId(todo.id)}
            onCommit={async (title) => {
              const newId = await onInsertTask(title, afterRowBeforeId)
              openTriggerAfterInsert(newId)
            }}
            onCancel={closeInsert}
            onContextMenu={(e) => buildPasteMenu(e, afterRowBeforeId)}
            onPasteFromClipboard={clipboardTodoIds.length > 0 ? () => { handlePasteAt(afterRowBeforeId); closeInsert() } : undefined}
          />
        )}
      </div>
    )
  }

  // ── Body render: grouped (one SortableContext per block) or flat (single) ──
  let body: ReactNode
  if (blocks) {
    body = blocks.map((block, blockIdx) => {
      const items = block.todos.map(t => taskDragId('canvas-project', t.id))
      const isFirstBlock = blockIdx === 0
      const rows = block.todos.map((todo, i) =>
        renderRow(todo, i, block.todos, isFirstBlock, block.nextBlockFirstId, block.key),
      )
      return (
        <SortableContext key={block.key} items={items}>
          {block.label != null ? (
            <TaskGroup label={block.label} count={block.todos.length}>
              {rows}
            </TaskGroup>
          ) : (
            <>{rows}</>
          )}
        </SortableContext>
      )
    })
  } else {
    const items = displayItems.map(t => taskDragId('canvas-project', t.id))
    const rows = displayItems.map((todo, i) =>
      renderRow(todo, i, displayItems, true, null, '__flat'),
    )
    body = <SortableContext items={items}>{rows}</SortableContext>
  }

  return (
    <>
      <div ref={containerRef} style={isDragActive ? { pointerEvents: 'none' } : undefined}>
        {body}
        {displayItems.length === 0 && !isDragActive && onInsertTask && (
          <InsertTrigger
            editing={activeInsertAfterId === BEFORE_FIRST}
            onActivate={() => setActiveInsertAfterId(BEFORE_FIRST)}
            onCommit={async (title) => {
              const newId = await onInsertTask(title, null)
              openTriggerAfterInsert(newId)
            }}
            onCancel={closeInsert}
            onContextMenu={(e) => buildPasteMenu(e, null)}
            onPasteFromClipboard={clipboardTodoIds.length > 0 ? () => { handlePasteAt(null); closeInsert() } : undefined}
          />
        )}
        {insertAtEnd && !insertBeforeTodoId && insertProjectId === projectId && (
          dropCount > 1
            ? <DropIndicator kind="group" height={dropCount * ROW_HEIGHT_PX} />
            : <DropIndicator kind="line" />
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
    </>
  )
}
