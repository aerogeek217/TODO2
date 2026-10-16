import { useEffect, useMemo } from 'react'
import type { PersistedTodoItem, TodoPredicate } from '../models'
import type { PersistedListDefinition } from '../models/list-definition'
import type { FilterCriteria } from '../utils/filter-criteria'
import { createPredicateEvaluator, createScreenComposedEvaluator } from '../utils/filter-match'
import { useStatusStore } from '../stores/status-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useSettingsStore } from '../stores/settings-store'
import { useListOrderStore, useListRanks } from '../stores/list-order-store'
import { applyRuntimeFilter, buildDashboardLists, type DashboardList } from '../services/dashboard-lists'
import type { TodoNameLookups } from '../utils/filter'
import { useToday } from './use-today'
import { useFilterSettings } from './use-filter-settings'

export interface BuiltList {
  /** The list's members and sections; `null` without a definition or while its prompt is unanswered. */
  list: DashboardList | null
  /**
   * Members by the list's own filter (and prompt picks) alone, before the
   * screen filter — the "total" a screen filter hides tasks from. Equals
   * `list.todos.length` without a screen filter.
   */
  baseCount: number
  /** The list has a prompt and nothing is picked yet. */
  runtimeFilterPending: boolean
  /** The list's predicate with the prompt picks merged in. */
  mergedPredicate: TodoPredicate | null
  /**
   * Every task the list can show, whatever the prompt pick or the screen
   * filter: the list's own predicate's matches plus what is shown now. What
   * a manual order is planned over (unordered; callers sort).
   */
  orderCandidates: () => PersistedTodoItem[]
}

const NO_CANDIDATES = (): PersistedTodoItem[] => []

const NO_BUILT: BuiltList = { list: null, baseCount: 0, runtimeFilterPending: false, mergedPredicate: null, orderCandidates: NO_CANDIDATES }

/**
 * Runs a list definition over the loaded tasks: its predicate (plus prompt
 * picks, plus the screen filter when given — see `composeScreenFilter`)
 * through `buildDashboardLists`, with the shared name lookups so a
 * predicate's search also hits person / status / tag names. Keeps tag
 * assignments loaded for the task set.
 *
 * `runtimeFilterValue` undefined on a list with a prompt = nothing picked
 * yet; an empty array = no narrowing.
 */
export function useBuiltList(
  definition: PersistedListDefinition | undefined,
  runtimeFilterValue: number[] | undefined,
  screenFilter?: FilterCriteria,
): BuiltList {
  const statuses = useStatusStore((s) => s.statuses)
  const todos = useTodoStore((s) => s.todos)
  const people = usePersonStore((s) => s.people)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const loadTagAssignments = useTagStore((s) => s.loadAssignments)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  // Markers clauses (Urgent by date, Hot) read these settings.
  const markerSettings = useFilterSettings()
  // Date-sensitive predicates roll at midnight.
  const today = useToday()
  const ranks = useListRanks(definition?.id)

  useEffect(() => {
    void useListOrderStore.getState().ensureLoaded()
  }, [])

  // Tag filter clauses read `assignedTagsMap`; keep it populated for the
  // current task set.
  useEffect(() => {
    if (todos.length === 0) return
    loadTagAssignments(todos.map((t) => t.id))
  }, [todos, loadTagAssignments])

  return useMemo<BuiltList>(() => {
    if (!definition) return NO_BUILT
    const runtimeFilterPending = definition.runtimeFilter != null && runtimeFilterValue == null
    const mergedPredicate = runtimeFilterPending
      ? null
      : definition.runtimeFilter && runtimeFilterValue && runtimeFilterValue.length > 0
        ? applyRuntimeFilter(definition.membership.predicate, definition.runtimeFilter, runtimeFilterValue)
        : definition.membership.predicate
    if (runtimeFilterPending) return { ...NO_BUILT, runtimeFilterPending }

    const lookups: TodoNameLookups = {
      assignedPeopleMap,
      assignedTagsMap,
      statusesById: new Map(statuses.map((st) => [st.id!, st])),
    }
    const listOnly = createPredicateEvaluator(lookups, today, markerSettings)
    const evalPredicate = screenFilter ? createScreenComposedEvaluator(screenFilter, lookups, today, markerSettings) : listOnly
    const runtimeFilterValues = definition.runtimeFilter && runtimeFilterValue != null
      ? new Map<number, number[]>([[definition.id, runtimeFilterValue]])
      : undefined
    const [list] = buildDashboardLists([definition], todos, {
      today,
      weekStartsOn,
      evalPredicate,
      assignedTagsMap,
      assignedPeopleMap,
      people,
      statuses,
      runtimeFilterValues,
      listRanks: new Map([[definition.id, ranks]]),
    })
    const baseCount = screenFilter && mergedPredicate
      ? countMatching(todos, (t) => listOnly(mergedPredicate, t))
      : (list?.todos.length ?? 0)
    const ownPredicate = definition.membership.predicate
    const orderCandidates = () => {
      const shown = new Set((list?.todos ?? []).map((t) => t.id))
      return todos.filter((t) => shown.has(t.id) || listOnly(ownPredicate, t))
    }
    return { list: list ?? null, baseCount, runtimeFilterPending, mergedPredicate, orderCandidates }
  }, [
    definition, todos, people, assignedPeopleMap,
    assignedTagsMap, statuses, today, weekStartsOn, runtimeFilterValue, screenFilter, ranks, markerSettings,
  ])
}

function countMatching(todos: readonly PersistedTodoItem[], match: (t: PersistedTodoItem) => boolean): number {
  let n = 0
  for (const t of todos) if (match(t)) n++
  return n
}
