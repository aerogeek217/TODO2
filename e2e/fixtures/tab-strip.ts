import { expect, type Page } from '@playwright/test'

/**
 * A cell's tab strip as drawn, and the window widths at which it changes
 * how it fits — found by measuring, never written down: a spec that names
 * the width where the tabs shrink or fold turns red when a label or a header
 * button changes size, with nothing broken (cr34 T10).
 */

/**
 * The narrowest window that draws the workspace table: one past the phone
 * layout's breakpoint (`hooks/use-is-mobile`, `max-width: 640px`).
 */
export const DESKTOP_MIN_WIDTH = 641

/** Where the search for a strip's full width starts, and how far it widens by steps of `WIDEN_STEP`. */
const WIDE_START = 2000
const WIDEN_STEP = 400
const WIDEST = 6000

export interface StripTab { id: string; left: number; right: number; width: number }

export interface StripState {
  /** The tabs in the strip, in the order shown. */
  shown: StripTab[]
  /** Full widths of the tabs folded into `+N` (they are laid out out of sight). */
  folded: number[]
  strip: { left: number; right: number }
  /** The panel handle's width: the header's spare room (16px at its least). */
  handle: number
  /** The `+N` button shows. */
  overflow: boolean
  /** The header's content width (what its container query reads). */
  header: number
  /** The header's Open larger button: shown, hidden by the header's width, or not offered by the active widget. */
  openLarger: 'shown' | 'hidden' | 'absent'
  /** The left edge of the header's buttons (Open larger, Collapse row, ⋯), or of Expand row. */
  actionsLeft: number
}

/**
 * Cell `cellId`'s strip once it has settled: read every two frames (a
 * resize, then the strip's measure) until two reads agree — a big jump in
 * width takes the strip more than one measure.
 */
export async function stripState(page: Page, cellId: string): Promise<StripState> {
  return page.evaluate(async (id) => {
    const read = (): StripState => {
      const cell = document.querySelector(`[data-ws-cell="${id}"]`)
      const strip = cell?.querySelector('[role="tablist"]')
      // The header's empty space: the panel handle in the layout edit mode, only room outside it (E4).
      const handle = cell?.querySelector<HTMLElement>('[data-ws-cell-header] > [data-strip-room]')
      const header = cell?.querySelector<HTMLElement>('[data-ws-cell-header]')
      if (!cell || !strip || !handle || !header) throw new Error(`cell ${id} has no tab strip`)
      const tabs = Array.from(cell.querySelectorAll<HTMLElement>('[data-ws-tab]'))
      const s = strip.getBoundingClientRect()
      const hs = getComputedStyle(header)
      const openLarger = header.querySelector<HTMLElement>('[data-testid="open-larger"]')
      const actions = handle.nextElementSibling
      return {
        shown: tabs.filter((t) => !t.hasAttribute('data-ws-tab-folded')).map((t) => {
          const r = t.getBoundingClientRect()
          return { id: t.dataset.wsTab ?? '', left: r.left, right: r.right, width: r.width }
        }),
        folded: tabs.filter((t) => t.hasAttribute('data-ws-tab-folded')).map((t) => t.getBoundingClientRect().width),
        strip: { left: s.left, right: s.right },
        handle: handle.getBoundingClientRect().width,
        overflow: cell.querySelector('[aria-label$="more tabs"]') != null,
        header: header.getBoundingClientRect().width - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight)
          - parseFloat(hs.borderLeftWidth) - parseFloat(hs.borderRightWidth),
        openLarger: openLarger == null ? 'absent' : getComputedStyle(openLarger).display === 'none' ? 'hidden' : 'shown',
        actionsLeft: actions ? actions.getBoundingClientRect().left : s.right,
      }
    }
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    let last = ''
    for (let i = 0; i < 40; i++) {
      await frames()
      const state = read()
      const next = JSON.stringify(state)
      if (next === last) return state
      last = next
    }
    throw new Error(`the tab strip of cell ${id} never settled`)
  }, cellId)
}

/** Sets the window's width (its height kept) and returns cell `cellId`'s settled strip. */
export async function stripAt(page: Page, cellId: string, width: number): Promise<StripState> {
  await page.setViewportSize({ width, height: page.viewportSize()?.height ?? 800 })
  return stripState(page, cellId)
}

/** No tab is cut off; `+N` only when no folded tab would fit the spare header space (the handle beyond its 16 px). */
export function expectFits(state: StripState, label: string): void {
  for (const t of state.shown) {
    expect(t.left, `${label}: ${t.id} starts inside the strip`).toBeGreaterThanOrEqual(state.strip.left - 0.5)
    expect(t.right, `${label}: ${t.id} ends inside the strip`).toBeLessThanOrEqual(state.strip.right + 0.5)
  }
  expect(state.strip.right, `${label}: the strip ends before the header's buttons`).toBeLessThanOrEqual(state.actionsLeft + 0.5)
  expect(state.overflow, `${label}: +N iff a tab is folded`).toBe(state.folded.length > 0)
  if (state.folded.length > 0) {
    expect(state.handle - 16, `${label}: no room left for a folded tab`).toBeLessThan(Math.min(...state.folded))
  }
}

/** Whether `state` shows a tab narrower than it is in `full` (the strip with every tab at its full width). */
export function shrinks(state: StripState, full: StripState): boolean {
  const fullWidth = new Map(full.shown.map((t) => [t.id, t.width]))
  return state.shown.some((t) => t.width < (fullWidth.get(t.id) ?? 0) - 1)
}

/**
 * The widest window from `lo` to `hi` px at which `holds` — for a condition
 * that, once it holds, holds at every narrower width (the tabs shrink, a tab
 * folds, one tab is left). Found by halving; the window is left at some
 * width in between. Throws when it doesn't hold at `lo` or still holds at
 * `hi`: the caller's range no longer brackets it.
 */
export async function widestWidthWhere(
  page: Page,
  cellId: string,
  holds: (state: StripState) => boolean,
  { lo = DESKTOP_MIN_WIDTH, hi, what }: { lo?: number; hi: number; what: string },
): Promise<number> {
  if (!holds(await stripAt(page, cellId, lo))) throw new Error(`cell ${cellId}: ${what} not even at ${lo}px wide`)
  if (holds(await stripAt(page, cellId, hi))) throw new Error(`cell ${cellId}: ${what} still at ${hi}px wide`)
  let narrow = lo
  let wide = hi
  while (wide - narrow > 1) {
    const mid = Math.floor((narrow + wide) / 2)
    if (holds(await stripAt(page, cellId, mid))) narrow = mid
    else wide = mid
  }
  return narrow
}

export interface StripWidths {
  /** A window wide enough for every tab at its full width, and the strip there. */
  wide: number
  full: StripState
  /** The narrowest window with every tab at its full width: one px narrower, the tabs shrink. */
  fullAt: number
  /** The widest window that folds a tab into `+N`: between it and `fullAt` the tabs only shrink. */
  foldAt: number
}

/**
 * Where cell `cellId`'s strip changes how it fits, by measuring: widens the
 * window until the tabs stop growing (their full width), then halves down to
 * the width where they first shrink and the width where one first folds.
 */
export async function findStripWidths(page: Page, cellId: string): Promise<StripWidths> {
  let wide = WIDE_START
  let full = await stripAt(page, cellId, wide)
  for (;;) {
    const wider = await stripAt(page, cellId, wide + WIDEN_STEP)
    const same = full.folded.length === 0 && wider.folded.length === 0 && !shrinks(full, wider)
    if (same) break
    wide += WIDEN_STEP
    full = wider
    if (wide > WIDEST) throw new Error(`cell ${cellId}: its tabs are still not at full width in a ${wide}px window`)
  }
  const foldAt = await widestWidthWhere(page, cellId, (s) => s.folded.length > 0, { hi: wide, what: 'no tab is folded' })
  const shrinkAt = await widestWidthWhere(page, cellId, (s) => s.folded.length > 0 || shrinks(s, full), { lo: foldAt, hi: wide, what: 'the tabs don’t shrink' })
  return { wide, full, fullAt: shrinkAt + 1, foldAt }
}
