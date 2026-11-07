import { useMemo } from 'react'
import { useFilterStore } from '../stores/filter-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useAppliedLens } from '../stores/screen-filter'
import type { FilterCriteria } from '../utils/filter-criteria'
import { withLens, type Lens } from '../utils/lens'
import type { LensProbe } from './use-built-list'

/** The screen filter as one list applies it (`useListScreenFilter`). */
export interface ListScreenFilter {
  /** What the list filters by: the chips, with the lens unless the list ignores it; undefined while nothing narrows. */
  filters: FilterCriteria | undefined
  /** The top bar's lens as it applies now (picked, not lifted), whether or not this list ignores it. */
  lens: Lens | undefined
  /** The saved list says the lens doesn't apply here (`ListDefinition.ignoreLens`). */
  ignoresLens: boolean
  /** While a lens applies at the top bar: what `useBuiltList` measures it against (its `lensHides`). */
  probe: LensProbe | undefined
}

/**
 * The screen filter for list `listId` (`stores/screen-filter`, per list):
 * the top bar's chips, and its lens unless the saved list ignores it — read
 * from the saved list, never a draft (the switch is saved at once).
 */
export function useListScreenFilter(listId: number | undefined): ListScreenFilter {
  const chips = useFilterStore((s) => s.filters)
  const chipsActive = useFilterStore((s) => s.isActive)
  const lens = useAppliedLens()
  const ignoresLens = useListDefinitionStore((s) => listId != null && s.listDefinitions.find((d) => d.id === listId)?.ignoreLens === true)
  return useMemo(() => {
    const applied = ignoresLens ? undefined : lens
    return {
      filters: chipsActive || applied ? withLens(chips, applied) : undefined,
      lens,
      ignoresLens,
      probe: lens ? { chips: chipsActive ? chips : undefined, lensed: withLens(chips, lens) } : undefined,
    }
  }, [chips, chipsActive, lens, ignoresLens])
}
