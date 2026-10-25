import { useMemo } from 'react'
import { lensHideCounts, type LensHideCounts } from '../services/lenses'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import type { Lens } from '../utils/lens'
import { useFilterSettings } from './use-filter-settings'
import { useToday } from './use-today'

/** How many open tasks each of `lenses` hides right now (`lensHideCounts`), kept current. */
export function useLensHideCounts(lenses: readonly Lens[]): LensHideCounts {
  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statuses = useStatusStore((s) => s.statuses)
  const { urgentRange, hotRule, weekStartsOn } = useFilterSettings()
  const today = useToday()
  return useMemo(
    () => lensHideCounts({
      todos, assignedPeopleMap, assignedTagsMap, statuses, today, weekStartsOn,
      markerSettings: { urgentRange, hotRule },
    }, lenses),
    [lenses, todos, assignedPeopleMap, assignedTagsMap, statuses, today, weekStartsOn, urgentRange, hotRule],
  )
}
