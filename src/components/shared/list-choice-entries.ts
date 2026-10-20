import { listedLists, ownerLayoutId, type PersistedListDefinition } from '../../models/list-definition'
import { bySortOrder } from '../../utils/sort-order'
import type { MenuEntry } from './MenuPopover'

/** A deleted list's name where its name would show (a tab title). */
export const DELETED_LIST_TITLE = '(Deleted list)'

/** The note on a layout-only list in a list chooser. */
export const LAYOUT_ONLY_NOTE = 'This layout'

/**
 * The lists a list tab's Change list › offers, in their order, as menu
 * entries each picking its list: the saved lists — and, given the saved
 * layout the tab is in (`layoutId`), the lists only it shows, marked
 * `This layout` (`listedLists`; never the Eisenhower's or another layout's).
 */
export function listChoiceEntries(
  listDefinitions: readonly PersistedListDefinition[],
  onPick: (listDefinitionId: number) => void,
  layoutId?: number,
): MenuEntry[] {
  const defs = listedLists([...listDefinitions].sort(bySortOrder), layoutId)
  const lists = defs.map((d): MenuEntry => ({
    kind: 'item',
    label: d.name,
    note: ownerLayoutId(d) != null ? LAYOUT_ONLY_NOTE : undefined,
    onSelect: () => onPick(d.id),
  }))
  return lists.length > 0 ? lists : [{ kind: 'note', text: 'No lists yet.' }]
}
