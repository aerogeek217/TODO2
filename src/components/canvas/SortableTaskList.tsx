import { useMemo, useContext, useState, useCallback, useEffect, useRef, useLayoutEffect, type ReactNode } from 'react'
import { SortableContext } from '@dnd-kit/sortable'
import type { PersistedTodoItem, Person, ProjectGroupBy } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useFilterStore } from '../../stores/filter-store'
import { TaskRow } from '../task/TaskRow'
import { SortableTaskDraggable } from '../task/dnd/TaskDraggable'
import { bySortOrder } from '../../utils/sort-order'
import { taskDragId } from '../../utils/task-dnd'
import { DropIndicator } from '../shared/DropIndicator'
import { DragInsertContext, DragPreviewContext } from './DragInsertContext'
import { InsertTrigger, type InsertTriggerHandle } from './InsertTrigger'
import { CanvasContextMenu, type ContextMenuItem } from '../overlays/CanvasContextMenu'
import { pasteTasksAt } from '../../services/clipboard'
import { partitionByGroup, getGroupColor } from '../../utils/task-grouping'
import { UNGROUPED_GROUP_KEY, blockContextId } from '../../utils/cross-group-drag'
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
  /** Optional swatch color for entity groups (status / people / org / tag).
   *  Date-bucket and ungrouped blocks leave this undefined. */
  color?: string
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
  const orgs = useOrgStore((s) => s.orgs)
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statuses = useStatusStore((s) => s.statuses)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const today = useMemo(() => startOfToday(), [])

  // Filter-aware group ordering (P5 + P6, item 12 / item 1): when groupBy
  // matches an active filter dimension, restrict the visible groups to that
  // filter's keys (P6 intersection rule) and order direct-tier groups first
  // / implicit-tier groups (cross-axis: org→members for people, person→orgs
  // for org) at the bottom. Subscribing here keeps ProjectNode unaware of
  // the filter store; the cost is one re-render of the SortableTaskList
  // memo when filters change.
  const filterPersonIds = useFilterStore((s) => s.filters.personIds)
  const personFilterMode = useFilterStore((s) => s.filters.personFilterMode)
  const filterOrgIds = useFilterStore((s) => s.filters.orgIds)
  const orgFilterMode = useFilterStore((s) => s.filters.orgFilterMode)
  const filterTags = useFilterStore((s) => s.filters.tags)

  // Which InsertTrigger is currently open (keyed by the todo id it follows, or BEFORE_FIRST)
  const [activeInsertAfterId, setActiveInsertAfterId] = useState<number | null>(null)
  const closeInsert = useCallback(() => { setActiveInsertAfterId(null); clearInlineCreate() }, [clearInlineCreate])

  // Imperative focus handoff (Phase 3 of real-browser-testing). Phase 2's
  // post-Phase-4 trace showed every focus mechanism earlier than t50
  // (autoFocus, useLayoutEffect, rAF, t0) is 0/40 effective during the
  // Enter-chain re-render race; only setTimeout(_, 50) lands focus
  // reliably. Each <InsertTrigger> registers its handle in `triggerRefs`
  // via a stable callback ref. The useLayoutEffect below fires after the
  // commit that mounts the new trigger and schedules a single t50 timer
  // — long enough for whatever holds focus ineligible (most likely React
  // Flow's ResizeObserver firing as the project node grows for the new
  // row) to release. Scheduling from useLayoutEffect (post-commit) rather
  // than from `openTriggerAfterInsert` (pre-commit) is critical: with 20+
  // rows the commit itself can take longer than 50 ms, pushing a
  // pre-commit timer to fire *during* contention.
  const triggerRefs = useRef<Map<number, InsertTriggerHandle | null>>(new Map())
  const triggerRefCbs = useRef<Map<number, (h: InsertTriggerHandle | null) => void>>(new Map())
  const getTriggerRefCb = useCallback((id: number) => {
    let cb = triggerRefCbs.current.get(id)
    if (!cb) {
      cb = (handle: InsertTriggerHandle | null): void => {
        if (handle) triggerRefs.current.set(id, handle)
        else triggerRefs.current.delete(id)
      }
      triggerRefCbs.current.set(id, cb)
    }
    return cb
  }, [])
  useLayoutEffect(() => {
    if (activeInsertAfterId == null) return
    const id = activeInsertAfterId
    const t = setTimeout(() => triggerRefs.current.get(id)?.focusInput(), 50)
    return () => clearTimeout(t)
  }, [activeInsertAfterId])

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

  // After Enter-chain insert: open the trigger on the new task and
  // imperatively land focus 50 ms later (see `triggerRefs` doc above for
  // mechanism). Same-project path sets local state directly so the todos
  // update AND the activeInsertAfterId update land in the SAME render —
  // the new InsertTrigger mounts with editing=true on its first render
  // and the t50 timer focuses it. Cross-project (NLP /proj redirected the
  // task) falls back to the ui-store path since the target project's
  // useEffect is the only path that can land activeInsertAfterId there.
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
    const ctx = {
      assignedPeopleMap: assignedPeopleMap ?? new Map(),
      assignedOrgsMap,
      assignedTagsMap,
      statuses,
      orgs,
      personOrgMap,
      today,
      weekStartsOn,
    }
    let restrictToFilterSet: string[] | undefined
    let implicitKeysFor:
      | ((todo: PersistedTodoItem, axis: ProjectGroupBy) => readonly string[])
      | undefined
    if (groupBy === 'people' && filterPersonIds && filterPersonIds.size > 0) {
      restrictToFilterSet = [...filterPersonIds].map((id) => `person-${id}`)
      // Implicit (cross-axis) keys for the people grouping: when the
      // person-filter mode is `include-orgs` (the manual-filter default),
      // tasks that survive the filter via "task has org X, X has member A"
      // emit under person-A as implicit. Direct-only mode (the runtime-
      // filter hardcode + the user's explicit "People only" toggle) skips
      // this branch — those tasks shouldn't have passed the filter anyway,
      // so the partition's empty-intersection skip leaves them out of every
      // visible group.
      if (personFilterMode === 'include-orgs') {
        implicitKeysFor = (todo) => {
          const taskOrgs = assignedOrgsMap.get(todo.id) ?? []
          if (taskOrgs.length === 0) return []
          const orgIdSet = new Set<number>()
          for (const o of taskOrgs) {
            if (o.id != null) orgIdSet.add(o.id)
          }
          const memberKeys: string[] = []
          const seen = new Set<string>()
          for (const [pid, orgIds] of personOrgMap) {
            for (const oid of orgIds) {
              if (orgIdSet.has(oid)) {
                const k = `person-${pid}`
                if (!seen.has(k)) {
                  seen.add(k)
                  memberKeys.push(k)
                }
                break
              }
            }
          }
          return memberKeys
        }
      }
    } else if (groupBy === 'org' && filterOrgIds && filterOrgIds.size > 0) {
      restrictToFilterSet = [...filterOrgIds].map((id) => `org-${id}`)
      // Symmetric to people grouping: in `include-people` mode, tasks that
      // survive the filter via "task has person P, P is a member of org X"
      // emit under org-X as implicit.
      if (orgFilterMode === 'include-people') {
        implicitKeysFor = (todo) => {
          const taskPeople = assignedPeopleMap?.get(todo.id) ?? []
          if (taskPeople.length === 0) return []
          const orgKeys: string[] = []
          const seen = new Set<string>()
          for (const p of taskPeople) {
            if (p.id == null) continue
            const orgIds = personOrgMap.get(p.id) ?? []
            for (const oid of orgIds) {
              const k = `org-${oid}`
              if (!seen.has(k)) {
                seen.add(k)
                orgKeys.push(k)
              }
            }
          }
          return orgKeys
        }
      }
    } else if (groupBy === 'tag' && filterTags && filterTags.size > 0) {
      // Tags have no cross-axis path — direct-only intersection.
      restrictToFilterSet = [...filterTags].map((id) => `tag-${id}`)
    }
    const partition = partitionByGroup(
      displayItems,
      groupBy,
      ctx,
      undefined,
      restrictToFilterSet,
      undefined,
      implicitKeysFor,
    )
    const out: RenderBlock[] = []
    if (partition.ungrouped.length > 0) {
      out.push({ key: UNGROUPED_GROUP_KEY, label: null, todos: partition.ungrouped, nextBlockFirstId: null })
    }
    for (const g of partition.groups) {
      out.push({
        key: g.key,
        label: g.label,
        color: getGroupColor(g.key, groupBy, ctx),
        todos: g.todos,
        nextBlockFirstId: null,
      })
    }
    for (let i = 0; i < out.length - 1; i++) {
      const current = out[i]
      const next = out[i + 1]
      if (current && next) {
        current.nextBlockFirstId = next.todos[0]?.id ?? null
      }
    }
    return out
  }, [groupBy, displayItems, assignedPeopleMap, assignedOrgsMap, assignedTagsMap, statuses, orgs, personOrgMap, today, weekStartsOn, filterPersonIds, personFilterMode, filterOrgIds, orgFilterMode, filterTags])

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
            ref={getTriggerRefCb(BEFORE_FIRST)}
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
            ref={getTriggerRefCb(todo.id)}
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
        <SortableContext
          key={block.key}
          id={blockContextId(projectId, block.key)}
          items={items}
        >
          {block.label != null ? (
            <TaskGroup label={block.label} count={block.todos.length} color={block.color}>
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
            ref={getTriggerRefCb(BEFORE_FIRST)}
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
      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      )}
    </>
  )
}
