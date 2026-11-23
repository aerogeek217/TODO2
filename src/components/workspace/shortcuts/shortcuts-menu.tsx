import { useMemo } from 'react'
import { kindTabTitle, type ShortcutsTab } from '../../../models/workspace-layout'
import { useShortcutChoices } from '../../../hooks/use-shortcuts'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { shortcutLists, withShortcutAdded, withShortcutMoved, withShortcutRemoved } from '../../../utils/shortcuts'
import { PlusIcon } from '../../shared/icons'
import type { MenuEntry } from '../../shared/MenuPopover'

/** The item that opens the lists Shortcuts can add (the cell's ⋯, the dashed tile, the empty state). */
export const ADD_SHORTCUT_LABEL = 'Add a list'

/** A tile's Remove item. */
export const REMOVE_SHORTCUT_LABEL = 'Remove from List board'

const ADD_MENU_WIDTH_PX = 240
const ADD_MENU_MAX_HEIGHT_PX = 360

const listName = (id: number) => useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)?.name ?? 'List'

/** Writes Shortcuts' lists as one undo step named `step`. */
function writeLists(tab: ShortcutsTab, lists: number[], step: string): void {
  useWorkspaceStore.getState().patchTabConfig(tab.id, 'shortcuts', { lists }, step)
}

/** Adds list `id` at the end of Shortcuts (`Added “Errands” to Shortcuts`). */
function addShortcut(tab: ShortcutsTab, id: number): void {
  const lists = shortcutLists(tab.config)
  if (lists.includes(id)) return
  writeLists(tab, withShortcutAdded(lists, id), `Added “${listName(id)}” to ${kindTabTitle(tab)}`)
}

/** Takes list `id` out of Shortcuts (`Removed “Errands” from Shortcuts`); the list itself stays. */
export function removeShortcut(tab: ShortcutsTab, id: number): void {
  const lists = shortcutLists(tab.config)
  if (!lists.includes(id)) return
  writeLists(tab, withShortcutRemoved(lists, id), `Removed “${listName(id)}” from ${kindTabTitle(tab)}`)
}

/** Moves list `id` to where list `overId` is (a drag; `Moved “Errands”`). */
export function moveShortcut(tab: ShortcutsTab, id: number, overId: number): void {
  const lists = shortcutLists(tab.config)
  const from = lists.indexOf(id)
  const to = lists.indexOf(overId)
  if (from < 0 || to < 0 || from === to) return
  writeLists(tab, withShortcutMoved(lists, from, to), `Moved “${listName(id)}”`)
}

/**
 * The lists Shortcuts can add, as menu entries: each layout's name (a label),
 * then its lists not added yet — the open layout first. A pick adds the list.
 * With none left, a note says so.
 */
export function useAddShortcutEntries(tab: ShortcutsTab | undefined): MenuEntry[] {
  const added = tab ? shortcutLists(tab.config) : NO_LISTS
  const groups = useShortcutChoices(added)
  return useMemo(() => {
    if (!tab) return []
    if (groups.length === 0) return [{ kind: 'note', text: 'Every list is added.' }]
    return groups.flatMap((g, i): MenuEntry[] => [
      ...(i > 0 ? [{ kind: 'separator' } as const] : []),
      { kind: 'label', text: g.layoutName },
      ...g.lists.map((d): MenuEntry => ({ kind: 'item', label: d.name, onSelect: () => addShortcut(tab, d.id) })),
    ])
  }, [tab, groups])
}

const NO_LISTS: readonly number[] = []

/** Shortcuts' items in its cell's ⋯ (the widget popup's too): **Add a list ›**. */
export function useShortcutsMenuEntries(tab: ShortcutsTab | undefined): MenuEntry[] {
  const children = useAddShortcutEntries(tab)
  return useMemo(() => (tab ? [{
    kind: 'item',
    label: ADD_SHORTCUT_LABEL,
    icon: <PlusIcon />,
    children,
    childrenWidth: ADD_MENU_WIDTH_PX,
    childrenMaxHeight: ADD_MENU_MAX_HEIGHT_PX,
  }] : []), [tab, children])
}
