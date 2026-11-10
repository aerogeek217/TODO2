import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'
import { box, type Box } from './fixtures/geometry'

/**
 * A list's top line never draws one part over another (UX cleanup 2A
 * follow-up): its filter in words is the part that gives way — it shrinks,
 * fades with `+N more`, then goes — before the name's tail; the badge, the
 * count, group · sort and the cell's controls stay whole. One line, inside
 * its cell, at every width a one-widget list cell takes (240–520px), with
 * and without a screen filter narrowing it (its count showing).
 */

test.use({ viewport: { width: 1440, height: 900 } })

const WIDTHS = [240, 280, 320, 360, 395, 440, 480, 520]

function seed(cellPx: number, over: Partial<WorkspaceSeed> = {}): WorkspaceSeed {
  return {
    tags: ['Ops'],
    listDefinitions: [{
      name: 'Overdue & due soon',
      grouping: 'tag',
      sort: 'due',
      predicate: { dates: { deadline: { match: 'range', start: null, end: { kind: 'offset', days: 7 } } } },
    }],
    tasks: [
      { title: 'Late one', dueInDays: -2, tags: ['Ops'] },
      { title: 'Soon one', dueInDays: 1 },
      { title: 'Soon two', dueInDays: 3, followupInDays: 0 },
    ],
    layouts: [{
      name: 'Main',
      table: {
        areas: ['n l'],
        cols: [1000, { px: cellPx }],
        cells: [
          { id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] },
          { id: 'l', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] },
        ],
      },
    }],
    ...over,
  }
}

/** Narrows every list by a word the tasks share (a screen filter: the count shows). */
async function screenSearch(page: Page, text: string) {
  await page.evaluate(async (t) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/filter-store.ts' as string)) as {
      useFilterStore: { getState: () => { setSearchText: (s: string) => void } }
    }
    mod.useFilterStore.getState().setSearchText(t)
  }, text)
}

/** The boxes of the line's parts that are drawn (a part `display: none` or of no width left out). */
async function parts(line: Locator): Promise<Record<string, Box>> {
  const selectors: Record<string, string> = {
    name: '[data-testid="top-line-name"]',
    badge: '[data-top-line-badge]',
    words: '[data-testid="list-filter-expression"], [data-testid="list-filter-every"]',
    count: '[data-testid="list-count"]',
    summary: '[data-testid="list-summary"]',
    controls: '[data-cell-controls]',
  }
  const out: Record<string, Box> = {}
  for (const [name, sel] of Object.entries(selectors)) {
    const el = line.locator(sel).first()
    if ((await el.count()) === 0) continue
    const visible = await el.evaluate((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0)
    if (visible) out[name] = await box(el)
  }
  return out
}

const overlaps = (a: Box, b: Box) => a.x + 0.5 < b.x + b.width && b.x + 0.5 < a.x + a.width

async function expectFits(page: Page, width: number, narrowed: boolean) {
  const cell = page.locator('[data-ws-cell="l"]')
  await expect.poll(async () => Math.round((await box(cell)).width)).toBe(width)
  const line = cell.getByTestId('list-filter-row')
  await expect(line).toBeVisible()
  if (narrowed) await expect(line.getByTestId('list-count')).toBeVisible()
  else await expect(line.getByTestId('list-count')).toHaveCount(0)
  // The words' fit settles on a ResizeObserver: two frames.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const p = await parts(line)
  const label = `${width}px${narrowed ? ', narrowed' : ''}`
  for (const required of ['name', 'badge', 'controls', ...(narrowed ? ['count'] : [])]) {
    expect(p[required], `${label}: ${required} drawn`).toBeDefined()
  }
  const names = Object.keys(p)
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!
      const b = names[j]!
      expect(overlaps(p[a]!, p[b]!), `${label}: ${a} ${JSON.stringify(p[a])} overlaps ${b} ${JSON.stringify(p[b])}`).toBe(false)
    }
  }
  const l = await box(line)
  const c = await box(cell)
  // One line (the filter line's height), inside its cell.
  expect(Math.round(l.height), `${label}: one line`).toBe(36)
  for (const [name, b] of Object.entries(p)) {
    expect(b.x, `${label}: ${name} inside the cell`).toBeGreaterThanOrEqual(c.x - 0.5)
    expect(b.x + b.width, `${label}: ${name} inside the cell`).toBeLessThanOrEqual(c.x + c.width + 0.5)
    expect(Math.abs((b.y + b.height / 2) - (l.y + l.height / 2)), `${label}: ${name} on the line`).toBeLessThan(4)
  }
  // The count and group · sort stay whole; the name gives way only after the words have gone.
  for (const whole of ['count', 'summary']) {
    const el = line.getByTestId(whole === 'count' ? 'list-count' : 'list-summary')
    if (!p[whole]) continue
    expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), `${label}: ${whole} whole`).toBe(true)
  }
  const nameCut = await line.getByTestId('top-line-name').evaluate((e) => e.scrollWidth > e.clientWidth + 1)
  if (nameCut) expect(p.words, `${label}: the name is cut while the words still show`).toBeUndefined()
}

for (const narrowed of [false, true]) {
  test(`a one-widget list's top line: no part over another, one line, 240–520px${narrowed ? ' (a screen filter narrowing it)' : ''}`, async ({ page }) => {
    test.slow()
    for (const width of WIDTHS) {
      await seedWorkspace(page, seed(width))
      if (narrowed) await screenSearch(page, 'one')
      await expectFits(page, width, narrowed)
    }
  })
}

/** No two drawn parts of a filter line (under a strip, or the Eisenhower's) overlap; it stays one line inside its cell. */
async function expectLineClear(page: Page, cellId: string, label: string) {
  const cell = page.locator(`[data-ws-cell="${cellId}"]`)
  const line = cell.getByTestId('list-filter-row')
  await expect(line).toBeVisible()
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const p = await parts(line)
  const names = Object.keys(p)
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      expect(overlaps(p[names[i]!]!, p[names[j]!]!), `:  overlaps `).toBe(false)
    }
  }
  const l = await box(line)
  const c = await box(cell)
  expect(Math.round(l.height), `: one line`).toBe(36)
  for (const [name, b] of Object.entries(p)) expect(b.x + b.width, `:  inside`).toBeLessThanOrEqual(c.x + c.width + 0.5)
}

test('the filter line under a tab strip and the Eisenhower’s: the words give way, nothing overlaps (narrowed)', async ({ page }) => {
  test.slow()
  for (const width of [240, 320, 440]) {
    await seedWorkspace(page, seed(width, {
      layouts: [{
        name: 'Main',
        table: {
          areas: ['n l', 'n e'],
          cols: [1000, { px: width }],
          cells: [
            { id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] },
            { id: 'l', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }, { id: 'notes2', kind: 'notes' }], activeTabId: 'list' },
            { id: 'e', tabs: [{ id: 'eis', kind: 'eisenhower' }, { id: 'notes3', kind: 'notes' }], activeTabId: 'eis' },
          ],
        },
      }],
      eisenhower: { listDefIdx: 0 },
    }))
    await screenSearch(page, 'one')
    await expectLineClear(page, 'l', `px, under a strip`)
    await expectLineClear(page, 'e', `px, the Eisenhower`)
  }
})