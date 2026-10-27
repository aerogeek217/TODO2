import { useMemo } from 'react'
import { screenTaskCounts, type ScreenTaskCounts } from '../services/task-dialog'
import { useScreenFilter } from '../stores/screen-filter'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import { useFilterSettings } from './use-filter-settings'
import { useToday } from './use-today'

/**
 * What the screen filter (the chips with the top bar's lens) keeps —
 * what its task dialog lists (open ones, completed too under Show
 * completed) — of every such task, and what the lens alone keeps
 * (`screenTaskCounts`), kept current.
 */
export function useScreenTaskCounts(): ScreenTaskCounts {
  const todos = useTodoStore((s) => s.todos)
  const screen = useScreenFilter().filters
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statuses = useStatusStore((s) => s.statuses)
  const { urgentRange, hotRule, weekStartsOn } = useFilterSettings()
  const today = useToday()
  return useMemo(
    () => screenTaskCounts({
      todos, screen, assignedPeopleMap, assignedTagsMap, statuses, today, weekStartsOn,
      markerSettings: { urgentRange, hotRule },
    }),
    [todos, screen, assignedPeopleMap, assignedTagsMap, statuses, today, weekStartsOn, urgentRange, hotRule],
  )
}

/** How many tasks the screen filter matches — what its task dialog lists — kept current. */
export function useScreenTaskCount(): number {
  return useScreenTaskCounts().shown
}
