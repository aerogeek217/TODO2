import { expect, test, type Locator, type Page } from '@playwright/test'
import { releaseDrag, seedWorkspace, wsCell, wsTab, type WsTabSeed, wsRow, enterLayoutEdit } from './fixtures/workspace'
import { pointIn } from './fixtures/geometry'
import { DESKTOP_MIN_WIDTH, expectFits, findStripWidths, shrinks, stripAt, stripState, widestWidthWhere } from './fixtures/tab-strip'

/**
 * A cell's tab strip uses the room its header gives it: tabs at full width
 * while they fit, then shrunk (titles cut short), and only then folded into
 * `+N` — never a `+N` beside room for a folded tab, never a tab cut off by
 * the strip, and widening brings the folded tabs back. The panel's empty
 * header space stays a drag handle.
 *
 * No test names the window width where any of this happens: each finds it
 * by measuring (`fixtures/tab-strip`), so a label or a header button
 * changing size moves the widths without turning a test red (cr34 T10).
 */

const TABS: WsTabSeed[] = [
  { id: 'n1', kind: 'notes' },
  { id: 'c1', kind: 'calendar' },
  { id: 'd1', kind: 'trend' },
  { id: 'e1', kind: 'neglect' },
  { id: 'c2', kind: 'calendar' },
]

const more = (cell: Locator) => cell.getByRole('button', { name: /more tabs$/ })

/** k1 holds TABS beside a cell of one widget, in two equal columns. */
async function seed(page: Page) {
  await seedWorkspace(page, {
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'col1', weight: 1, rows: [wsRow({ id: 'k1', tabs: TABS, activeTabId: 'n1' })] },
        { id: 'col2', weight: 1, rows: [wsRow({ id: 'k2', tabs: [{ id: 'n2', kind: 'notes' }] })] },
      ],
    }],
  })
}

test('tabs that fit show at full width without +N, down to the narrowest window that fits them', async ({ page }) => {
  await seed(page)
  const { full, wide, fullAt } = await findStripWidths(page, 'k1')
  expect(full.shown).toHaveLength(TABS.length)
  expectFits(full, `${wide}`)
  const narrowest = await stripAt(page, 'k1', fullAt)
  expect(narrowest.shown.map((t) => t.id)).toEqual(TABS.map((t) => t.id))
  expect(shrinks(narrowest, full), `${fullAt}: no tab shrunk`).toBe(false)
  expectFits(narrowest, `${fullAt}`)
})

test('narrowing shrinks the tabs before any folds into +N, and widening brings them back', async ({ page }) => {
  await seed(page)
  const { full, wide, fullAt, foldAt } = await findStripWidths(page, 'k1')
  const fullWidths = new Map(full.shown.map((t) => [t.id, t.width]))
  // Between the first shrink and the first fold there are widths: the tabs shrink before one folds.
  expect(fullAt - 1, 'the tabs shrink in a wider window than the first fold’s').toBeGreaterThan(foldAt)

  // One px under the full width: shrunk, none folded. One px above the first fold: still none. At it: `+N`.
  const firstShrunk = await stripAt(page, 'k1', fullAt - 1)
  expect(shrinks(firstShrunk, full)).toBe(true)
  expect(firstShrunk.folded).toHaveLength(0)
  expectFits(firstShrunk, `${fullAt - 1}`)
  const lastShrunk = await stripAt(page, 'k1', foldAt + 1)
  expect(lastShrunk.folded).toHaveLength(0)
  expect(shrinks(lastShrunk, full)).toBe(true)
  expectFits(lastShrunk, `${foldAt + 1}`)
  const firstFolded = await stripAt(page, 'k1', foldAt)
  expect(firstFolded.folded.length).toBeGreaterThan(0)
  expectFits(firstFolded, `${foldAt}`)

  // Every step of the way down, from full width to the narrowest window: the rules hold, in that order.
  const step = Math.max(5, Math.floor((fullAt - foldAt) / 4))
  let sawShrunk = false
  let sawFolded = false
  for (let width = fullAt + step; width >= DESKTOP_MIN_WIDTH; width -= step) {
    const state = await stripAt(page, 'k1', width)
    expectFits(state, `${width}`)
    // The active tab is always shown.
    expect(state.shown.some((t) => t.id === 'n1'), `${width}: the active tab shows`).toBe(true)
    if (!state.overflow && shrinks(state, full)) sawShrunk = true
    if (state.overflow) {
      sawFolded = true
      // Folding starts only once the tabs have been shrunk.
      expect(sawShrunk, `${width}: tabs shrank before one folded`).toBe(true)
    }
  }
  expect(sawShrunk).toBe(true)
  expect(sawFolded).toBe(true)
  await expect(more(wsCell(page, 'k1'))).toBeVisible()

  for (let width = DESKTOP_MIN_WIDTH; width <= wide; width += 2 * step) {
    expectFits(await stripAt(page, 'k1', width), `back to ${width}`)
  }
  const back = await stripAt(page, 'k1', wide)
  expect(back.shown.map((t) => t.id)).toEqual(full.shown.map((t) => t.id))
  for (const t of back.shown) expect(Math.abs(t.width - (fullWidths.get(t.id) ?? 0))).toBeLessThanOrEqual(1)
})

test('a full-width fixed row (a former band) fits its tabs the same way', async ({ page }) => {
  const bandTabs = [...TABS, ...TABS.map((t) => ({ ...t, id: `${t.id}b` }))]
  await seedWorkspace(page, {
    layouts: [{
      name: 'Main',
      top: { id: 'top-band', cells: [{ id: 'band', tabs: bandTabs, activeTabId: 'n1' }] },
      columns: [{ id: 'col1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'n2', kind: 'notes' }] })] }],
    }],
  })
  const { full, fullAt, foldAt } = await findStripWidths(page, 'band')
  expect(full.shown).toHaveLength(bandTabs.length)
  expect(fullAt - 1).toBeGreaterThan(foldAt)
  // The narrowest window folds the most; the first fold's width fewer; the full width none.
  const narrow = await stripAt(page, 'band', DESKTOP_MIN_WIDTH)
  expect(narrow.folded.length).toBeGreaterThan(0)
  expectFits(narrow, `band at ${DESKTOP_MIN_WIDTH}`)
  const first = await stripAt(page, 'band', foldAt)
  expect(first.folded.length).toBeGreaterThan(0)
  expect(first.folded.length).toBeLessThan(narrow.folded.length)
  expectFits(first, `band at ${foldAt}`)
  const wide = await stripAt(page, 'band', fullAt)
  expect(wide.folded).toHaveLength(0)
  expectFits(wide, `band at ${fullAt}`)
})

test('in a narrow column a long active tab still shows (squeezed beside +N), never no tab at all', async ({ page }) => {
  const narrow = (id: string) =>
    ({ id: `col-${id}`, weight: 1, rows: [wsRow({ id, tabs: [{ id: `n-${id}`, kind: 'notes' as const }] })] })
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'A list with a very long name for a narrow column' }],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'col1', weight: 1, rows: [wsRow({ id: 'k1', tabs: [{ id: 'l1', kind: 'lens', listDefIdx: 0 }, ...TABS], activeTabId: 'l1' })] },
        narrow('k2'),
        narrow('k3'),
      ],
    }],
  })
  const { full, wide } = await findStripWidths(page, 'k1')
  const fullWidth = full.shown.find((t) => t.id === 'l1')?.width ?? 0
  // The widest window that leaves the active tab alone beside `+N`; from there down to the narrowest.
  const aloneAt = await widestWidthWhere(page, 'k1', (s) => s.shown.length <= 1, { hi: wide, what: 'more than the active tab shows' })
  const active = wsCell(page, 'k1').locator('[data-ws-tab="l1"]')
  const seen: Array<{ window: number; tab: number; inside: boolean }> = []
  const step = Math.max(1, Math.floor((aloneAt - DESKTOP_MIN_WIDTH) / 40))
  for (let width = aloneAt; width >= DESKTOP_MIN_WIDTH; width -= step) {
    const state = await stripAt(page, 'k1', width)
    // Never no tab at all: the active one, beside `+N`.
    expect(state.overflow, `${width}: +N`).toBe(true)
    expect(state.shown.map((t) => t.id), `${width}: the active tab alone`).toEqual(['l1'])
    const tab = state.shown[0]
    if (!tab) throw new Error(`${width}: no tab`)
    seen.push({ window: width, tab: tab.width, inside: tab.right <= state.strip.right + 0.5 })
  }
  await expect(active).toBeVisible()
  await expect(active).toHaveAttribute('tabindex', '0')
  // Squeezed as the column narrows: cut short, down to a least width that keeps some of its title — and
  // while it is wider than that least, the strip never cuts it off.
  const least = Math.min(...seen.map((w) => w.tab))
  expect(least, 'its least width').toBeLessThan(fullWidth - 1)
  const squeezed = seen.filter((w) => w.tab < fullWidth - 1 && w.tab > least + 0.5)
  expect(squeezed.length, 'windows where the tab is squeezed but not yet at its least').toBeGreaterThan(0)
  for (const w of seen.filter((w) => w.tab > least + 0.5)) {
    expect(w.inside, `${w.window}: the tab (${w.tab}px wide) ends inside the strip`).toBe(true)
  }
  const title = await active.locator('[data-tab-title]').evaluate((el) => el.clientWidth)
  expect(title, 'at the narrowest the title keeps some letters').toBeGreaterThanOrEqual(40)
})

test('the +N menu lists the folded tabs, and picking one shows it', async ({ page }) => {
  await seed(page)
  const { foldAt } = await findStripWidths(page, 'k1')
  // Well inside the windows that fold: halfway from the first fold to the narrowest.
  const before = await stripAt(page, 'k1', Math.round((foldAt + DESKTOP_MIN_WIDTH) / 2))
  const cell = wsCell(page, 'k1')
  expect(before.folded.length).toBeGreaterThan(0)
  await more(cell).click()
  const items = page.getByRole('menu', { name: 'More tabs' }).getByRole('menuitem')
  await expect(items).toHaveCount(before.folded.length)
  await items.last().click()
  await expect(cell.locator('[data-ws-tab="c2"]')).toHaveAttribute('aria-selected', 'true')
  await expect(cell.locator('[data-ws-tab="c2"]:not([data-ws-tab-folded])')).toBeVisible()
  // The picked tab takes the focus, as a tab an arrow key moves to does.
  await expect(cell.locator('[data-ws-tab="c2"]')).toBeFocused()
  expectFits(await stripState(page, 'k1'), 'after picking')
})

/** Cell k1's tabs in the layout on screen (the working copy while edited, else the saved one). */
const k1Tabs = (page: Page) => page.evaluate(async () => {
  type L = { cells: Array<{ id: string; tabs: Array<{ id: string }> }> } | null
  const ws = (await import(/* @vite-ignore */ '/src/stores/workspace-store.ts' as string)) as {
    useWorkspaceStore: { getState: () => { working: L; saved: L } }
  }
  const s = ws.useWorkspaceStore.getState()
  return (s.working ?? s.saved)?.cells.find((c) => c.id === 'k1')?.tabs.map((t) => t.id)
})

/**
 * Lifts `tabId`, waits for `onto` to show, checks the strip shows `shownWhileLifted`
 * (when given), and drops on `onto`'s part at `fraction` of its width.
 */
async function dropOn(page: Page, tabId: string, onto: string, fraction: number, shownWhileLifted?: string[]) {
  const from = await pointIn(wsTab(page, tabId))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + 8, { steps: 2 })
  await expect(page.locator(`[data-ws-tab="${onto}"]:not([data-ws-tab-folded])`)).toBeVisible()
  if (shownWhileLifted) expect((await stripState(page, 'k1')).shown.map((t) => t.id)).toEqual(shownWhileLifted)
  const to = await pointIn(wsTab(page, onto), fraction)
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await releaseDrag(page)
}

/**
 * k1 holds TABS (n1 c1 d1 e1 c2) with the last active, beside a cell holding
 * n2 and n3 (tabs: a strip to drag n2 from) — in a window that shows two of
 * k1's tabs: the first, and the active last one pulled forward past the
 * three folded between them.
 */
async function seedFolded(page: Page) {
  await seedWorkspace(page, {
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'col1', weight: 1, rows: [wsRow({ id: 'k1', tabs: TABS, activeTabId: 'c2' })] },
        { id: 'col2', weight: 1, rows: [wsRow({ id: 'k2', tabs: [{ id: 'n2', kind: 'notes' }, { id: 'n3', kind: 'notes' }], activeTabId: 'n2' })] },
      ],
    }],
  })
  const { wide } = await findStripWidths(page, 'k1')
  // The middle of the windows that show exactly two tabs: neither edge a pixel away.
  const twoAt = await widestWidthWhere(page, 'k1', (s) => s.shown.length <= 2, { hi: wide, what: 'more than two tabs show' })
  const oneAt = await widestWidthWhere(page, 'k1', (s) => s.shown.length <= 1, { hi: twoAt, what: 'more than one tab shows' })
  const state = await stripAt(page, 'k1', Math.round((twoAt + oneAt + 1) / 2))
  // n1 first, then the active last tab pulled forward past folded ones.
  expect(state.folded).toHaveLength(3)
  expect(state.shown.map((t) => t.id)).toEqual(['n1', 'c2'])
}

test('with tabs folded into +N, a tab dropped before the active tab pulled forward lands right before it', async ({ page }) => {
  await seedFolded(page)
  // From the other cell — the layout edit mode's (E4): just before c2 (layout index 4), past the folded ones.
  await enterLayoutEdit(page)
  await dropOn(page, 'n2', 'c2', 0.2)
  await expect.poll(() => k1Tabs(page)).toEqual(['n1', 'c1', 'd1', 'e1', 'n2', 'c2'])
})

test('with tabs folded into +N, a tab dropped on the gap right after itself stays where it is', async ({ page }) => {
  await seedFolded(page)
  // Lifted, n1 sits right before c2 (the folded c1 d1 e1 between them in the
  // layout): its gap before c2 is the one right after itself — no move.
  await dropOn(page, 'n1', 'c2', 0.2, ['n1', 'c2'])
  await expect(wsTab(page, 'n1')).toHaveAttribute('aria-selected', 'true')
  expect(await k1Tabs(page)).toEqual(['n1', 'c1', 'd1', 'e1', 'c2'])
})

test('an arrow key to a tab folded into +N shows it and moves focus to it (under a view transition)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await seedFolded(page)
  expect(await page.evaluate(() => typeof document.startViewTransition)).toBe('function')
  const folded = (await page.locator('[data-ws-cell="k1"] [data-ws-tab][data-ws-tab-folded]').first().getAttribute('data-ws-tab')) ?? ''
  expect(folded).not.toBe('')
  await wsTab(page, 'c2').focus()
  // The strip's order: the shown tabs (c2 last), then the folded ones — ArrowRight from c2 goes to the first folded tab.
  await page.keyboard.press('ArrowRight')
  const target = wsCell(page, 'k1').locator(`[data-ws-tab="${folded}"]`)
  await expect(target).toHaveAttribute('aria-selected', 'true')
  await expect(target).not.toHaveAttribute('data-ws-tab-folded')
  await expect(target).toBeFocused()

  // And End: the last tab in the strip's order (folded too).
  await page.keyboard.press('End')
  const last = page.locator('[data-ws-cell="k1"] [role="tab"][aria-selected="true"]')
  await expect(last).not.toHaveAttribute('data-ws-tab-folded')
  await expect(last).toBeFocused()
})
