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

/** The saved list the Eisenhower shows (the app-wide source). */
export interface ListSourceContext {
  /** The list as shown (its unsaved draft, else the saved list). */
  definition: PersistedListDefinition
  /** Its name as edited (its unsaved draft's, unless blank), else as saved. */
  title: string
  /** Open tasks in the app (what the list's own filter can hide). */
  appOpen: number
}

/** The tasks the Eisenhower considers, before its panes sort them. */
export type EisenhowerSource =
  /** Its saved list was deleted. */
  | { kind: 'deleted' }
  | {
    kind: 'tasks'
    /** The source's members passing the screen filter. */
    shown: PersistedTodoItem[]
    /** Open tasks of the source before the screen filter (all, or the list's). */
    openTotal: number
    /** Set when the tab shows a saved list. */
    list?: ListSourceContext
  }

const NO_TASKS: PersistedTodoItem[] = []

export function countOpen(todos: readonly PersistedTodoItem[]): number {
  let n = 0
  for (const t of todos) if (!t.isCompleted) n++
  return n
}

/**
 * The tasks the Eisenhower considers — the app-wide source
 * (`settings-store.eisenhowerListId`): all tasks, or one saved list's (its
 * unsaved draft included; its prompt, group and sort ignored — every member
 * counts) as a list widget runs it; the screen filter narrows either. Used
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

  // All tasks, through the screen filter.
  const allShown = useMemo(
    () => (listId == null ? applyFilter(screen, todos, assignedPeopleMap, statuses, today, assignedTagsMap, settings) : NO_TASKS),
    [listId, screen, todos, assignedPeopleMap, statuses, today, assignedTagsMap, settings],
  )
  const appOpen = useMemo(() => countOpen(todos), [todos])

  // A saved list: only its members matter (its prompt — a temporary pick —,
  // group and sort don't apply to the panes).
  const definition = useEffectiveListDefinition(listId)
  const membersOnly = useMemo<PersistedListDefinition | undefined>(
    () => (definition ? { ...definition, runtimeFilter: undefined, grouping: 'none' } : undefined),
    [definition],
  )
  const built = useBuiltList(membersOnly, undefined, screenActive ? screen : undefined)
  const listShown = built.list?.todos ?? NO_TASKS
  const listOpenTotal = useMemo(() => built.countOpenBase(), [built])
  const title = definition?.name.trim() || savedName || ''
  const list = useMemo<ListSourceContext | undefined>(
    () => (definition ? { definition, title, appOpen } : undefined),
    [definition, title, appOpen],
  )

  return useMemo<EisenhowerSource>(() => {
    if (listId == null) return { kind: 'tasks', shown: allShown, openTotal: appOpen }
    if (!list) return { kind: 'deleted' }
    return { kind: 'tasks', shown: listShown, openTotal: listOpenTotal, list }
  }, [listId, allShown, appOpen, list, listShown, listOpenTotal])
}
