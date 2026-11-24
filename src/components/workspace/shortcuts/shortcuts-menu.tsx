import { useMemo } from 'react'
import { kindTabTitle, SHORTCUTS_SOURCES, type ShortcutsSource, type ShortcutsTab } from '../../../models/workspace-layout'
import { useShortcutChoices } from '../../../hooks/use-shortcuts'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { shortcutLists, shortcutsSource, withShortcutAdded, withShortcutMoved, withShortcutRemoved } from '../../../utils/shortcuts'
import { PlusIcon } from '../../shared/icons'
import type { MenuEntry } from '../../shared/MenuPopover'
import { settingEntry } from '../glance/menu-entries'

/** The item that opens the lists a List board can add (the cell's ⋯, the dashed tile, the empty state). */
export const ADD_SHORTCUT_LABEL = 'Add a list'

/** The setting that picks which lists a List board shows, and its choices' names. */
const SHORTCUTS_SOURCE_LABEL = 'Which lists'
const SHORTCUTS_SOURCE_NAMES: Readonly<Record<ShortcutsSource, string>> = {
  picked: 'Lists I pick',
  layout: 'This layout’s lists',
}

/** A tile's Remove item. */
export const REMOVE_SHORTCUT_LABEL = 'Remove from List board'

const ADD_MENU_WIDTH_PX = 240
const ADD_MENU_MAX_HEIGHT_PX = 360

const listName = (id: number) => useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)?.name ?? 'List'

/** Writes a List board's picked lists as one undo step named `step`. */
function writeLists(tab: ShortcutsTab, lists: number[], step: string): void {
  useWorkspaceStore.getState().patchTabConfig(tab.id, 'shortcuts', { lists }, step)
}

/** Adds list `id` at the end of a List board's picks (`Added “Errands” to List board`). */
function addShortcut(tab: ShortcutsTab, id: number): void {
  const lists = shortcutLists(tab.config)
  if (lists.includes(id)) return
  writeLists(tab, withShortcutAdded(lists, id), `Added “${listName(id)}” to ${kindTabTitle(tab)}`)
}

/** Takes list `id` out of a List board's picks (`Removed “Errands” from List board`); the list itself stays. */
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

/** Shows `source`'s lists on a List board, one undo step; its picks are kept either way. */
function setShortcutsSource(tab: ShortcutsTab, source: ShortcutsSource): void {
  if (shortcutsSource(tab.config) === source) return
  useWorkspaceStore.getState().patchTabConfig(tab.id, 'shortcuts', { source })
}

/**
 * The lists a List board can add, as menu entries: each layout's name (a label),
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

/**
 * A List board's items in its cell's ⋯ (the widget popup's too): **Which
 * lists ›** (Lists I pick, This layout's lists), then, showing the lists
 * picked, **Add a list ›**.
 */
export function useShortcutsMenuEntries(tab: ShortcutsTab | undefined): MenuEntry[] {
  const children = useAddShortcutEntries(tab)
  return useMemo(() => {
    if (!tab) return []
    const source = shortcutsSource(tab.config)
    const which = settingEntry(
      SHORTCUTS_SOURCE_LABEL,
      SHORTCUTS_SOURCES.map((v) => ({ value: v, label: SHORTCUTS_SOURCE_NAMES[v] })),
      source,
      (v) => setShortcutsSource(tab, v),
    )
    if (source === 'layout') return [which]
    return [which, {
      kind: 'item',
      label: ADD_SHORTCUT_LABEL,
      icon: <PlusIcon />,
      children,
      childrenWidth: ADD_MENU_WIDTH_PX,
      childrenMaxHeight: ADD_MENU_MAX_HEIGHT_PX,
    }]
  }, [tab, children])
}
