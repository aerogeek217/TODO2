import { useMemo } from 'react'
import { screenTaskCount } from '../services/task-dialog'
import { useFilterStore } from '../stores/filter-store'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import { useFilterSettings } from './use-filter-settings'
import { useToday } from './use-today'

/**
 * How many tasks the screen filter matches — what its task dialog lists
 * (`screenTaskCount`: open ones, completed too under Show completed), kept
 * current.
 */
export function useScreenTaskCount(): number {
  const todos = useTodoStore((s) => s.todos)
  const screen = useFilterStore((s) => s.filters)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statuses = useStatusStore((s) => s.statuses)
  const { urgentRange, hotRule, weekStartsOn } = useFilterSettings()
  const today = useToday()
  return useMemo(
    () => screenTaskCount({
      todos, screen, assignedPeopleMap, assignedTagsMap, statuses, today, weekStartsOn,
      markerSettings: { urgentRange, hotRule },
    }),
    [todos, screen, assignedPeopleMap, assignedTagsMap, statuses, today, weekStartsOn, urgentRange, hotRule],
  )
}
