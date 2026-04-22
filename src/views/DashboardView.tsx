import { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useOrgStore } from '../stores/org-store'
import type { TodoPredicate } from '../models'
import { useUIStore } from '../stores/ui-store'
import { matchesFilter, predicateToCriteria, computeFilterPersonOrgIds } from '../stores/filter-store'
import { useStatusStore } from '../stores/status-store'
import { useTaskboardStore } from '../stores/taskboard-store'
import { computeTaskboardFullInsertIndex } from '../utils/taskboard-insert'
import {
  TASK_DRAG_KIND,
  TASK_DROP_KIND,
  TASKBOARD_SINGLETON_DROP_ID,
  buildTaskCollision,
  parseTaskboardEntryId,
  taskDragId,
} from '../utils/task-dnd'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useSettingsStore } from '../stores/settings-store'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { useIsMobile } from '../hooks/use-is-mobile'
import { TaskRow } from '../components/task/TaskRow'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import type { PersistedTodoItem, Person } from '../models'
import { startOfToday } from '../utils/date'
import { buildDashboardLists, type DashboardList } from '../services/dashboard-lists'
import { HORIZON_KEYS, type HorizonKey } from '../services/horizons'
import { HorizonRibbon } from '../components/dashboard/HorizonRibbon'
import { TaskboardPanel } from '../components/taskboard/TaskboardPanel'
import { ListDefinitionPickerPopup } from '../components/overlays/ListDefinitionPickerPopup'
import { DashboardListsEditor } from '../components/settings/DashboardListsEditor'
import { NotesBody } from '../components/shared/notes/NotesBody'
import { useNoteStore } from '../stores/note-store'
import { useUndoStore } from '../stores/undo-store'
import styles from './DashboardView.module.css'

// Sentinel value in `settings.dashboardUserLists` marking the Notes tile's
// position inside the "Your lists" grid. Real ListDefinition ids are
// positive integers, so -1 is unambiguous.
const NOTES_SENTINEL = -1

type GridItem =
  | { kind: 'list'; list: DashboardList }
  | { kind: 'notes' }

function DashboardDraggableRow({
  todo,
  listKey,
  children,
}: {
  todo: PersistedTodoItem
  listKey: string
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: taskDragId('dashboard', todo.id, { listKey }),
    data: { type: TASK_DRAG_KIND.dashboardTask, todo },
  })

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={{ opacity: isDragging ? 0.4 : 1 }}>
      {children}
    </div>
  )
}

export type DashboardDragHandleProps = React.HTMLAttributes<HTMLElement> & {
  ref?: (el: HTMLElement | null) => void
}

function DashboardDragHandleIcon() {
  return (
    <span className={styles.cardDragHandleIcon} aria-hidden="true" title="Drag to reorder">
      <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
        <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
        <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
        <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
      </svg>
    </span>
  )
}

function SortableCardWrapper({
  id,
  render,
}: {
  id: string | number
  render: (args: {
    handleIcon: React.ReactNode
    dragHandleProps: DashboardDragHandleProps
  }) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  const dragHandleProps: DashboardDragHandleProps = {
    ...attributes,
    ...listeners,
    className: styles.cardDragHandleArea,
  }
  return (
    <div ref={setNodeRef} style={style} className={styles.sortableCardWrapper}>
      {render({ handleIcon: <DashboardDragHandleIcon />, dragHandleProps })}
    </div>
  )
}

function renderRow(
  todo: PersistedTodoItem,
  listKey: string,
  isMobile: boolean,
  onOpenDetail: (todoId: number) => void,
  assignedPeopleMap: Map<number, Person[]>,
) {
  const row = (
    <TaskRow
      todo={todo}
      assignedPeople={assignedPeopleMap.get(todo.id)}
      compact
      onOpenDetail={onOpenDetail}
    />
  )
  if (isMobile) return <div key={todo.id}>{row}</div>
  return (
    <DashboardDraggableRow key={todo.id} todo={todo} listKey={listKey}>
      {row}
    </DashboardDraggableRow>
  )
}

function CardOverflowMenu({
  open,
  onToggle,
  onClose,
  onEdit,
  onUnpin,
  onDelete,
  hideEdit = false,
  hideDelete = false,
  label = 'List options',
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  onEdit: () => void
  onUnpin: () => void
  onDelete: () => void
  hideEdit?: boolean
  hideDelete?: boolean
  label?: string
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const stopDrag = (e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation()
  }

  return (
    <div ref={wrapperRef} className={styles.cardMenuWrapper}>
      <button
        type="button"
        className={styles.cardMenuBtn}
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        onPointerDown={stopDrag}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        ⋯
      </button>
      {open && (
        <div className={styles.cardMenu} role="menu" onPointerDown={stopDrag} onClick={stopDrag}>
          {!hideEdit && (
            <button type="button" role="menuitem" className={styles.cardMenuItem} onClick={onEdit}>
              Edit list…
            </button>
          )}
          <button type="button" role="menuitem" className={styles.cardMenuItem} onClick={onUnpin}>
            Unpin from dashboard
          </button>
          {!hideDelete && (
            <button
              type="button"
              role="menuitem"
              className={`${styles.cardMenuItem} ${styles.cardMenuItemDanger}`}
              onClick={onDelete}
            >
              Delete list…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function InlineAddTask({
  label,
  onAdd,
}: {
  label: string
  onAdd: (title: string) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const submit = useCallback(async () => {
    const title = text.trim()
    if (!title) { setOpen(false); return }
    await onAdd(title)
    setText('')
    // Keep the input open for rapid multi-add.
    inputRef.current?.focus()
  }, [text, onAdd])

  if (!open) {
    return (
      <button
        type="button"
        className={styles.addTaskButton}
        onClick={() => setOpen(true)}
      >
        + Add task to {label}
      </button>
    )
  }

  return (
    <div className={styles.addTaskInputRow}>
      <input
        ref={inputRef}
        className={styles.addTaskInput}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          if (e.key === 'Escape') { setOpen(false); setText('') }
        }}
        onBlur={() => {
          if (!text.trim()) setOpen(false)
        }}
        placeholder="New task — press Enter to add"
      />
    </div>
  )
}

function DashboardListCard({
  list,
  variant,
  onOpenDetail,
  assignedPeopleMap,
  isMobile,
  tabpanelId,
  tabpanelLabelledBy,
  addTaskLabel,
  onAddTask,
  dragHandleIcon,
  dragHandleProps,
  headerMenu,
}: {
  list: DashboardList
  variant: 'hero' | 'secondary'
  onOpenDetail: (todoId: number) => void
  assignedPeopleMap: Map<number, Person[]>
  isMobile: boolean
  tabpanelId?: string
  tabpanelLabelledBy?: string
  /** When provided, renders an inline "+ Add task to {label}" button at the bottom of the card. */
  addTaskLabel?: string
  onAddTask?: (title: string) => Promise<void> | void
  dragHandleIcon?: React.ReactNode
  /** Spread onto the card header so the whole header acts as a drag surface. */
  dragHandleProps?: DashboardDragHandleProps
  /** Rendered after the count — overflow menu trigger + popover. */
  headerMenu?: React.ReactNode
}) {
  const panelProps = tabpanelId
    ? { role: 'tabpanel' as const, id: tabpanelId, 'aria-labelledby': tabpanelLabelledBy }
    : {}
  const headerProps = dragHandleProps ?? {}
  return (
    <div
      className={`${styles.card} ${styles.listCard} ${variant === 'hero' ? styles.heroCard : ''}`}
      data-list-key={list.key}
      {...panelProps}
    >
      <div
        {...headerProps}
        className={`${styles.cardHeader} ${headerProps.className ?? ''}`.trim()}
      >
        {dragHandleIcon}
        <span className={`${styles.cardTitle} ${variant === 'hero' ? styles.cardTitleHero : ''}`}>{list.label}</span>
        <span className={styles.cardCount}>{list.todos.length}</span>
        {headerMenu}
      </div>
      <div className={`${styles.cardBody} ${variant === 'hero' ? styles.cardBodyHero : ''}`}>
        {list.todos.length === 0 ? (
          <div className={styles.empty}>No tasks</div>
        ) : list.groups !== undefined ? (
          list.groups.map((group) => (
            <div key={group.key} className={styles.group}>
              <div className={styles.groupLabel}>{group.label}</div>
              {group.todos.map((todo) =>
                renderRow(todo, list.key, isMobile, onOpenDetail, assignedPeopleMap),
              )}
            </div>
          ))
        ) : (
          list.todos.map((todo) =>
            renderRow(todo, list.key, isMobile, onOpenDetail, assignedPeopleMap),
          )
        )}
        {onAddTask && addTaskLabel && (
          <InlineAddTask label={addTaskLabel} onAdd={onAddTask} />
        )}
      </div>
    </div>
  )
}

export function DashboardView() {
  const { todos, loadAll } = useTodoStore()
  const { assignedPeopleMap, load: loadPeople, loadAssignments: loadPeopleAssignments } = usePersonStore()
  const { assignedOrgsMap, personOrgMap, load: loadOrgs, loadAssignments: loadOrgAssignments, loadPersonOrgMap } = useOrgStore()
  const { openEditPopup } = useUIStore()
  const { statuses, load: loadStatuses } = useStatusStore()
  const { load: loadTaskboard, ensureLoaded: ensureTaskboardLoaded } = useTaskboardStore()
  const { listDefinitions, load: loadDefinitions } = useListDefinitionStore()
  const horizonSlots = useSettingsStore((s) => s.horizonSlots)
  const selectedHorizon = useSettingsStore((s) => s.selectedHorizon)
  const setSelectedHorizon = useSettingsStore((s) => s.setSelectedHorizon)
  const setHorizonSlot = useSettingsStore((s) => s.setHorizonSlot)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const notesPinnedToDashboard = useSettingsStore((s) => s.notesPinnedToDashboard)
  const setNotesPinnedToDashboard = useSettingsStore((s) => s.setNotesPinnedToDashboard)
  const dashboardTopOrder = useSettingsStore((s) => s.dashboardTopOrder)
  const setDashboardTopOrder = useSettingsStore((s) => s.setDashboardTopOrder)
  const dashboardUserLists = useSettingsStore((s) => s.dashboardUserLists)
  const setDashboardUserLists = useSettingsStore((s) => s.setDashboardUserLists)
  const loadNotes = useNoteStore((s) => s.load)
  const taskEdit = useTaskEditCallbacks()
  const isMobile = useIsMobile()
  const [activeDragTodo, setActiveDragTodo] = useState<PersistedTodoItem | null>(null)
  const [addListPickerPos, setAddListPickerPos] = useState<{ x: number; y: number } | null>(null)
  const [slotPickerAt, setSlotPickerAt] = useState<{ key: HorizonKey; x: number; y: number } | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [editorInitialId, setEditorInitialId] = useState<number | null>(null)
  const [showHorizonEditor, setShowHorizonEditor] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<number | 'notes' | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null)
  const setPinned = useListDefinitionStore((s) => s.setPinned)
  const removeListDef = useListDefinitionStore((s) => s.remove)
  const addListDef = useListDefinitionStore((s) => s.add)
  const pushUndo = useUndoStore((s) => s.push)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // Scope collisions per-active so (a) a task drag only sees the taskboard
  // droppable, (b) a top-row sortable only sees the two top slots — not the
  // taskboard's inner useDroppable which shares the same rect, (c) a user-list
  // sortable only sees other user-list sortables.
  const collisionDetection = useMemo(() => buildTaskCollision([
    {
      when: (active) => active.id === 'top:taskboard' || active.id === 'top:horizon',
      accept: (id) => id === 'top:taskboard' || id === 'top:horizon',
      algorithm: 'closestCenter',
    },
    {
      when: (active) => active.data.type === TASK_DRAG_KIND.dashboardTask,
      accept: (id) => typeof id === 'string' && id.startsWith(TASKBOARD_SINGLETON_DROP_ID),
      algorithm: 'closestCenter',
    },
    {
      // Taskboard entry reorder: only see the panel's own sortable entries
      // and its outer drop target, and require the pointer to actually be
      // *inside* one of them — so dropping in empty dashboard space yields
      // `over: null` and `handleDragEnd`'s remove-on-drag-off branch fires.
      when: (active) => active.data.type === TASK_DRAG_KIND.taskboardTask,
      accept: (id) => typeof id === 'string' && (id === TASKBOARD_SINGLETON_DROP_ID || id.startsWith('tbp-')),
      algorithm: 'pointerWithin',
    },
    {
      when: (active) => typeof active.id === 'number',
      accept: (id) => typeof id === 'number',
      algorithm: 'closestCenter',
    },
  ]), [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    if (todo) setActiveDragTodo(todo)
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragTodo(null)
    const activeId = event.active.id
    const overId = event.over?.id

    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    const activeType = event.active.data.current?.type
    const overData = event.over?.data.current

    // Taskboard entry being dragged — reorder within the board or remove on
    // drop outside. Mirrors the branch in `use-canvas-dnd.ts` so dashboard-
    // panel reorder / remove matches the rail-docked + floating behavior.
    if (activeType === TASK_DRAG_KIND.taskboardTask && todo) {
      const tbState = useTaskboardStore.getState()
      if (overData?.type === TASK_DROP_KIND.taskboardTask) {
        const entries = tbState.getEntries()
        const fromIndex = entries.findIndex((e) => e.todoId === todo.id)
        const overEntryId = overData.entryId as string
        const overTodoId = parseTaskboardEntryId(overEntryId)?.todoId ?? NaN
        const toIndex = entries.findIndex((e) => e.todoId === overTodoId)
        if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
          await tbState.reorder(fromIndex, toIndex)
        }
        return
      }
      if (overData?.type === TASK_DROP_KIND.taskboard) {
        const entries = tbState.getEntries()
        const fromIndex = entries.findIndex((e) => e.todoId === todo.id)
        if (fromIndex !== -1 && fromIndex !== entries.length - 1) {
          await tbState.reorder(fromIndex, entries.length - 1)
        }
        return
      }
      // Dropped outside any taskboard target → remove from the board.
      if (tbState.has(todo.id)) await tbState.removeEntry(todo.id)
      return
    }

    // External task → taskboard drop (e.g. dashboard-task from horizon cards)
    if (todo && (overData?.type === TASK_DROP_KIND.taskboard || overData?.type === TASK_DROP_KIND.taskboardTask)) {
      await ensureTaskboardLoaded()
      const tbState = useTaskboardStore.getState()
      const panelId = (overData.panelId as string | undefined) ?? null
      const entries = tbState.getEntries()
      let targetIndex = entries.length
      if (panelId) {
        const translated = event.active.rect.current.translated
        const initialRect = event.active.rect.current.initial
        let pointerY = 0
        if (translated) pointerY = translated.top + translated.height / 2
        else if (initialRect) pointerY = initialRect.top + initialRect.height / 2 + event.delta.y
        targetIndex = computeTaskboardFullInsertIndex(panelId, pointerY, entries)
      }
      await tbState.addAt(todo.id, targetIndex)
      return
    }

    if (overId == null || activeId === overId) return

    // Top-row swap (taskboard ↔ horizon)
    if (typeof activeId === 'string' && typeof overId === 'string'
      && (activeId === 'top:taskboard' || activeId === 'top:horizon')
      && (overId === 'top:taskboard' || overId === 'top:horizon')) {
      const current = dashboardTopOrder
      const from = current.indexOf(activeId === 'top:taskboard' ? 'taskboard' : 'horizon')
      const to = current.indexOf(overId === 'top:taskboard' ? 'taskboard' : 'horizon')
      if (from !== -1 && to !== -1 && from !== to) {
        const next = [...current]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        await setDashboardTopOrder(next)
      }
      return
    }

    // User-list card reorder (ids are raw listDefinitionId numbers — indices
    // into `dashboardUserLists`).
    if (typeof activeId === 'number' && typeof overId === 'number') {
      const current = useSettingsStore.getState().dashboardUserLists ?? []
      const from = current.indexOf(activeId)
      const to = current.indexOf(overId)
      if (from !== -1 && to !== -1 && from !== to) {
        const next = [...current]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        await setDashboardUserLists(next)
      }
    }
  }, [dashboardTopOrder, setDashboardTopOrder, setDashboardUserLists, ensureTaskboardLoaded])

  useEffect(() => {
    loadAll()
    loadPeople()
    loadOrgs()
    loadStatuses()
    loadTaskboard()
    loadDefinitions()
    void loadNotes()
  }, [loadAll, loadPeople, loadOrgs, loadStatuses, loadTaskboard, loadDefinitions, loadNotes])

  useEffect(() => {
    const todoIds = todos.map((t) => t.id)
    if (todoIds.length > 0) {
      loadPeopleAssignments(todoIds)
      loadOrgAssignments(todoIds)
    }
  }, [todos, loadPeopleAssignments, loadOrgAssignments])

  useEffect(() => {
    loadPersonOrgMap()
  }, [loadPersonOrgMap])

  const today = useMemo(() => startOfToday(), [])

  const evalPredicate = useCallback(
    (predicate: TodoPredicate, todo: PersistedTodoItem) => {
      const criteria = predicateToCriteria(predicate)
      const people = assignedPeopleMap.get(todo.id) ?? []
      const personIds = people.map((p) => p.id!)
      const personOrgIds = people.flatMap((p) => personOrgMap.get(p.id!) ?? [])
      const directOrgIds = (assignedOrgsMap.get(todo.id) ?? []).map((o) => o.id!)
      const filterPersonOrgIds = computeFilterPersonOrgIds(criteria.personIds, criteria.personFilterMode, personOrgMap)
      return matchesFilter(criteria, todo, personIds, personOrgIds, directOrgIds, filterPersonOrgIds, statuses, today)
    },
    [assignedPeopleMap, assignedOrgsMap, personOrgMap, statuses, today],
  )

  // Compute every pinned list's rendered output. Hero and secondary grid both
  // read from this — the ribbon's tasks-by-horizon derives from the same source.
  // Each definition's predicate is authoritative for showCompleted / showHiddenStatuses.
  const lists = useMemo<DashboardList[]>(() => {
    const pinned = listDefinitions.filter((d) => d.pinnedToDashboard)
    return buildDashboardLists(pinned, todos, {
      today,
      evalPredicate,
    })
  }, [listDefinitions, todos, today, evalPredicate])

  const listsById = useMemo(() => {
    const map = new Map<number, DashboardList>()
    for (const l of lists) map.set(l.id, l)
    return map
  }, [lists])

  // Horizon → rendered list (may be null if slot unmapped or def deleted).
  const horizonLists = useMemo(() => {
    const out: Partial<Record<HorizonKey, DashboardList>> = {}
    for (const key of HORIZON_KEYS) {
      const defId = horizonSlots[key]
      if (defId == null) continue
      const list = listsById.get(defId)
      if (list) out[key] = list
    }
    return out
  }, [horizonSlots, listsById])

  const tasksByHorizon = useMemo(() => {
    const out = {} as Record<HorizonKey, PersistedTodoItem[]>
    for (const key of HORIZON_KEYS) {
      out[key] = horizonLists[key]?.todos ?? []
    }
    return out
  }, [horizonLists])

  const labelsByHorizon = useMemo(() => {
    const out = {} as Record<HorizonKey, string>
    for (const key of HORIZON_KEYS) {
      out[key] = horizonLists[key]?.label ?? ''
    }
    return out
  }, [horizonLists])

  const unmappedSlots = useMemo(() => {
    const s = new Set<HorizonKey>()
    for (const key of HORIZON_KEYS) {
      if (!horizonLists[key]) s.add(key)
    }
    return s
  }, [horizonLists])

  const horizonDefIds = useMemo(() => {
    const s = new Set<number>()
    for (const key of HORIZON_KEYS) {
      const id = horizonSlots[key]
      if (id != null) s.add(id)
    }
    return s
  }, [horizonSlots])

  const showNotesTile = notesPinnedToDashboard && !isMobile

  // "Your lists" grid membership and ordering. Post-P6 this is an explicit
  // setting that can include horizon-mapped defs alongside the ribbon. Falls
  // back to the legacy derivation (pinned minus horizons, by sortOrder) until
  // the first seed runs — keeps pre-P6 users visually stable across upgrade.
  // The Notes tile rides in the same array as `NOTES_SENTINEL` so it drags
  // and reorders alongside list cards.
  const gridItems = useMemo<GridItem[]>(() => {
    const source = dashboardUserLists
      ?? lists
        .filter((l) => !horizonDefIds.has(l.id))
        .map((l) => l.id)
    const items: GridItem[] = []
    let sawSentinel = false
    for (const id of source) {
      if (id === NOTES_SENTINEL) {
        if (showNotesTile) {
          items.push({ kind: 'notes' })
          sawSentinel = true
        }
      } else {
        const list = listsById.get(id)
        if (list) items.push({ kind: 'list', list })
      }
    }
    // Transient state (notes pinned but sentinel not yet persisted): render
    // at the end. A sync effect below repairs the array on the next tick.
    if (showNotesTile && !sawSentinel) items.push({ kind: 'notes' })
    return items
  }, [dashboardUserLists, listsById, lists, horizonDefIds, showNotesTile])

  const userLists = useMemo(
    () => gridItems.flatMap((i) => (i.kind === 'list' ? [i.list] : [])),
    [gridItems],
  )

  // One-time seed: first render where the setting is still `null` and at least
  // one list def is loaded, snapshot the legacy derivation so ordering persists.
  useEffect(() => {
    if (dashboardUserLists != null) return
    if (listDefinitions.length === 0) return
    const seed = [...listDefinitions]
      .filter((d) => d.pinnedToDashboard && d.id != null && !horizonDefIds.has(d.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((d) => d.id!)
    if (notesPinnedToDashboard) seed.push(NOTES_SENTINEL)
    void setDashboardUserLists(seed)
  }, [dashboardUserLists, listDefinitions, horizonDefIds, notesPinnedToDashboard, setDashboardUserLists])

  // Reconcile the notes sentinel with `notesPinnedToDashboard`. Pinning via
  // the picker / unpinning via the ⋯ menu both flip the flag; this effect
  // appends or removes the sentinel so the sortable array stays consistent
  // without every caller having to touch both settings.
  useEffect(() => {
    if (dashboardUserLists == null) return
    const has = dashboardUserLists.includes(NOTES_SENTINEL)
    if (notesPinnedToDashboard && !has) {
      void setDashboardUserLists([...dashboardUserLists, NOTES_SENTINEL])
    } else if (!notesPinnedToDashboard && has) {
      void setDashboardUserLists(dashboardUserLists.filter((id) => id !== NOTES_SENTINEL))
    }
  }, [notesPinnedToDashboard, dashboardUserLists, setDashboardUserLists])

  const heroList = horizonLists[selectedHorizon]

  const handleClick = useCallback((todoId: number) => {
    openEditPopup(todoId)
  }, [openEditPopup])

  const openSlotPicker = useCallback((key: HorizonKey) => {
    // Fallback position when triggered from a non-placeholder cell (keyboard).
    const el = document.querySelector(`[data-horizon="${key}"]`) as HTMLElement | null
    const rect = el?.getBoundingClientRect()
    setSlotPickerAt({
      key,
      x: rect?.left ?? 40,
      y: (rect?.bottom ?? 80) + 4,
    })
  }, [])

  const handleSlotPick = useCallback(async (listDefinitionId: number) => {
    if (slotPickerAt) {
      await setHorizonSlot(slotPickerAt.key, listDefinitionId)
      setSlotPickerAt(null)
    }
  }, [slotPickerAt, setHorizonSlot])

  const HERO_PANEL_ID = 'horizon-hero-panel'
  const tabIdFor = useCallback((key: HorizonKey) => `horizon-tab-${key}`, [])

  const horizonDefIdList = useMemo(
    () => Array.from(horizonDefIds),
    [horizonDefIds],
  )

  const handleCreateHorizonTask = useCallback(async (title: string) => {
    await taskEdit.onCreate({ title })
  }, [taskEdit])

  const handleEditList = useCallback((id: number) => {
    setEditorInitialId(id)
    setShowEditor(true)
    setOpenMenuId(null)
  }, [])

  const handleUnpinList = useCallback(async (id: number, name: string) => {
    setOpenMenuId(null)
    const isHorizon = horizonDefIds.has(id)
    const prevList = useSettingsStore.getState().dashboardUserLists ?? []
    const prevIndex = prevList.indexOf(id)
    const nextList = prevIndex === -1 ? prevList : prevList.filter((x) => x !== id)
    if (prevIndex !== -1) await setDashboardUserLists(nextList)
    // Horizon-mapped defs must stay pinnedToDashboard so the ribbon can
    // resolve them; for non-horizon defs we clear the flag so the legacy
    // picker-side filter stays consistent.
    if (!isHorizon) await setPinned(id, false)
    pushUndo(
      {
        description: `Unpinned "${name}"`,
        undo: async () => {
          if (!isHorizon) await setPinned(id, true)
          if (prevIndex !== -1) {
            const cur = useSettingsStore.getState().dashboardUserLists ?? []
            if (!cur.includes(id)) {
              const restored = [...cur]
              const clamped = Math.min(prevIndex, restored.length)
              restored.splice(clamped, 0, id)
              await setDashboardUserLists(restored)
            }
          }
        },
        redo: async () => {
          const cur = useSettingsStore.getState().dashboardUserLists ?? []
          if (cur.includes(id)) await setDashboardUserLists(cur.filter((x) => x !== id))
          if (!isHorizon) await setPinned(id, false)
        },
      },
      true,
    )
  }, [setPinned, pushUndo, horizonDefIds, setDashboardUserLists])

  const handleDeleteList = useCallback((id: number, name: string) => {
    setOpenMenuId(null)
    setPendingDelete({ id, name })
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    const id = pendingDelete.id
    setPendingDelete(null)
    const cur = useSettingsStore.getState().dashboardUserLists ?? []
    if (cur.includes(id)) await setDashboardUserLists(cur.filter((x) => x !== id))
    await removeListDef(id)
  }, [pendingDelete, removeListDef, setDashboardUserLists])

  const handleUnpinNotes = useCallback(async () => {
    setOpenMenuId(null)
    await setNotesPinnedToDashboard(false)
    pushUndo(
      {
        description: 'Unpinned Notes',
        undo: async () => { await setNotesPinnedToDashboard(true) },
        redo: async () => { await setNotesPinnedToDashboard(false) },
      },
      true,
    )
  }, [setNotesPinnedToDashboard, pushUndo])

  const handleCreateNewList = useCallback(async () => {
    const defs = useListDefinitionStore.getState().listDefinitions
    let candidate = 'New list'
    let n = 2
    const lower = new Set(defs.map((d) => d.name.toLowerCase()))
    while (lower.has(candidate.toLowerCase())) {
      candidate = `New list ${n++}`
    }
    const id = await addListDef({ name: candidate, pinnedToDashboard: true })
    const cur = useSettingsStore.getState().dashboardUserLists ?? []
    if (!cur.includes(id)) await setDashboardUserLists([...cur, id])
    setEditorInitialId(id)
    setShowEditor(true)
  }, [addListDef, setDashboardUserLists])

  const handlePinFromPicker = useCallback(async (id: number) => {
    await setPinned(id, true)
    const cur = useSettingsStore.getState().dashboardUserLists ?? []
    if (!cur.includes(id)) await setDashboardUserLists([...cur, id])
  }, [setPinned, setDashboardUserLists])

  const pageContent = (
    <>
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.pageHeader}>
            <div className={styles.pageTitle}>Dashboard</div>
          </div>

          <HorizonRibbon
            tasksByHorizon={tasksByHorizon}
            labelsByHorizon={labelsByHorizon}
            selectedHorizon={selectedHorizon}
            today={today}
            weekStartsOn={weekStartsOn}
            onSelect={(k) => setSelectedHorizon(k)}
            onConfigureSlot={openSlotPicker}
            unmappedSlots={unmappedSlots}
            heroPanelId={HERO_PANEL_ID}
            tabIdFor={tabIdFor}
            onEditHorizons={horizonDefIdList.length > 0 ? () => setShowHorizonEditor(true) : undefined}
          />

          <SortableContext
            items={dashboardTopOrder.map((slot) => `top:${slot}`)}
            strategy={horizontalListSortingStrategy}
          >
            <div className={styles.topRow}>
              {dashboardTopOrder.map((slot) => {
                if (slot === 'taskboard') {
                  return (
                    <SortableCardWrapper
                      key="taskboard"
                      id="top:taskboard"
                      render={({ handleIcon, dragHandleProps }) => (
                        <TaskboardPanel dragHandleIcon={handleIcon} dragHandleProps={dragHandleProps} />
                      )}
                    />
                  )
                }
                if (!heroList) return null
                return (
                  <SortableCardWrapper
                    key="horizon"
                    id="top:horizon"
                    render={({ handleIcon, dragHandleProps }) => (
                      <DashboardListCard
                        list={heroList}
                        variant="hero"
                        onOpenDetail={handleClick}
                        assignedPeopleMap={assignedPeopleMap}
                        isMobile={isMobile}
                        tabpanelId={HERO_PANEL_ID}
                        tabpanelLabelledBy={tabIdFor(selectedHorizon)}
                        addTaskLabel={heroList.label}
                        onAddTask={handleCreateHorizonTask}
                        dragHandleIcon={handleIcon}
                        dragHandleProps={dragHandleProps}
                      />
                    )}
                  />
                )
              })}
            </div>
          </SortableContext>

          {(gridItems.length > 0 || !isMobile) && (
            <>
              {gridItems.length > 0 && (
                <div className={styles.sectionDivider}>Your lists</div>
              )}
              <SortableContext
                items={gridItems.map((i) => (i.kind === 'notes' ? NOTES_SENTINEL : i.list.id))}
                strategy={rectSortingStrategy}
              >
                <div className={styles.grid}>
                  {gridItems.map((item) => {
                    if (item.kind === 'notes') {
                      return (
                        <SortableCardWrapper
                          key="notes"
                          id={NOTES_SENTINEL}
                          render={({ handleIcon, dragHandleProps }) => (
                            <div
                              className={`${styles.card} ${styles.listCard} ${styles.notesTile}`}
                              data-notes-tile="true"
                            >
                              <div
                                {...dragHandleProps}
                                className={`${styles.cardHeader} ${dragHandleProps.className ?? ''}`.trim()}
                              >
                                {handleIcon}
                                <span className={styles.cardTitle}>Notes</span>
                                <span className={styles.cardCount} aria-hidden />
                                <CardOverflowMenu
                                  open={openMenuId === 'notes'}
                                  onToggle={() => setOpenMenuId((cur) => (cur === 'notes' ? null : 'notes'))}
                                  onClose={() => setOpenMenuId((cur) => (cur === 'notes' ? null : cur))}
                                  onEdit={() => setOpenMenuId(null)}
                                  onUnpin={() => { void handleUnpinNotes() }}
                                  onDelete={() => setOpenMenuId(null)}
                                  hideEdit
                                  hideDelete
                                  label="Notes options"
                                />
                              </div>
                              <div className={styles.notesTileBody}>
                                <NotesBody dock="slot" />
                              </div>
                            </div>
                          )}
                        />
                      )
                    }
                    const list = item.list
                    return (
                      <SortableCardWrapper
                        key={list.id}
                        id={list.id}
                        render={({ handleIcon, dragHandleProps }) => (
                          <DashboardListCard
                            list={list}
                            variant="secondary"
                            onOpenDetail={handleClick}
                            assignedPeopleMap={assignedPeopleMap}
                            isMobile={isMobile}
                            dragHandleIcon={handleIcon}
                            dragHandleProps={dragHandleProps}
                            headerMenu={
                              <CardOverflowMenu
                                open={openMenuId === list.id}
                                onToggle={() => setOpenMenuId((cur) => (cur === list.id ? null : list.id))}
                                onClose={() => setOpenMenuId((cur) => (cur === list.id ? null : cur))}
                                onEdit={() => handleEditList(list.id)}
                                onUnpin={() => handleUnpinList(list.id, list.label)}
                                onDelete={() => handleDeleteList(list.id, list.label)}
                              />
                            }
                          />
                        )}
                      />
                    )
                  })}
                  {!isMobile && (
                    <button
                      type="button"
                      className={styles.addTile}
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                        setAddListPickerPos({ x: r.left, y: r.bottom + 4 })
                      }}
                      title="Add a list to the dashboard"
                    >
                      <span className={styles.addTileGlyph}>+</span>
                      <span className={styles.addTileLabel}>Add list</span>
                    </button>
                  )}
                </div>
              </SortableContext>
            </>
          )}

        </div>

        {taskEdit.editPopupMode === 'edit' && taskEdit.editProps && (
          <TaskEditPopup
            mode="edit"
            {...taskEdit.editProps}
            allPeople={taskEdit.allPeople}
            allOrgs={taskEdit.allOrgs}
            onClose={taskEdit.closeEditPopup}
            {...taskEdit.entityCreators}
          />
        )}

        {taskEdit.editPopupMode === 'create' && (
          <TaskEditPopup
            mode="create"
            assignedPeople={[]}
            allPeople={taskEdit.allPeople}
            onClose={taskEdit.closeEditPopup}
            onCreate={taskEdit.onCreate}
            assignedOrgs={[]}
            allOrgs={taskEdit.allOrgs}
            onAssignPerson={() => {}}
            onUnassignPerson={() => {}}
            onAssignOrg={() => {}}
            onUnassignOrg={() => {}}
            {...taskEdit.entityCreators}
          />
        )}
      </div>
      <FilteredListPopup />
      {addListPickerPos && (
        <ListDefinitionPickerPopup
          x={addListPickerPos.x}
          y={addListPickerPos.y}
          onClose={() => setAddListPickerPos(null)}
          onCreateNew={() => { void handleCreateNewList() }}
          showNotesEntry={!notesPinnedToDashboard}
          onPinNotes={() => { void setNotesPinnedToDashboard(true) }}
          excludeIds={userLists.map((l) => l.id)}
          onPin={(id) => { void handlePinFromPicker(id) }}
        />
      )}
      {slotPickerAt && (
        <ListDefinitionPickerPopup
          x={slotPickerAt.x}
          y={slotPickerAt.y}
          mode="canvas"
          onClose={() => setSlotPickerAt(null)}
          onSelect={handleSlotPick}
          onCreateNew={() => { void handleCreateNewList(); setSlotPickerAt(null) }}
        />
      )}
      {showEditor && (
        <DashboardListsEditor
          onClose={() => { setShowEditor(false); setEditorInitialId(null) }}
          initialSelectedId={editorInitialId ?? undefined}
        />
      )}
      {pendingDelete && (
        <div className={styles.deleteOverlay}>
          <div className={styles.deleteBackdrop} onClick={() => setPendingDelete(null)} />
          <div className={styles.deleteDialog}>
            <div className={styles.deleteTitle}>Delete list</div>
            <div className={styles.deleteBody}>
              Delete <strong>{pendingDelete.name}</strong>? You can undo for 5 seconds.
            </div>
            <div className={styles.deleteActions}>
              <button type="button" className={styles.deleteCancel} onClick={() => setPendingDelete(null)}>Cancel</button>
              <button type="button" className={styles.deleteConfirm} onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
      {showHorizonEditor && (
        <DashboardListsEditor
          title="Edit Horizons"
          filterIds={horizonDefIdList}
          onClose={() => setShowHorizonEditor(false)}
        />
      )}
    </>
  )

  if (isMobile) return pageContent

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {pageContent}
      <DragOverlay dropAnimation={null}>
        {activeDragTodo && (
          <div className={styles.dragOverlay}>
            <TaskRow todo={activeDragTodo} compact ghost />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
