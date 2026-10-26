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
import { applyRuntimeFilter, buildList, type ListContents } from '../services/build-list'
import type { TodoNameLookups } from '../utils/filter'
import { useToday } from './use-today'
import { useFilterSettings } from './use-filter-settings'
import { keptOf, restoreLeaving, type LeavingRows } from './use-leaving-rows'

export interface BuiltList {
  /** The list's members and sections; `null` without a definition or while its prompt is unanswered. */
  list: ListContents | null
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
  /**
   * Open tasks the list's own filter (and prompt picks) matches, before the
   * screen filter — the total an Eisenhower widget on the list counts its
   * open tasks against. Computed on call.
   */
  countOpenBase: () => number
  /**
   * Of the `leaving` tasks, the ones kept in place (as they were before they
   * were completed) because the list would otherwise drop them now.
   */
  kept: ReadonlySet<number>
}

const NO_CANDIDATES = (): PersistedTodoItem[] => []
const NO_COUNT = (): number => 0
const NO_IDS: ReadonlySet<number> = new Set()

const NO_BUILT: BuiltList = {
  list: null,
  baseCount: 0,
  runtimeFilterPending: false,
  mergedPredicate: null,
  orderCandidates: NO_CANDIDATES,
  countOpenBase: NO_COUNT,
  kept: NO_IDS,
}

/**
 * Runs a list definition over the loaded tasks: its predicate (plus prompt
 * picks, plus the screen filter when given — see `composeScreenFilter`)
 * through `buildList`, with the shared name lookups so a
 * predicate's search also hits person / status / tag names. Keeps tag
 * assignments loaded for the task set.
 *
 * `runtimeFilterValue` undefined on a list with a prompt = nothing picked
 * yet; an empty array = no narrowing.
 *
 * `leaving` (D19, `useLeavingRows`): tasks just completed that this list
 * showed. Where the list would drop one now, it is built as it was just
 * before the completion (open, its `modifiedAt` unmoved — a Modified sort or
 * clause keeps it too), so its row keeps its place until it has folded
 * away; `kept` names those. Only membership, order and grouping read the
 * kept build: its row shows the task as it is now (`useKeptTodos`).
 */
export function useBuiltList(
  definition: PersistedListDefinition | undefined,
  runtimeFilterValue: number[] | undefined,
  screenFilter?: FilterCriteria,
  leaving?: LeavingRows,
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
    const build = (from: readonly PersistedTodoItem[]) => buildList(definition, from, {
      today,
      weekStartsOn,
      evalPredicate,
      assignedTagsMap,
      assignedPeopleMap,
      people,
      statuses,
      runtimeFilterValue,
      ranks,
      urgentRange: markerSettings.urgentRange,
      hotRule: markerSettings.hotRule,
    })
    let list = build(todos)
    let kept: ReadonlySet<number> = NO_IDS
    if (leaving && leaving.size > 0) {
      const dropped = keptOf(leaving, new Set(list.todos.map((t) => t.id)))
      if (dropped.size > 0) {
        list = build(restoreLeaving(todos, leaving, dropped))
        kept = dropped
      }
    }
    const baseCount = screenFilter && mergedPredicate
      ? countMatching(todos, (t) => listOnly(mergedPredicate, t))
      : list.todos.length
    const ownPredicate = definition.membership.predicate
    const orderCandidates = () => {
      const shown = new Set(list.todos.map((t) => t.id))
      return todos.filter((t) => shown.has(t.id) || listOnly(ownPredicate, t))
    }
    const countOpenBase = () => (mergedPredicate ? countMatching(todos, (t) => !t.isCompleted && listOnly(mergedPredicate, t)) : 0)
    return { list, baseCount, runtimeFilterPending, mergedPredicate, orderCandidates, countOpenBase, kept }
  }, [
    definition, todos, people, assignedPeopleMap,
    assignedTagsMap, statuses, today, weekStartsOn, runtimeFilterValue, screenFilter, ranks, markerSettings, leaving,
  ])
}

function countMatching(todos: readonly PersistedTodoItem[], match: (t: PersistedTodoItem) => boolean): number {
  let n = 0
  for (const t of todos) if (match(t)) n++
  return n
}
