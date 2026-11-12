import type { Tag } from '../../../models'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { findTab } from '../../../utils/workspace-layout-queries'

/**
 * Project pulse's tag picks written from the widget (item 9): the + card's
 * picker adds a tag's card, a card's × removes it. Each is one layout
 * config write and one undo step, named plainly (`Added “Atlas” to project
 * pulse`, `Removed “Atlas” from project pulse`). The picks are read from
 * the open layout at the moment of the write, so picks made quickly one
 * after another each build on the last.
 */

/** Project pulse tab `tabId`'s picked tag ids in the open layout, or `null` when it isn't there. */
function pickedTagIds(tabId: string): readonly number[] | null {
  const working = useWorkspaceStore.getState().working
  const loc = working ? findTab(working, tabId) : null
  const tab = loc ? working?.cells[loc.cellIdx]?.tabs[loc.tabIdx] : undefined
  return tab?.kind === 'pulse' ? tab.config.tagIds : null
}

/** Adds `tag`'s card after the last one (nothing when it is already picked). */
export function addPulseTag(tabId: string, tag: Pick<Tag, 'id' | 'name'>): void {
  const picked = pickedTagIds(tabId)
  if (picked == null || tag.id == null || picked.includes(tag.id)) return
  useWorkspaceStore.getState().patchTabConfig(tabId, 'pulse', { tagIds: [...picked, tag.id] }, `Added “${tag.name}” to project pulse`)
}

/** Removes `tag`'s card (nothing when it isn't picked). */
export function removePulseTag(tabId: string, tag: Pick<Tag, 'id' | 'name'>): void {
  const picked = pickedTagIds(tabId)
  if (picked == null || tag.id == null || !picked.includes(tag.id)) return
  useWorkspaceStore.getState().patchTabConfig(tabId, 'pulse', { tagIds: picked.filter((id) => id !== tag.id) }, `Removed “${tag.name}” from project pulse`)
}

/** A pick in the tag picker: adds the tag, or removes it while it is picked (the picker's tick). */
export function togglePulseTag(tabId: string, tag: Pick<Tag, 'id' | 'name'>): void {
  const picked = pickedTagIds(tabId)
  if (picked == null || tag.id == null) return
  if (picked.includes(tag.id)) removePulseTag(tabId, tag)
  else addPulseTag(tabId, tag)
}
