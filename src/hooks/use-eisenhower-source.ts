import { useMemo } from 'react'
import type { PersistedTodoItem } from '../models'
import type { PersistedListDefinition } from '../models/list-definition'
import { useBuiltList } from './use-built-list'
import { useFilterSettings } from './use-filter-settings'
import { useEffectiveListDefinition } from './use-list-draft'
import { useToday } from './use-today'
import { useFilterStore } from '../stores/filter-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useSettingsStore } from '../stores/settings-store'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import { applyFilter } from '../utils/filter-match'
import { hasNarrowingFilters } from '../utils/filter-chips'

/** The Eisenhower's own list, as the Eisenhower shows it. */
export interface ListSourceContext {
  /** The list as shown (its unsaved draft, else the saved list). */
  definition: PersistedListDefinition
  /** Its name as edited (its unsaved draft's, unless blank), else as saved. */
  title: string
  /** Whether its filter narrows the tasks (`hasNarrowingFilters`); a list without one holds every task. */
  narrows: boolean
  /** Open tasks in the app (what the list's own filter can hide). */
  appOpen: number
}

/** The tasks the Eisenhower considers, before its panes sort them. */
export interface EisenhowerSource {
  /** The list's members passing the screen filter. */
  shown: PersistedTodoItem[]
  /** Open tasks of the list before the screen filter. */
  openTotal: number
  /** The Eisenhower's list; absent only until it is loaded (all tasks are considered then, as its empty filter would). */
  list?: ListSourceContext
}

const NO_TASKS: PersistedTodoItem[] = []

export function countOpen(todos: readonly PersistedTodoItem[]): number {
  let n = 0
  for (const t of todos) if (!t.isCompleted) n++
  return n
}

/**
 * The tasks the Eisenhower considers — its own list's
 * (`settings-store.eisenhowerListId`; its unsaved draft included; its
 * prompt, group and sort ignored — every member counts) as a list widget
 * runs it, the screen filter narrowing it. Until the list is loaded, all
 * tasks through the screen filter (what a list with no filter holds). Used
 * by every Eisenhower widget and by Settings › Tasks › Eisenhower (the live
 * counts).
 */
export function useEisenhowerSource(): EisenhowerSource {
  const listId = useSettingsStore((s) => s.eisenhowerListId) ?? undefined
  const savedName = useListDefinitionStore((s) => (listId != null ? s.listDefinitions.find((d) => d.id === listId)?.name : undefined))
  const today = useToday()
  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statuses = useStatusStore((s) => s.statuses)
  const screen = useFilterStore((s) => s.filters)
  const screenActive = useFilterStore((s) => s.isActive)
  const settings = useFilterSettings()

  // Only its members matter (its prompt — a temporary pick —, group and
  // sort don't apply to the panes).
  const definition = useEffectiveListDefinition(listId)
  const membersOnly = useMemo<PersistedListDefinition | undefined>(
    () => (definition ? { ...definition, runtimeFilter: undefined, grouping: 'none' } : undefined),
    [definition],
  )
  const built = useBuiltList(membersOnly, undefined, screenActive ? screen : undefined)
  const listShown = built.list?.todos ?? NO_TASKS
  const listOpenTotal = useMemo(() => built.countOpenBase(), [built])
  const appOpen = useMemo(() => countOpen(todos), [todos])
  const title = definition?.name.trim() || savedName || ''
  const list = useMemo<ListSourceContext | undefined>(
    () => (definition
      ? { definition, title, narrows: hasNarrowingFilters(definition.membership.predicate), appOpen }
      : undefined),
    [definition, title, appOpen],
  )

  // Not loaded yet: all tasks, through the screen filter.
  const allShown = useMemo(
    () => (definition ? NO_TASKS : applyFilter(screen, todos, assignedPeopleMap, statuses, today, assignedTagsMap, settings)),
    [definition, screen, todos, assignedPeopleMap, statuses, today, assignedTagsMap, settings],
  )

  return useMemo<EisenhowerSource>(
    () => (list ? { shown: listShown, openTotal: listOpenTotal, list } : { shown: allShown, openTotal: appOpen }),
    [list, listShown, listOpenTotal, allShown, appOpen],
  )
}
