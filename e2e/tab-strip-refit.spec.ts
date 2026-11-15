import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsTab, type WsTabSeed, wsRow } from './fixtures/workspace'
import { findStripWidths, shrinks, stripAt, type StripState } from './fixtures/tab-strip'

/**
 * A shrunk tab strip fits again when a tab's own content changes, not only
 * when a box resizes: the active list's count (none → `1 of 5`, shown only
 * while narrowed; on the tab while the list's filter line is hidden). The
 * shrunk tabs' widths are pinned, so no ResizeObserver fires for these
 * (cr31 UI W5).
 *
 * The windows where the strip shrinks its tabs but folds none are found by
 * measuring (`fixtures/tab-strip`), not written down: they move with every
 * label and header button (cr34 T10).
 */

const OTHERS: WsTabSeed[] = [
  { id: 'n1', kind: 'notes' },
  { id: 'c1', kind: 'calendar' },
  { id: 'd1', kind: 'trend' },
  { id: 'e1', kind: 'neglect' },
  { id: 'c2', kind: 'calendar' },
  { id: 'n3', kind: 'notes' },
]

async function seed(page: Page) {
  await seedWorkspace(page, {
    // The filter line hidden: the tab carries the list's count.
    listDefinitions: [{ name: 'Inbox', showFilterLine: false }],
    tasks: [1, 2, 3, 4, 5].map((i) => ({ title: `Task ${i}` })),
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'col1', weight: 1, rows: [wsRow({ id: 'k1', tabs: [{ id: 'l1', kind: 'lens', listDefIdx: 0 }, ...OTHERS], activeTabId: 'l1' })] },
        { id: 'col2', weight: 1, rows: [wsRow({ id: 'k2', tabs: [{ id: 'n2', kind: 'notes' }] })] },
      ],
    }],
  })
}

/** The title is cut short (after the strip has settled: two frames). */
const cut = (tab: Locator) => tab.locator('[data-tab-title]').evaluate(async (el) => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  return el.scrollWidth > el.clientWidth
})

const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

/** How many window widths the sweep tries, spread over the widths that shrink without folding. */
const SWEEP_WIDTHS = 24

/**
 * In windows where k1's strip shrinks its tabs but folds none, runs `change`
 * and records whether the active tab's title is cut, then `undo`. Many
 * widths, because at some a change happens to resize the strip by a
 * rounding pixel (and the ResizeObserver fits again) while at others nothing
 * resizes. Each a resize and a few settles: the test takes the slow budget.
 */
async function sweep(page: Page, change: () => Promise<void>, undo: () => Promise<void>): Promise<number[]> {
  test.slow()
  await seed(page)
  const active = wsTab(page, 'l1')
  // Nothing narrows the list: no count yet (one number per list, 2A).
  await expect(active).toContainText('Inbox')
  await expect(active).not.toContainText('of 5')
  // From one px under the full width (the first shrink) down to one px above the first fold.
  const { full, fullAt, foldAt } = await findStripWidths(page, 'k1')
  const from = fullAt - 1
  const to = foldAt + 1
  expect(from - to, 'some windows shrink the strip without folding a tab').toBeGreaterThan(3)
  const step = Math.max(1, Math.floor((from - to) / SWEEP_WIDTHS))
  const shrunkOnly = (state: StripState) => state.folded.length === 0 && shrinks(state, full)
  const widthsCut: number[] = []
  let tried = 0
  for (let width = from; width >= to; width -= step) {
    const state = await stripAt(page, 'k1', width)
    expect(shrunkOnly(state), `${width}: shrunk, none folded`).toBe(true)
    tried++
    expect(await cut(active), `${width}: whole before`).toBe(false)
    await change()
    await settle(page)
    if (await cut(active)) widthsCut.push(width)
    await undo()
    await settle(page)
  }
  expect(tried, 'windows tried').toBeGreaterThan(3)
  return widthsCut
}

test('the active tab’s count growing fits the strip again (its title stays whole)', async ({ page }) => {
  const search = page.getByPlaceholder('Filter…')
  const active = wsTab(page, 'l1')
  const widthsCut = await sweep(
    page,
    async () => { await search.fill('Task 1'); await expect(active).toContainText('1 of 5') },
    async () => { await search.fill(''); await expect(active).not.toContainText('of') },
  )
  expect(widthsCut, 'widths where the title was cut').toEqual([])
})
