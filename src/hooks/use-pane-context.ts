import { useMemo } from 'react'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import type { PaneContext } from '../utils/eisenhower'
import { useFilterSettings } from './use-filter-settings'
import { useToday } from './use-today'

/**
 * What the Eisenhower panes' filters are evaluated with (`classifyPanes`,
 * `resolvePaneDrop`), subscribed: today, the filter settings, the people /
 * tag assignments and the names.
 */
export function usePaneContext(): PaneContext {
  const today = useToday()
  const settings = useFilterSettings()
  const people = usePersonStore((s) => s.people)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const tags = useTagStore((s) => s.tags)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statuses = useStatusStore((s) => s.statuses)
  return useMemo(
    () => ({ today, settings, people, assignedPeopleMap, tags, assignedTagsMap, statuses }),
    [today, settings, people, assignedPeopleMap, tags, assignedTagsMap, statuses],
  )
}
