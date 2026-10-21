import { useMemo } from 'react'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { filterChips, listFilterHint } from '../../../utils/filter-chips'

/** Each list's filters in a few words (`Status: Waiting`, `@Priya`), by list id. */
export function useListTileHints(): ReadonlyMap<number, string> {
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  return useMemo(() => {
    const names = { people, tags, statuses }
    return new Map(defs.map((d) => [d.id, listFilterHint(filterChips(d.membership.predicate, names))]))
  }, [defs, people, tags, statuses])
}
