import { listedLists, type PersistedListDefinition } from '../../models/list-definition'
import { bySortOrder } from '../../utils/sort-order'
import type { MenuEntry } from './MenuPopover'

/** The source choice that is no list (the Eisenhower's Show). */
export const ALL_TASKS_LABEL = 'All tasks'

/** A deleted list's name where its name would show (a tab title, the Eisenhower's source). */
export const DELETED_LIST_TITLE = '(Deleted list)'

/**
 * The saved lists (in their order; never a hidden list — `listedLists`) as menu entries — a list tab's Change
 * list ›, the Eisenhower's Show (Settings › Tasks › Eisenhower) — each
 * picking its list. `allTasks` puts an `All tasks` choice (`undefined`)
 * first and makes the choices radios, the `current` one checked.
 */
export function listChoiceEntries(
  listDefinitions: readonly PersistedListDefinition[],
  onPick: (listDefinitionId: number | undefined) => void,
  allTasks?: { current: number | undefined },
): MenuEntry[] {
  const defs = listedLists([...listDefinitions].sort(bySortOrder))
  const choice = (label: string, id: number | undefined): MenuEntry => (allTasks
    ? { kind: 'item', label, radio: true, checked: id === allTasks.current, onSelect: () => onPick(id) }
    : { kind: 'item', label, onSelect: () => onPick(id) })
  const lists = defs.map((d) => choice(d.name, d.id))
  if (!allTasks) return lists.length > 0 ? lists : [{ kind: 'note', text: 'No lists yet.' }]
  return [
    choice(ALL_TASKS_LABEL, undefined),
    ...(lists.length > 0 ? [{ kind: 'separator' } as const, { kind: 'label', text: 'Saved lists' } as const, ...lists] : []),
  ]
}
