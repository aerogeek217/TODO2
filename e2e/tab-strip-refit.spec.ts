import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsTab, type WsTabSeed, wsRow } from './fixtures/workspace'

/**
 * A shrunk tab strip fits again when a tab's own content changes, not only
 * when a box resizes: the active list's count (none → `1 of 5`, shown only while narrowed; on the tab while
 * the list's filter line is hidden), its unsaved
 * dot. The shrunk tabs' widths are pinned, so no ResizeObserver fires for
 * these (cr31 UI W5).
 */

const OTHERS: WsTabSeed[] = [
  { id: 'n1', kind: 'notes' },
  { id: 'c1', kind: 'calendar' },
  { id: 'd1', kind: 'trend' },
  { id: 'e1', kind: 'neglect' },
  { id: 'c2', kind: 'calendar' },
  { id: 'n3', kind: 'notes' },
]

async function seed(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 })
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

/**
 * Whether the strip shrinks its tabs, with none folded into `+N` — read after
 * two frames (the settle, in the same round trip: the sweep makes one per width).
 */
const shrunk = (page: Page) => page.evaluate(async () => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const cell = document.querySelector('[data-ws-cell="k1"]')
  if (!cell || cell.querySelector('[aria-label$="more tabs"]')) return false
  return Array.from(cell.querySelectorAll('[data-ws-tab] [data-tab-title]')).some((t) => t.scrollWidth > t.clientWidth)
})

const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

/**
 * At each width where k1's strip shrinks its tabs but folds none, runs
 * `change` and records whether the active tab's title is cut, then `undo`.
 * Sweeping widths: at some, a change happens to resize the strip by a
 * rounding pixel (and the ResizeObserver fits again); at others nothing
 * resizes. Sixty-one widths, each a resize and a few settles: ~10 s alone,
 * so the sweep's test takes the slow budget (it ran past 30 s in a full parallel run).
 */
async function sweep(page: Page, change: () => Promise<void>, undo: () => Promise<void>): Promise<number[]> {
  test.slow()
  await seed(page, 1800)
  const active = wsTab(page, 'l1')
  // Nothing narrows the list: no count yet (one number per list, 2A).
  await expect(active).toContainText('Inbox')
  await expect(active).not.toContainText('of 5')
  const widthsCut: number[] = []
  let tried = 0
  for (let width = 1700; width >= 1100; width -= 10) {
    await page.setViewportSize({ width, height: 800 })
    if (!(await shrunk(page))) continue
    tried++
    expect(await cut(active), `${width}: whole before`).toBe(false)
    await change()
    await settle(page)
    if (await cut(active)) widthsCut.push(width)
    await undo()
    await settle(page)
  }
  expect(tried, 'some widths shrink the strip without folding').toBeGreaterThan(3)
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
