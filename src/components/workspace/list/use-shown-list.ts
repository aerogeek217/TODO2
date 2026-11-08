import { useEffect, useMemo } from 'react'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { useListWidgetStore, type ShownList, type ShownListSection } from '../../../stores/list-widget-store'
import { describeFilters, predicateLineItems } from '../../../utils/filter-chips'
import { groupSortSummary } from '../../../utils/list-options'
import { useChipNames } from '../../shared/filters/filter-menu'

/** A list in words for a review's header: `list · Status Waiting · People · Due date`. */
export function shownListDescription(definition: PersistedListDefinition, filters: string): string {
  const parts = ['list', filters, groupSortSummary(definition.grouping, definition.sort, definition.sortDirection)]
  return parts.filter((p) => p !== '').join(' · ')
}

/**
 * Reports a list tab's tasks as its widget shows them (`list-widget-store
 * .shown`), for a review of the tab (its menu's Review, the shortcut, the
 * palette) — next to the widget's own report to its cell. `sections` null
 * (the prompt not answered yet): nothing to review. Removed when the
 * widget goes, unless another widget of the tab has written since.
 */
export function useShownListReport(
  tabId: string,
  definition: PersistedListDefinition,
  sections: readonly ShownListSection[] | null,
): void {
  const names = useChipNames()
  const predicate = definition.membership.predicate
  const filters = useMemo(() => describeFilters(predicateLineItems(predicate, names)), [predicate, names])
  const description = shownListDescription(definition, filters)
  const grouped = definition.grouping !== 'none'
  const label = definition.name
  const shown = useMemo<ShownList | null>(
    () => (sections ? { label, description, grouped, sections } : null),
    [label, description, grouped, sections],
  )
  useEffect(() => {
    const store = useListWidgetStore.getState()
    store.setShown(tabId, shown)
    return () => {
      const now = useListWidgetStore.getState()
      if (now.shown[tabId] === shown) now.setShown(tabId, null)
    }
  }, [tabId, shown])
}
