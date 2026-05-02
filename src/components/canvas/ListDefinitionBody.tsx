import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PersistedTodoItem, Person, TodoPredicate } from '../../models'
import {
  matchesFilter,
  predicateToCriteria,
  computeFilterPersonOrgIds,
} from '../../stores/filter-store'
import { useStatusStore } from '../../stores/status-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useProjectStore } from '../../stores/project-store'
import { useTagStore } from '../../stores/tag-store'
import { useUIStore } from '../../stores/ui-store'
import { useSettingsStore } from '../../stores/settings-store'
import { applyRuntimeFilter, buildDashboardLists, type DashboardList } from '../../services/dashboard-lists'
import { predicateToFilterDefaults } from '../../utils/filter-defaults'
import { startOfToday } from '../../utils/date'
import { TaskRow } from '../task/TaskRow'
import { RuntimeFilterPicker } from './RuntimeFilterPicker'
import groupStyles from './ListDefinitionBody.module.css'

// Stable empty array sentinel — reused across renders so `filteredTodos`
// doesn't churn its reference when `builtList` is null (no def / runtime
// filter unset). Without this, the `onResult` effect triggers an infinite
// re-render loop with callers that pass an inline-arrow `onResult`.
const EMPTY_TODOS: PersistedTodoItem[] = []

export interface ListDefinitionBodyRenderRowArgs {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  onOpenDetail: (todoId: number) => void
}

interface ListDefinitionBodyProps {
  listDefinitionId: number | undefined
  onResult?: (result: { name: string | null; count: number; todos: PersistedTodoItem[] }) => void
  renderRow?: (args: ListDefinitionBodyRenderRowArgs) => ReactNode
  showContext?: boolean
  emptyLabel?: string
  className?: string
  emptyClassName?: string
  /**
   * Caller-owned runtime-filter picks for definitions that declare
   * `runtimeFilter`. When the definition has a runtime filter but `value` is
   * undefined, the body renders a "Pick a {label} to populate…" placeholder
   * and emits zero todos. An empty array is "explicit no narrowing" — the
   * placeholder is suppressed and the list shows every member of the
   * baseline predicate. Ignored when the definition has no runtime filter.
   */
  runtimeFilterValue?: number[]
  /** Setter paired with `runtimeFilterValue`. Required when runtime filter is active. */
  onRuntimeFilterChange?: (value: number[] | undefined) => void
  /**
   * When true, render a footer "+ Add task" button that opens QuickAddBar
   * with the definition's predicate (post-runtime-filter merge) seeded as
   * task creation defaults. Suppressed when there is no live definition,
   * when its membership is non-custom, or when a runtime filter prompt
   * is unset (the predicate isn't fully specified yet).
   */
  showAddTask?: boolean
}

/**
 * Shared body for `ListInsetNode` (canvas) and `LensSlotContent` (rails).
 * Reads global filter + membership stores, runs the definition through
 * `buildDashboardLists`, and renders a flat list via `renderRow` (or a plain
 * `<TaskRow>` by default). `onResult` reports `{name, count}` so callers can
 * drive their title chrome without rebuilding the pipeline.
 */
export function ListDefinitionBody({
  listDefinitionId,
  onResult,
  renderRow,
  showContext,
  emptyLabel = 'No tasks',
  className,
  emptyClassName,
  runtimeFilterValue,
  onRuntimeFilterChange,
  showAddTask,
}: ListDefinitionBodyProps) {
  const statuses = useStatusStore((s) => s.statuses)
  const definition = useListDefinitionStore((s) =>
    listDefinitionId != null ? s.listDefinitions.find((d) => d.id === listDefinitionId) : undefined,
  )
  const todos = useTodoStore((s) => s.todos)
  const people = usePersonStore((s) => s.people)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const orgs = useOrgStore((s) => s.orgs)
  const assignedOrgsMap = useOrgStore((s) => s.assignedOrgsMap)
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const projects = useProjectStore((s) => s.projects)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const loadTagAssignments = useTagStore((s) => s.loadAssignments)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)

  // Tag filter predicate clauses read via `assignedTagsMap`; make sure the
  // map is populated for the current todo corpus. Mirrors people/org loads
  // in `CanvasPage` for the filter-store path.
  useEffect(() => {
    if (todos.length === 0) return
    loadTagAssignments(todos.map((t) => t.id))
  }, [todos, loadTagAssignments])

  // Date-sensitive predicates roll at midnight; re-key the memo on day change.
  const [dayKey, setDayKey] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  })
  useEffect(() => {
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    const timer = setTimeout(() => {
      const d = new Date()
      setDayKey(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
    }, Math.max(1000, nextMidnight - now.getTime() + 50))
    return () => clearTimeout(timer)
  }, [dayKey])

  const runtimeFilterPending = definition?.runtimeFilter != null && runtimeFilterValue == null

  const builtList = useMemo<DashboardList | null>(() => {
    if (!definition) return null
    if (runtimeFilterPending) return null
    const today = startOfToday()
    const evalPredicate = (predicate: TodoPredicate, todo: PersistedTodoItem) => {
      const criteria = predicateToCriteria(predicate)
      const assignedPeople = assignedPeopleMap.get(todo.id) ?? []
      const personIds = assignedPeople.map((p) => p.id!)
      const personOrgIds = assignedPeople.flatMap((p) => personOrgMap.get(p.id!) ?? [])
      const directOrgIds = (assignedOrgsMap.get(todo.id) ?? []).map((o) => o.id!)
      const assignedTagIds = (assignedTagsMap.get(todo.id) ?? []).map((t) => t.id!)
      const filterPersonOrgIds = computeFilterPersonOrgIds(
        criteria.personIds, criteria.personFilterMode, personOrgMap,
      )
      return matchesFilter(
        criteria, todo, personIds, personOrgIds, directOrgIds, filterPersonOrgIds, statuses, today, undefined, assignedTagIds,
      )
    }
    const runtimeFilterValues = definition.runtimeFilter && runtimeFilterValue != null
      ? new Map<number, number[]>([[definition.id, runtimeFilterValue]])
      : undefined
    const [list] = buildDashboardLists([definition], todos, {
      today,
      weekStartsOn,
      evalPredicate,
      assignedTagsMap,
      assignedPeopleMap,
      assignedOrgsMap,
      personOrgMap,
      people,
      orgs,
      projects,
      statuses,
      runtimeFilterValues,
    })
    return list ?? null
  }, [
    definition, todos, people, assignedPeopleMap,
    orgs, assignedOrgsMap, personOrgMap, projects,
    assignedTagsMap, statuses, dayKey, weekStartsOn,
    runtimeFilterValue, runtimeFilterPending,
  ])

  const filteredTodos = builtList?.todos ?? EMPTY_TODOS
  const groups = builtList?.groups

  // Keep a live ref to `onResult` so the notify-effect doesn't depend on
  // callback identity. Callers routinely pass inline arrows; depending on the
  // callback ref would refire the effect every parent render and, combined
  // with a fresh `todos` reference (see EMPTY_TODOS note), would cascade into
  // an update loop. Ref pattern lets the effect fire only on real data change.
  const onResultRef = useRef(onResult)
  useEffect(() => { onResultRef.current = onResult }, [onResult])

  useEffect(() => {
    onResultRef.current?.({ name: definition?.name ?? null, count: filteredTodos.length, todos: filteredTodos })
  }, [definition?.name, filteredTodos])

  const pickerLabel = definition?.runtimeFilter?.label?.trim() || (definition?.runtimeFilter
    ? (definition.runtimeFilter.field.charAt(0).toUpperCase() + definition.runtimeFilter.field.slice(1))
    : '')
  const placeholderText = runtimeFilterPending
    ? `Pick a ${pickerLabel.toLowerCase()} to populate…`
    : emptyLabel

  // Footer "+ Add task" gating:
  // - Runtime-filter prompt unset → predicate is incomplete; the placeholder
  //   already steers the user to RuntimeFilterPicker, so suppress the button.
  // - Predicate has no seedable axis (only date / search / completion clauses)
  //   → the seed would be empty, and the global FAB does the same thing.
  //   Surface the button only when the predicate filters by at least one of
  //   project / people / org / status / tag.
  const mergedPredicate = (definition?.membership.kind === 'custom' && !runtimeFilterPending)
    ? ((definition.runtimeFilter && runtimeFilterValue && runtimeFilterValue.length > 0)
        ? applyRuntimeFilter(definition.membership.predicate, definition.runtimeFilter, runtimeFilterValue)
        : definition.membership.predicate)
    : null
  const hasSeedableFilter = mergedPredicate != null && (
    mergedPredicate.projectIds != null
    || mergedPredicate.personIds != null
    || mergedPredicate.orgIds != null
    || mergedPredicate.statusIds != null
    || (mergedPredicate.tags != null && mergedPredicate.tags.length > 0)
  )
  const canAddTask = !!showAddTask
    && !!definition
    && definition.membership.kind === 'custom'
    && !runtimeFilterPending
    && hasSeedableFilter

  const handleAddTaskClick = () => {
    if (!canAddTask || !mergedPredicate) return
    const defaults = predicateToFilterDefaults(mergedPredicate)
    useUIStore.getState().openQuickAdd({ defaults })
  }

  const renderTodoRow = (todo: PersistedTodoItem) => {
    const args: ListDefinitionBodyRenderRowArgs = {
      todo,
      assignedPeople: assignedPeopleMap.get(todo.id),
      onOpenDetail: openEditPopup,
    }
    if (renderRow) return <Fragment key={todo.id}>{renderRow(args)}</Fragment>
    return (
      <TaskRow
        key={todo.id}
        todo={todo}
        assignedPeople={args.assignedPeople}
        onOpenDetail={() => openEditPopup(todo.id)}
        showContext={showContext}
      />
    )
  }

  return (
    <>
      {definition?.runtimeFilter && onRuntimeFilterChange && (
        <RuntimeFilterPicker
          spec={definition.runtimeFilter}
          value={runtimeFilterValue}
          onChange={onRuntimeFilterChange}
        />
      )}
      {filteredTodos.length === 0 ? (
        <div className={emptyClassName}>{placeholderText}</div>
      ) : groups && groups.length > 0 ? (
        <div className={className}>
          {groups.map((g) => (
            <div key={g.key}>
              <div className={groupStyles.groupHeader}>
                <span className={groupStyles.groupLabel}>{g.label}</span>
                <span className={groupStyles.groupCount}>{g.todos.length}</span>
              </div>
              {g.todos.map(renderTodoRow)}
            </div>
          ))}
        </div>
      ) : (
        <div className={className}>
          {filteredTodos.map(renderTodoRow)}
        </div>
      )}
      {canAddTask && (
        <div className={groupStyles.addFooter}>
          <button
            type="button"
            className={groupStyles.addButton}
            onClick={handleAddTaskClick}
            title="Add a task to this list"
          >
            + Add task
          </button>
        </div>
      )}
    </>
  )
}
