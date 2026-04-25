import type { RailSide, RailsState, SlotKind } from '../models/canvas-rails'
import { getActiveTab } from '../models/canvas-rails'
import { decodeRailsDropId } from './rail-dnd'

/**
 * Helpers shared by `useRailsDragMonitor`, `TabStrip`, and `float-dock-announce`.
 * All pure — they read but never write. Callers handle dispatch.
 */

const ALL_SIDES: RailSide[] = ['left', 'right', 'top', 'bottom']

/**
 * Active-tab kind for a slot, or `null` if the slot isn't present in any rail.
 * Used by drag-zone descriptions and the float-dock a11y announcer.
 */
export function findSlotKind(rails: RailsState, slotId: string): SlotKind | null {
  for (const side of ALL_SIDES) {
    const rail = rails[side]
    if (!rail) continue
    const slot = rail.slots.find((s) => s.id === slotId)
    if (slot) return getActiveTab(slot).type
  }
  return null
}

/**
 * Type label for a tab inside a known slot; `null` if either the slot or tab
 * can't be resolved. Used by the rail-tab drag start announcer.
 */
export function findTabLabel(rails: RailsState, slotId: string, tabId: string): SlotKind | null {
  for (const side of ALL_SIDES) {
    const rail = rails[side]
    if (!rail) continue
    const slot = rail.slots.find((s) => s.id === slotId)
    if (!slot) continue
    const tab = slot.tabs.find((t) => t.id === tabId)
    return tab ? tab.type : null
  }
  return null
}

/**
 * Insertion index from pointer X against `[data-tab-id]` pill midpoints inside
 * a tab-strip element. When `sourceTabId` is provided (intra-strip reorder),
 * that pill is excluded from the survivor set so the index reflects the
 * post-removal layout — matches `applyReorderTab`'s contract. When omitted
 * (float dock onto a strip), every existing pill counts as a survivor.
 */
export function computeTabInsertIdx(
  stripEl: Element,
  pointerX: number,
  sourceTabId?: string | null,
): number {
  const pills = Array.from(stripEl.querySelectorAll<HTMLElement>('[data-tab-id]'))
  const survivors = sourceTabId != null
    ? pills.filter((p) => p.dataset.tabId !== sourceTabId)
    : pills
  for (let i = 0; i < survivors.length; i++) {
    const survivor = survivors[i]
    if (!survivor) continue
    const rect = survivor.getBoundingClientRect()
    const mid = rect.left + rect.width / 2
    if (pointerX < mid) return i
  }
  return survivors.length
}

/**
 * Short human-readable description of a decoded drop-zone, used in a11y
 * announcements like `"Dropped in lens slot"`. Mirrors the phrasing used by
 * `describeFloatDockTarget` in `float-dock-announce.ts` so rail-tab and
 * float-dock announcements read consistently.
 */
export function describeDropZone(
  zone: ReturnType<typeof decodeRailsDropId>,
  rails: RailsState,
): string {
  if (!zone) return 'unknown target'
  if (zone.kind === 'empty-side') return `${zone.side} rail`
  if (zone.kind === 'canvas') return 'canvas'
  if (zone.kind === 'tab-strip') {
    const targetKind = findSlotKind(rails, zone.slotId) ?? 'slot'
    return `${targetKind} tab strip`
  }
  const targetKind = findSlotKind(rails, zone.slotId) ?? 'slot'
  return `${targetKind} slot`
}
