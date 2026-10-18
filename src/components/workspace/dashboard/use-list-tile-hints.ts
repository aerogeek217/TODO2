import { useMemo } from 'react'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { filterChips } from '../../../utils/filter-chips'
import { listTileHint } from './dashboard-copy'

/** Each saved list's filters in a few words (`Status: Waiting`, `@Priya`), by list id. */
export function useListTileHints(): ReadonlyMap<number, string> {
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  return useMemo(() => {
    const names = { people, tags, statuses }
    return new Map(defs.map((d) => [d.id, listTileHint(filterChips(d.membership.predicate, names))]))
  }, [defs, people, tags, statuses])
}
