/** One tab of a cell's tab strip, measured: its full width and the least it may shrink to. */
export interface TabSize {
  id: string
  /** Its width with the whole title (capped at the tab's maximum). */
  natural: number
  /** The least it may shrink to: the title cut to a few letters (never more than `natural`). */
  min: number
  /** The active tab (whose `min` is its `natural` — it never shrinks while others show): the least it may squeeze to when it shows alone and still doesn't fit. */
  least?: number
}

/** How the strip's tabs fit the room it has. */
export interface TabFit {
  /** How many tabs show; the rest fold into the `+N` menu. */
  count: number
  /** The tabs shown share the room (each between its `min` and `natural`) instead of their full width. */
  shrink: boolean
  /**
   * Not even the active tab fits (beside `+N`): it shows alone, cut down to
   * its `least` (its title cut short like any other tab's) — never no tab.
   */
  squeeze?: true
}

/**
 * The tabs a strip showing `count` tabs shows, in layout order: the first
 * `count`, or — when the active tab is past them — the first `count - 1`
 * and the active tab (it takes the last visible place).
 */
export function shownTabs<T extends { id: string }>(tabs: readonly T[], activeId: string | undefined, count: number): T[] {
  const idx = tabs.findIndex((t) => t.id === activeId)
  if (idx < 0 || idx < count || count <= 0) return tabs.slice(0, Math.max(count, 0))
  const rest = tabs.filter((t) => t.id !== activeId)
  const active = tabs[idx]
  return active ? [...rest.slice(0, count - 1), active] : rest.slice(0, count)
}

/**
 * How many tabs fit `room` px (the room the header gives the tabs, without
 * the `+N` button): every tab at full width; else every tab shrunk (titles
 * cut short); else as many as fit shrunk beside the `+N` button
 * (`overflowWidth`, its margins and gap included), the active one always
 * among them; else the active tab alone, squeezed (`TabFit.squeeze`). Tabs
 * are `gap` px apart. The sizes are whole pixels rounded up, so a fit never
 * cuts a tab off.
 */
export function fitTabs(tabs: readonly TabSize[], activeId: string | undefined, room: number, overflowWidth: number, gap: number): TabFit {
  const width = (list: readonly TabSize[], key: 'natural' | 'min') =>
    list.reduce((sum, t) => sum + t[key], 0) + gap * Math.max(0, list.length - 1)
  const n = tabs.length
  if (width(tabs, 'natural') <= room) return { count: n, shrink: false }
  if (width(tabs, 'min') <= room) return { count: n, shrink: true }
  const roomBeside = room - overflowWidth
  for (let k = n - 1; k >= 1; k--) {
    if (width(shownTabs(tabs, activeId, k), 'min') <= roomBeside) return { count: k, shrink: true }
  }
  return n === 0 ? { count: 0, shrink: false } : { count: 1, shrink: true, squeeze: true }
}
