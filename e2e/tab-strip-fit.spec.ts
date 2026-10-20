import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, type WsTabSeed } from './fixtures/workspace'

/**
 * A cell's tab strip uses the room its header gives it: tabs at full width
 * while they fit, then shrunk (titles cut short), and only then folded into
 * `+N` — never a `+N` beside room for a folded tab, never a tab cut off by
 * the strip, and widening brings the folded tabs back. The panel's empty
 * header space stays a drag handle.
 */

const TABS: WsTabSeed[] = [
  { id: 'n1', kind: 'notes' },
  { id: 'c1', kind: 'calendar' },
  { id: 'd1', kind: 'dashboard' },
  { id: 'e1', kind: 'eisenhower' },
  { id: 'c2', kind: 'calendar' },
]

const more = (cell: Locator) => cell.getByRole('button', { name: /more tabs$/ })

async function seed(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 })
  await seedWorkspace(page, {
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'col1', weight: 1, cells: [{ id: 'k1', tabs: TABS, activeTabId: 'n1' }] },
        { id: 'col2', weight: 1, cells: [{ id: 'k2', tabs: [{ id: 'n2', kind: 'notes' }] }] },
      ],
    }],
  })
}

interface StripState {
  shown: Array<{ id: string; left: number; right: number; width: number }>
  /** Full widths of the tabs folded into `+N` (they are laid out out of sight). */
  folded: number[]
  strip: { left: number; right: number }
  handle: number
  overflow: boolean
}

/** The strip after the layout has settled (two frames: the resize, then the strip's measure). */
async function stripState(page: Page, cellId: string): Promise<StripState> {
  return page.evaluate(async (id) => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const cell = document.querySelector(`[data-ws-cell="${id}"]`)
    const strip = cell?.querySelector('[role="tablist"]')
    const handle = cell?.querySelector<HTMLElement>('[data-ws-panel-handle]')
    if (!cell || !strip || !handle) throw new Error('no strip')
    const tabs = Array.from(cell.querySelectorAll<HTMLElement>('[data-ws-tab]'))
    const s = strip.getBoundingClientRect()
    return {
      shown: tabs.filter((t) => !t.hasAttribute('data-ws-tab-folded')).map((t) => {
        const r = t.getBoundingClientRect()
        return { id: t.dataset.wsTab ?? '', left: r.left, right: r.right, width: r.width }
      }),
      folded: tabs.filter((t) => t.hasAttribute('data-ws-tab-folded')).map((t) => t.getBoundingClientRect().width),
      strip: { left: s.left, right: s.right },
      handle: handle.getBoundingClientRect().width,
      overflow: cell.querySelector('[aria-label$="more tabs"]') != null,
    }
  }, cellId)
}

/** No tab is cut off; `+N` only when no folded tab would fit the spare header space (the handle beyond its 16 px). */
function expectFits(state: StripState, label: string) {
  for (const t of state.shown) {
    expect(t.left, `${label}: ${t.id} starts inside the strip`).toBeGreaterThanOrEqual(state.strip.left - 0.5)
    expect(t.right, `${label}: ${t.id} ends inside the strip`).toBeLessThanOrEqual(state.strip.right + 0.5)
  }
  expect(state.overflow, `${label}: +N iff a tab is folded`).toBe(state.folded.length > 0)
  if (state.folded.length > 0) {
    expect(state.handle - 16, `${label}: no room left for a folded tab`).toBeLessThan(Math.min(...state.folded))
  }
}

test('tabs that fit show at full width without +N', async ({ page }) => {
  await seed(page, 1600)
  const state = await stripState(page, 'k1')
  expect(state.shown).toHaveLength(TABS.length)
  expectFits(state, '1600')
})

test('narrowing shrinks the tabs before any folds into +N, and widening brings them back', async ({ page }) => {
  await seed(page, 1600)
  const full = await stripState(page, 'k1')
  const fullWidths = new Map(full.shown.map((t) => [t.id, t.width]))

  let sawShrunk = false
  let sawFolded = false
  for (let width = 1600; width >= 700; width -= 50) {
    await page.setViewportSize({ width, height: 800 })
    const state = await stripState(page, 'k1')
    expectFits(state, `${width}`)
    // The active tab is always shown.
    expect(state.shown.some((t) => t.id === 'n1'), `${width}: the active tab shows`).toBe(true)
    const shrunk = state.shown.some((t) => t.width < (fullWidths.get(t.id) ?? 0) - 1)
    if (!state.overflow && shrunk) sawShrunk = true
    if (state.overflow) {
      sawFolded = true
      // Folding starts only once the tabs have been shrunk.
      expect(sawShrunk, `${width}: tabs shrank before one folded`).toBe(true)
    }
  }
  expect(sawShrunk).toBe(true)
  expect(sawFolded).toBe(true)
  await expect(more(wsCell(page, 'k1'))).toBeVisible()

  for (let width = 700; width <= 1600; width += 100) {
    await page.setViewportSize({ width, height: 800 })
    expectFits(await stripState(page, 'k1'), `back to ${width}`)
  }
  const back = await stripState(page, 'k1')
  expect(back.shown.map((t) => t.id)).toEqual(full.shown.map((t) => t.id))
  for (const t of back.shown) expect(Math.abs(t.width - (fullWidths.get(t.id) ?? 0))).toBeLessThanOrEqual(1)
})

test('a band header fits its tabs the same way', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  const bandTabs = [...TABS, ...TABS.map((t) => ({ ...t, id: `${t.id}b` }))]
  await seedWorkspace(page, {
    layouts: [{
      name: 'Main',
      top: { id: 'band', tabs: bandTabs, activeTabId: 'n1' },
      columns: [{ id: 'col1', cells: [{ id: 'k1', tabs: [{ id: 'n2', kind: 'notes' }] }] }],
    }],
  })
  const state = await stripState(page, 'band')
  expect(state.folded.length).toBeGreaterThan(0)
  expectFits(state, 'band at 900')
  await page.setViewportSize({ width: 1600, height: 800 })
  const wide = await stripState(page, 'band')
  expect(wide.folded.length).toBeLessThan(state.folded.length)
  expectFits(wide, 'band at 1600')
})

test('the +N menu lists the folded tabs, and picking one shows it', async ({ page }) => {
  await seed(page, 750)
  const cell = wsCell(page, 'k1')
  const before = await stripState(page, 'k1')
  expect(before.folded.length).toBeGreaterThan(0)
  await more(cell).click()
  const items = page.getByRole('menu', { name: 'More tabs' }).getByRole('menuitem')
  await expect(items).toHaveCount(before.folded.length)
  await items.last().click()
  await expect(cell.locator('[data-ws-tab="c2"]')).toHaveAttribute('aria-selected', 'true')
  await expect(cell.locator('[data-ws-tab="c2"]:not([data-ws-tab-folded])')).toBeVisible()
  expectFits(await stripState(page, 'k1'), 'after picking')
})
