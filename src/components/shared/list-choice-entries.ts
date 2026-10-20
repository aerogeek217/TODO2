import { listedLists, type PersistedListDefinition } from '../../models/list-definition'
import { bySortOrder } from '../../utils/sort-order'
import type { MenuEntry } from './MenuPopover'

/** A deleted list's name where its name would show (a tab title). */
export const DELETED_LIST_TITLE = '(Deleted list)'

/**
 * The lists a list tab's Change list › offers, in their order, as menu
 * entries each picking its list: the lists the layout the tab is in
 * (`layoutId`) owns (`listedLists`; never the Eisenhower's or another
 * layout's).
 */
export function listChoiceEntries(
  listDefinitions: readonly PersistedListDefinition[],
  onPick: (listDefinitionId: number) => void,
  layoutId: number | undefined,
): MenuEntry[] {
  const defs = listedLists([...listDefinitions].sort(bySortOrder), layoutId)
  const lists = defs.map((d): MenuEntry => ({
    kind: 'item',
    label: d.name,
    onSelect: () => onPick(d.id),
  }))
  return lists.length > 0 ? lists : [{ kind: 'note', text: 'No lists yet.' }]
}
