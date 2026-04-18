import { useEffect, useMemo, useCallback, useState } from 'react'
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

function DashboardListCard({
  list,
  variant,
  collapsed,
  onToggleCollapse,
  onOpenDetail,
  assignedPeopleMap,
  assignedTagsMap,
  isMobile,
}: {
  list: DashboardList
  variant: 'hero' | 'secondary'
  collapsed: boolean
  onToggleCollapse: (key: string) => void
  onOpenDetail: (todoId: number) => void
  assignedPeopleMap: Map<number, Person[]>
  assignedTagsMap: Map<number, Tag[]>
  isMobile: boolean
}) {
  return (
    <div
      className={`${styles.card} ${styles.listCard} ${variant === 'hero' ? styles.heroCard : ''}`}
      data-list-key={list.key}
    >
      <div className={styles.cardHeader} onClick={() => onToggleCollapse(list.key)}>
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
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const notesDock = useSettingsStore((s) => s.notesDock)
  const notesVisible = useSettingsStore((s) => s.notesVisible)
  const setNotesVisible = useSettingsStore((s) => s.setNotesVisible)
  const loadNotes = useNoteStore((s) => s.load)
  const taskEdit = useTaskEditCallbacks()
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeDragTodo, setActiveDragTodo] = useState<PersistedTodoItem | null>(null)
  const [addListPickerPos, setAddListPickerPos] = useState<{ x: number; y: number } | null>(null)
  const [slotPickerAt, setSlotPickerAt] = useState<{ key: HorizonKey; x: number; y: number } | null>(null)
  const [showEditor, setShowEditor] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    if (todo) setActiveDragTodo(todo)
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragTodo(null)
    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    const overData = event.over?.data.current
    if (!todo || overData?.type !== 'taskboard') return
    await useTaskboardStore.getState().add(todo.id)
  }, [])

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
  const otherHorizons: HorizonKey[] = HORIZON_KEYS.filter((k) => k !== selectedHorizon)

  const handleClick = useCallback((todoId: number) => {
    openEditPopup(todoId)
  }, [openEditPopup])

  const toggleSection = useCallback((key: string) => {
    setCollapsed((s) => ({ ...s, [key]: !s[key] }))
  }, [])

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
          />

          <div className={styles.taskboardSection}>
            <TaskboardPanel />
          </div>

          {heroList && (
            <div className={styles.heroSection}>
              <DashboardListCard
                list={heroList}
                variant="hero"
                collapsed={!!collapsed[heroList.key]}
                onToggleCollapse={toggleSection}
                onOpenDetail={handleClick}
                assignedPeopleMap={assignedPeopleMap}
                assignedTagsMap={assignedTagsMap}
                isMobile={isMobile}
              />
            </div>
          )}

          {otherHorizons.some((k) => horizonLists[k]) && (
            <>
              <div className={styles.sectionDivider}>Other horizons</div>
              <div className={styles.grid}>
                {otherHorizons.map((key) => {
                  const list = horizonLists[key]
                  if (!list) return null
                  return (
                    <DashboardListCard
                      key={list.key}
                      list={list}
                      variant="secondary"
                      collapsed={!!collapsed[list.key]}
                      onToggleCollapse={toggleSection}
                      onOpenDetail={handleClick}
                      assignedPeopleMap={assignedPeopleMap}
                      assignedTagsMap={assignedTagsMap}
                      isMobile={isMobile}
                    />
                  )
                })}
              </div>
            </>
          )}

          {(userLists.length > 0 || !isMobile) && (
            <>
              {userLists.length > 0 && (
                <div className={styles.sectionDivider}>Your lists</div>
              )}
              <div className={styles.grid}>
                {userLists.map((list) => (
                  <DashboardListCard
                    key={list.key}
                    list={list}
                    variant="secondary"
                    collapsed={!!collapsed[list.key]}
                    onToggleCollapse={toggleSection}
                    onOpenDetail={handleClick}
                    assignedPeopleMap={assignedPeopleMap}
                    assignedTagsMap={assignedTagsMap}
                    isMobile={isMobile}
                  />
                ))}
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
    </>
  )

  if (isMobile) return pageContent

  return (
    <DndContext
      sensors={sensors}
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
