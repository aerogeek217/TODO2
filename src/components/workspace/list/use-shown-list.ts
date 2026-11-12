import { useEffect, useId, useMemo } from 'react'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { useListWidgetStore, type ShownList, type ShownListSection } from '../../../stores/list-widget-store'
import { describeFilters, predicateLineItems } from '../../../utils/filter-chips'
import { groupSortSummary } from '../../../utils/list-options'
import { registerModuleReset } from '../../../utils/module-reset'
import { useChipNames } from '../../shared/filters/filter-menu'

/** A list in words for a review's header: `list · Status Waiting · People · Due date`. */
export function shownListDescription(definition: PersistedListDefinition, filters: string): string {
  const parts = ['list', filters, groupSortSummary(definition.grouping, definition.sort, definition.sortDirection)]
  return parts.filter((p) => p !== '').join(' · ')
}

/**
 * The widgets showing each tab now, by tab id: each one's id and what it
 * last reported, the latest last. A tab can show in two widgets at once —
 * its small face, and the full list in the widget popup —, so the store
 * holds the latest writer's report, and a writer going hands the tab back
 * to the one still there.
 */
const writers = new Map<string, Array<{ owner: string; shown: ShownList | null }>>()
registerModuleReset(() => writers.clear())

function publish(tabId: string): void {
  const latest = writers.get(tabId)?.at(-1)
  useListWidgetStore.getState().setShown(tabId, latest?.shown ?? null)
}

/**
 * Reports a list tab's tasks as its widget shows them (`list-widget-store
 * .shown`), for a review of the tab (its menu's Review, the shortcut, the
 * palette) — next to the widget's own report to its cell. `sections` null
 * (the prompt not answered yet): nothing to review. With two widgets on
 * the tab (a face and its popover), the latest report shows; when one goes,
 * the other's report is the tab's again; the last one going removes it.
 */
export function useShownListReport(
  tabId: string,
  definition: PersistedListDefinition,
  sections: readonly ShownListSection[] | null,
): void {
  const owner = useId()
  const names = useChipNames()
  const predicate = definition.membership.predicate
  const filters = useMemo(() => describeFilters(predicateLineItems(predicate, names)), [predicate, names])
  const description = shownListDescription(definition, filters)
  const grouped = definition.grouping !== 'none'
  const label = definition.name
  const listId = definition.id
  const shown = useMemo<ShownList | null>(
    () => (sections ? { listId, label, description, grouped, sections } : null),
    [listId, label, description, grouped, sections],
  )
  useEffect(() => {
    const list = (writers.get(tabId) ?? []).filter((w) => w.owner !== owner)
    list.push({ owner, shown })
    writers.set(tabId, list)
    publish(tabId)
    return () => {
      const rest = (writers.get(tabId) ?? []).filter((w) => w.owner !== owner)
      if (rest.length > 0) writers.set(tabId, rest)
      else writers.delete(tabId)
      publish(tabId)
    }
  }, [tabId, owner, shown])
}
