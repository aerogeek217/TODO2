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
import { useUIStore } from '../stores/ui-store'
import { useFilterStore } from '../stores/filter-store'
import { useStatusStore } from '../stores/status-store'
import { useTaskboardStore } from '../stores/taskboard-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { useIsMobile } from '../hooks/use-is-mobile'
import { TaskRow } from '../components/task/TaskRow'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import type { PersistedTodoItem, Person, Tag } from '../models'
import { startOfToday } from '../utils/date'
import { buildDashboardLists, type DashboardList } from '../services/dashboard-lists'
import { TaskboardPanel } from '../components/taskboard/TaskboardPanel'
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
  collapsed,
  onToggleCollapse,
  onOpenDetail,
  assignedPeopleMap,
  assignedTagsMap,
  isMobile,
}: {
  list: DashboardList
  collapsed: boolean
  onToggleCollapse: (key: string) => void
  onOpenDetail: (todoId: number) => void
  assignedPeopleMap: Map<number, Person[]>
  assignedTagsMap: Map<number, Tag[]>
  isMobile: boolean
}) {
  return (
    <div className={`${styles.card} ${styles.listCard}`} data-list-key={list.key}>
      <div className={styles.cardHeader} onClick={() => onToggleCollapse(list.key)}>
        <span className={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ''}`}>&#9662;</span>
        <span className={styles.cardTitle}>{list.label}</span>
        <span className={styles.cardCount}>{list.todos.length}</span>
      </div>
      {!collapsed && (
        <div className={styles.cardBody}>
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
  const { load: loadOrgs, loadAssignments: loadOrgAssignments } = useOrgStore()
  const { openEditPopup } = useUIStore()
  const { statuses, load: loadStatuses } = useStatusStore()
  const showHiddenStatuses = useFilterStore((s) => s.filters.showHiddenStatuses)
  const showCompleted = useFilterStore((s) => s.filters.showCompleted)
  const { load: loadTaskboard } = useTaskboardStore()
  const { listDefinitions, load: loadDefinitions } = useListDefinitionStore()
  const taskEdit = useTaskEditCallbacks()
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeDragTodo, setActiveDragTodo] = useState<PersistedTodoItem | null>(null)

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
  }, [loadAll, loadPeople, loadTags, loadOrgs, loadStatuses, loadTaskboard, loadDefinitions])

  useEffect(() => {
    const todoIds = todos.map((t) => t.id)
    if (todoIds.length > 0) {
      loadPeopleAssignments(todoIds)
      loadTagAssignments(todoIds)
      loadOrgAssignments(todoIds)
    }
  }, [todos, loadPeopleAssignments, loadTagAssignments, loadOrgAssignments])

  const lists = useMemo<DashboardList[]>(() => {
    const today = startOfToday()
    const hiddenStatusIds = new Set(
      statuses.filter((s) => s.hideByDefault).map((s) => s.id!),
    )
    return buildDashboardLists(listDefinitions, todos, {
      today,
      hiddenStatusIds,
      showHiddenStatuses,
      showCompleted,
    })
  }, [listDefinitions, todos, statuses, showHiddenStatuses, showCompleted])

  const handleClick = useCallback((todoId: number) => {
    openEditPopup(todoId)
  }, [openEditPopup])

  const toggleSection = useCallback((key: string) => {
    setCollapsed((s) => ({ ...s, [key]: !s[key] }))
  }, [])

  const pageContent = (
    <>
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.pageHeader}>
            <div className={styles.pageTitle}>Dashboard</div>
          </div>

          <div className={styles.taskboardSection}>
            <TaskboardPanel />
          </div>

          {listDefinitions.length === 0 ? (
            <div className={styles.emptyState}>
              No dashboard lists. Reset by reloading.
            </div>
          ) : (
            <div className={styles.grid}>
              {lists.map((list) => (
                <DashboardListCard
                  key={list.key}
                  list={list}
                  collapsed={!!collapsed[list.key]}
                  onToggleCollapse={toggleSection}
                  onOpenDetail={handleClick}
                  assignedPeopleMap={assignedPeopleMap}
                  assignedTagsMap={assignedTagsMap}
                  isMobile={isMobile}
                />
              ))}
            </div>
          )}
        </div>

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
