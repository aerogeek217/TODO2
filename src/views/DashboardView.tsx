import { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
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
import { useTagStore } from '../stores/tag-store'
import { useOrgStore } from '../stores/org-store'
import type { TodoPredicate } from '../models'
import { useUIStore } from '../stores/ui-store'
import { useFilterStore, matchesFilter, predicateToCriteria, computeFilterPersonOrgIds } from '../stores/filter-store'
import { useStatusStore } from '../stores/status-store'
import { useTaskboardStore } from '../stores/taskboard-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useSettingsStore } from '../stores/settings-store'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { useIsMobile } from '../hooks/use-is-mobile'
import { TaskRow } from '../components/task/TaskRow'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import type { PersistedTodoItem, Person, Tag } from '../models'
import { startOfToday } from '../utils/date'
import { buildDashboardLists, type DashboardList } from '../services/dashboard-lists'
import { HORIZON_KEYS, type HorizonKey } from '../services/horizons'
import { HorizonRibbon } from '../components/dashboard/HorizonRibbon'
import { TaskboardPanel } from '../components/taskboard/TaskboardPanel'
import { ListDefinitionPickerPopup } from '../components/overlays/ListDefinitionPickerPopup'
import { DashboardListsEditor } from '../components/settings/DashboardListsEditor'
import { NotesPanel } from '../components/dashboard/NotesPanel'
import { useNoteStore } from '../stores/note-store'
import styles from './DashboardView.module.css'

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
    id: `dashboard-${listKey}-${todo.id}`,
    data: { type: 'dashboard-task', todo },
  })

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={{ opacity: isDragging ? 0.4 : 1 }}>
      {children}
    </div>
  )
}

function SortableCardWrapper({
  id,
  children,
}: {
  id: string | number
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} className={styles.sortableCardWrapper}>
      <button
        type="button"
        className={styles.cardDragHandle}
        title="Drag to reorder"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true">
          <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
          <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
          <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
        </svg>
      </button>
      {children}
    </div>
  )
}

function renderRow(
  todo: PersistedTodoItem,
  listKey: string,
  isMobile: boolean,
  onOpenDetail: (todoId: number) => void,
  assignedPeopleMap: Map<number, Person[]>,
  assignedTagsMap: Map<number, Tag[]>,
) {
  const row = (
    <TaskRow
      todo={todo}
      assignedPeople={assignedPeopleMap.get(todo.id)}
      assignedTags={assignedTagsMap.get(todo.id)}
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
  collapsed,
  onToggleCollapse,
  onOpenDetail,
  assignedPeopleMap,
  assignedTagsMap,
  isMobile,
  tabpanelId,
  tabpanelLabelledBy,
  addTaskLabel,
  onAddTask,
}: {
  list: DashboardList
  variant: 'hero' | 'secondary'
  collapsed: boolean
  onToggleCollapse: () => void
  onOpenDetail: (todoId: number) => void
  assignedPeopleMap: Map<number, Person[]>
  assignedTagsMap: Map<number, Tag[]>
  isMobile: boolean
  tabpanelId?: string
  tabpanelLabelledBy?: string
  /** When provided, renders an inline "+ Add task to {label}" button at the bottom of the card. */
  addTaskLabel?: string
  onAddTask?: (title: string) => Promise<void> | void
}) {
  const panelProps = tabpanelId
    ? { role: 'tabpanel' as const, id: tabpanelId, 'aria-labelledby': tabpanelLabelledBy }
    : {}
  return (
    <div
      className={`${styles.card} ${styles.listCard} ${variant === 'hero' ? styles.heroCard : ''}`}
      data-list-key={list.key}
      {...panelProps}
    >
      <div className={styles.cardHeader} onClick={onToggleCollapse}>
        <span className={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ''}`}>&#9662;</span>
        <span className={`${styles.cardTitle} ${variant === 'hero' ? styles.cardTitleHero : ''}`}>{list.label}</span>
        <span className={styles.cardCount}>{list.todos.length}</span>
      </div>
      {!collapsed && (
        <div className={`${styles.cardBody} ${variant === 'hero' ? styles.cardBodyHero : ''}`}>
          {list.todos.length === 0 ? (
            <div className={styles.empty}>No tasks</div>
          ) : list.groups !== undefined ? (
            list.groups.map((group) => (
              <div key={group.key} className={styles.group}>
                <div className={styles.groupLabel}>{group.label}</div>
                {group.todos.map((todo) =>
                  renderRow(todo, list.key, isMobile, onOpenDetail, assignedPeopleMap, assignedTagsMap),
                )}
              </div>
            ))
          ) : (
            list.todos.map((todo) =>
              renderRow(todo, list.key, isMobile, onOpenDetail, assignedPeopleMap, assignedTagsMap),
            )
          )}
          {onAddTask && addTaskLabel && (
            <InlineAddTask label={addTaskLabel} onAdd={onAddTask} />
          )}
        </div>
      )}
    </div>
  )
}

export function DashboardView() {
  const { todos, loadAll } = useTodoStore()
  const { assignedPeopleMap, load: loadPeople, loadAssignments: loadPeopleAssignments } = usePersonStore()
  const { assignedTagsMap, load: loadTags, loadAssignments: loadTagAssignments } = useTagStore()
  const { assignedOrgsMap, personOrgMap, load: loadOrgs, loadAssignments: loadOrgAssignments, loadPersonOrgMap } = useOrgStore()
  const { openEditPopup } = useUIStore()
  const { statuses, load: loadStatuses } = useStatusStore()
  const showHiddenStatuses = useFilterStore((s) => s.filters.showHiddenStatuses)
  const showCompleted = useFilterStore((s) => s.filters.showCompleted)
  const { load: loadTaskboard } = useTaskboardStore()
  const { listDefinitions, load: loadDefinitions } = useListDefinitionStore()
  const horizonSlots = useSettingsStore((s) => s.horizonSlots)
  const selectedHorizon = useSettingsStore((s) => s.selectedHorizon)
  const setSelectedHorizon = useSettingsStore((s) => s.setSelectedHorizon)
  const setHorizonSlot = useSettingsStore((s) => s.setHorizonSlot)
  const horizonCollapsed = useSettingsStore((s) => s.horizonCollapsed)
  const setHorizonCollapsed = useSettingsStore((s) => s.setHorizonCollapsed)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const notesDock = useSettingsStore((s) => s.notesDock)
  const notesVisible = useSettingsStore((s) => s.notesVisible)
  const setNotesVisible = useSettingsStore((s) => s.setNotesVisible)
  const dashboardTopOrder = useSettingsStore((s) => s.dashboardTopOrder)
  const setDashboardTopOrder = useSettingsStore((s) => s.setDashboardTopOrder)
  const reorderListDefinitions = useListDefinitionStore((s) => s.reorder)
  const loadNotes = useNoteStore((s) => s.load)
  const taskEdit = useTaskEditCallbacks()
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeDragTodo, setActiveDragTodo] = useState<PersistedTodoItem | null>(null)
  const [addListPickerPos, setAddListPickerPos] = useState<{ x: number; y: number } | null>(null)
  const [slotPickerAt, setSlotPickerAt] = useState<{ key: HorizonKey; x: number; y: number } | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [showHorizonEditor, setShowHorizonEditor] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    if (todo) setActiveDragTodo(todo)
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragTodo(null)
    const activeId = event.active.id
    const overId = event.over?.id

    // Task → taskboard drop
    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    const overData = event.over?.data.current
    if (todo && overData?.type === 'taskboard') {
      await useTaskboardStore.getState().add(todo.id)
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

    // User-list card reorder (ids are raw listDefinitionId numbers)
    if (typeof activeId === 'number' && typeof overId === 'number') {
      const ordered = [...useListDefinitionStore.getState().listDefinitions]
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const from = ordered.findIndex((d) => d.id === activeId)
      const to = ordered.findIndex((d) => d.id === overId)
      if (from !== -1 && to !== -1 && from !== to) {
        await reorderListDefinitions(from, to)
      }
    }
  }, [dashboardTopOrder, setDashboardTopOrder, reorderListDefinitions])

  useEffect(() => {
    loadAll()
    loadPeople()
    loadTags()
    loadOrgs()
    loadStatuses()
    loadTaskboard()
    loadDefinitions()
    void loadNotes()
  }, [loadAll, loadPeople, loadTags, loadOrgs, loadStatuses, loadTaskboard, loadDefinitions, loadNotes])

  useEffect(() => {
    const todoIds = todos.map((t) => t.id)
    if (todoIds.length > 0) {
      loadPeopleAssignments(todoIds)
      loadTagAssignments(todoIds)
      loadOrgAssignments(todoIds)
    }
  }, [todos, loadPeopleAssignments, loadTagAssignments, loadOrgAssignments])

  useEffect(() => {
    loadPersonOrgMap()
  }, [loadPersonOrgMap])

  const today = useMemo(() => startOfToday(), [])

  const evalPredicate = useCallback(
    (predicate: TodoPredicate, todo: PersistedTodoItem) => {
      const criteria = predicateToCriteria(predicate)
      const people = assignedPeopleMap.get(todo.id) ?? []
      const personIds = people.map((p) => p.id!)
      const tagIds = (assignedTagsMap.get(todo.id) ?? []).map((t) => t.id!)
      const personOrgIds = people.flatMap((p) => personOrgMap.get(p.id!) ?? [])
      const directOrgIds = (assignedOrgsMap.get(todo.id) ?? []).map((o) => o.id!)
      const filterPersonOrgIds = computeFilterPersonOrgIds(criteria.personIds, criteria.personFilterMode, personOrgMap)
      return matchesFilter(criteria, todo, personIds, tagIds, personOrgIds, directOrgIds, filterPersonOrgIds, statuses, today)
    },
    [assignedPeopleMap, assignedTagsMap, assignedOrgsMap, personOrgMap, statuses, today],
  )

  // Compute every pinned list's rendered output. Hero and secondary grid both
  // read from this — the ribbon's tasks-by-horizon derives from the same source.
  const lists = useMemo<DashboardList[]>(() => {
    const hiddenStatusIds = new Set(
      statuses.filter((s) => s.hideByDefault).map((s) => s.id!),
    )
    const pinned = listDefinitions.filter((d) => d.pinnedToDashboard)
    return buildDashboardLists(pinned, todos, {
      today,
      hiddenStatusIds,
      showHiddenStatuses,
      showCompleted,
      evalPredicate,
    })
  }, [listDefinitions, todos, statuses, showHiddenStatuses, showCompleted, today, evalPredicate])

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

  // User-pinned lists NOT mapped to a horizon.
  const userLists = useMemo(
    () => lists.filter((l) => !horizonDefIds.has(l.id)),
    [lists, horizonDefIds],
  )

  const heroList = horizonLists[selectedHorizon]

  // Reverse lookup so we can derive the HorizonKey (if any) behind a rendered list.
  const horizonByDefId = useMemo(() => {
    const m = new Map<number, HorizonKey>()
    for (const key of HORIZON_KEYS) {
      const id = horizonSlots[key]
      if (id != null) m.set(id, key)
    }
    return m
  }, [horizonSlots])

  const handleClick = useCallback((todoId: number) => {
    openEditPopup(todoId)
  }, [openEditPopup])

  const toggleSection = useCallback((key: string) => {
    setCollapsed((s) => ({ ...s, [key]: !s[key] }))
  }, [])

  const resolveCollapse = useCallback((list: DashboardList) => {
    const horizonKey = horizonByDefId.get(list.id)
    if (horizonKey) {
      return {
        collapsed: !!horizonCollapsed[horizonKey],
        onToggle: () => { void setHorizonCollapsed(horizonKey, !horizonCollapsed[horizonKey]) },
      }
    }
    return {
      collapsed: !!collapsed[list.key],
      onToggle: () => toggleSection(list.key),
    }
  }, [horizonByDefId, horizonCollapsed, setHorizonCollapsed, collapsed, toggleSection])

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

  const showNotesDock = notesVisible && !isMobile
  const notesDocked = showNotesDock && (notesDock === 'right' || notesDock === 'bottom')
  const layoutClass = notesDocked ? (styles[`pageLayout_${notesDock}`] ?? styles.pageLayout_right) : ''

  const HERO_PANEL_ID = 'horizon-hero-panel'
  const tabIdFor = useCallback((key: HorizonKey) => `horizon-tab-${key}`, [])

  const horizonDefIdList = useMemo(
    () => Array.from(horizonDefIds),
    [horizonDefIds],
  )

  const handleCreateHorizonTask = useCallback(async (title: string) => {
    await taskEdit.onCreate({ title })
  }, [taskEdit])

  const pageContent = (
    <>
      <div className={styles.page}>
        <div className={`${styles.container} ${notesDocked ? `${styles.pageLayout} ${styles.containerWide}` : ''} ${layoutClass}`}>
          <div className={styles.mainColumn}>
          <div className={styles.pageHeader}>
            <div className={styles.pageTitle}>Dashboard</div>
            {!notesVisible && !isMobile && (
              <button
                type="button"
                className={styles.showNotesBtn}
                onClick={() => void setNotesVisible(true)}
              >
                Show notes
              </button>
            )}
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
                    <SortableCardWrapper key="taskboard" id="top:taskboard">
                      <TaskboardPanel />
                    </SortableCardWrapper>
                  )
                }
                if (!heroList) return null
                const c = resolveCollapse(heroList)
                return (
                  <SortableCardWrapper key="horizon" id="top:horizon">
                    <DashboardListCard
                      list={heroList}
                      variant="hero"
                      collapsed={c.collapsed}
                      onToggleCollapse={c.onToggle}
                      onOpenDetail={handleClick}
                      assignedPeopleMap={assignedPeopleMap}
                      assignedTagsMap={assignedTagsMap}
                      isMobile={isMobile}
                      tabpanelId={HERO_PANEL_ID}
                      tabpanelLabelledBy={tabIdFor(selectedHorizon)}
                      addTaskLabel={heroList.label}
                      onAddTask={handleCreateHorizonTask}
                    />
                  </SortableCardWrapper>
                )
              })}
            </div>
          </SortableContext>

          {(userLists.length > 0 || !isMobile) && (
            <>
              {userLists.length > 0 && (
                <div className={styles.sectionDivider}>Your lists</div>
              )}
              <SortableContext
                items={userLists.map((l) => l.id)}
                strategy={rectSortingStrategy}
              >
                <div className={styles.grid}>
                  {userLists.map((list) => {
                    const c = resolveCollapse(list)
                    return (
                      <SortableCardWrapper key={list.id} id={list.id}>
                        <DashboardListCard
                          list={list}
                          variant="secondary"
                          collapsed={c.collapsed}
                          onToggleCollapse={c.onToggle}
                          onOpenDetail={handleClick}
                          assignedPeopleMap={assignedPeopleMap}
                          assignedTagsMap={assignedTagsMap}
                          isMobile={isMobile}
                        />
                      </SortableCardWrapper>
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
          {notesDocked && (
            <div className={styles.notesDock}>
              <NotesPanel />
            </div>
          )}
        </div>
        {showNotesDock && notesDock === 'floating' && <NotesPanel />}

        {taskEdit.editPopupMode === 'edit' && taskEdit.editProps && (
          <TaskEditPopup
            mode="edit"
            {...taskEdit.editProps}
            allPeople={taskEdit.allPeople}
            allTags={taskEdit.allTags}
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
            assignedTags={[]}
            allTags={taskEdit.allTags}
            onClose={taskEdit.closeEditPopup}
            onCreate={taskEdit.onCreate}
            assignedOrgs={[]}
            allOrgs={taskEdit.allOrgs}
            onAssignPerson={() => {}}
            onUnassignPerson={() => {}}
            onAssignTag={() => {}}
            onUnassignTag={() => {}}
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
          onCreateNew={() => setShowEditor(true)}
        />
      )}
      {slotPickerAt && (
        <ListDefinitionPickerPopup
          x={slotPickerAt.x}
          y={slotPickerAt.y}
          mode="canvas"
          onClose={() => setSlotPickerAt(null)}
          onSelect={handleSlotPick}
          onCreateNew={() => { setShowEditor(true); setSlotPickerAt(null) }}
        />
      )}
      {showEditor && <DashboardListsEditor onClose={() => setShowEditor(false)} />}
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
      collisionDetection={closestCenter}
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
