import { expect, test, type Locator, type Page } from '@playwright/test'
import { filterField, filterTray } from './fixtures/filters'
import { openListFilterEditor, seedWorkspace, wsCell, wsListWidget, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * 24px hit areas (UX cleanup 5A, step 3), by hit-testing in the real
 * browser: the tab's ×, a filter chip's × (an editor's and the top bar's),
 * Quick Add's chip × and the desktop row's checkbox each take presses over
 * at least 24 × 24 px around their centre, drawn at their old size — and
 * their neighbours (the tab's label, the chip's value, the next chip, the
 * priority gutter, the title) still take theirs. The J20 exceptions (the
 * priority gutter, a date's clear ×) and Lines rows stay small.
 */

const SEED: WorkspaceSeed = {
  people: ['Aisha Rahman', 'Ben Ortiz'],
  tags: ['docs', 'customer'],
  tasks: [
    { title: 'Answer Northwind on the SLA', people: ['Aisha Rahman'], tags: ['docs'], dueInDays: 1 },
    { title: 'Shared rollout plan', people: ['Ben Ortiz'], tags: ['customer'] },
    { title: 'Collect signed travel forms', urgent: true },
  ],
  listDefinitions: [
    { name: 'All open', predicate: { tags: [1, 2] } },
    { name: 'Second list' },
    { name: 'Lines list' },
  ],
  layouts: [
    {
      name: 'Main',
      table: {
        areas: ['a b'],
        cells: [
          { id: 'a', tabs: [{ id: 'tA', kind: 'lens', listDefIdx: 0, zoom: 'rows' }, { id: 'tB', kind: 'lens', listDefIdx: 1 }] },
          { id: 'b', tabs: [{ id: 'tL', kind: 'lens', listDefIdx: 2, zoom: 'lines' }] },
        ],
      },
    },
  ],
}

test.use({ viewport: { width: 1440, height: 900 } })

interface Extent { width: number; height: number }

/**
 * How far presses reach `target` from its centre: the contiguous run of
 * points along each axis through the centre where `elementFromPoint` lands
 * on the target (or inside it).
 */
async function hitExtent(target: Locator): Promise<Extent> {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const hits = (x: number, y: number) => {
      const at = document.elementFromPoint(x, y)
      return !!at && (at === el || el.contains(at))
    }
    const run = (dx: number, dy: number) => {
      let n = 0
      while (n < 60 && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++
      return n
    }
    return { width: run(-1, 0) + run(1, 0) + 1, height: run(0, -1) + run(0, 1) + 1 }
  })
}

/** What a press at (`x`, `y`) lands on, as the nearest element matching one of `selectors` ('' when none). */
async function landsOn(page: Page, x: number, y: number, selectors: string[]): Promise<string> {
  return page.evaluate(({ x, y, selectors }) => {
    const at = document.elementFromPoint(x, y)
    for (const s of selectors) if (at?.closest(s)) return s
    return ''
  }, { x, y, selectors })
}

async function boxOf(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no box')
  return b
}

test('the active tab’s × takes a 24px press, drawn at 16px; the label and the next tab keep theirs', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const tab = wsTab(page, 'tA')
  await wsCell(page, 'a').hover()
  const close = tab.getByRole('button', { name: /^Close / })
  await expect(close).toBeVisible()
  expect((await boxOf(close)).width).toBe(16)
  const extent = await hitExtent(close)
  expect(extent.width).toBeGreaterThanOrEqual(24)
  expect(extent.height).toBeGreaterThanOrEqual(24)

  // Left of the hit area: the tab itself (a press there starts the tab's drag or picks it).
  const c = await boxOf(close)
  const tabBox = await boxOf(tab)
  const left = c.x - 5
  expect(await landsOn(page, left, c.y + c.height / 2, ['button[aria-label^="Close "]', '[data-ws-tab]'])).toBe('[data-ws-tab]')
  // The label's text never sits under the hit area.
  const title = tab.locator('[class*="title"]').first()
  const t = await boxOf(title)
  expect(t.x + t.width).toBeLessThanOrEqual(c.x - 4)
  // The hit area stays inside its tab: the next tab's press is the next tab's.
  expect(c.x + c.width / 2 + 12).toBeLessThanOrEqual(tabBox.x + tabBox.width)
  const next = wsTab(page, 'tB')
  const n = await boxOf(next)
  expect(await landsOn(page, n.x + 1, n.y + n.height / 2, ['[data-ws-tab="tB"]'])).toBe('[data-ws-tab="tB"]')
})

test('an inactive tab’s hidden × takes no press', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const next = wsTab(page, 'tB')
  const close = next.getByRole('button', { name: /^Close / })
  await page.mouse.move(2, 880)
  // Hidden (visibility) until its tab is hovered: a press at its place is the tab's.
  await expect(close).toBeHidden()
  const n = await boxOf(next)
  expect(await landsOn(page, n.x + n.width - 10, n.y + n.height / 2, ['button[aria-label^="Close "]', '[data-ws-tab]'])).toBe('[data-ws-tab]')
})

test('the top bar’s filter chip × takes a 24px press; the chip’s value keeps its press', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await filterField(page).fill('@Aisha ')
  const chip = filterTray(page).getByRole('button', { name: /^People filter: / })
  await expect(chip).toBeVisible()
  const clear = filterTray(page).getByRole('button', { name: 'Clear people filter' })
  expect((await boxOf(clear)).width).toBe(16)
  const extent = await hitExtent(clear)
  expect(extent.width).toBeGreaterThanOrEqual(24)
  expect(extent.height).toBeGreaterThanOrEqual(24)
  const v = await boxOf(chip)
  // The chip's value: its whole text still opens the picker.
  expect(await landsOn(page, v.x + v.width - 6, v.y + v.height / 2, ['button[aria-label="Clear people filter"]', 'button[aria-label^="People filter"]'])).toBe('button[aria-label^="People filter"]')
})

test('an editor’s filter chip × takes a 24px press; its value keeps its press', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const editor = await openListFilterEditor(page, wsListWidget(page, 'tA'))
  const removes = editor.getByRole('button', { name: 'Remove filter' })
  await expect(removes.first()).toBeVisible()
  const remove = removes.first()
  expect((await boxOf(remove)).width).toBe(16)
  const extent = await hitExtent(remove)
  expect(extent.width).toBeGreaterThanOrEqual(24)
  expect(extent.height).toBeGreaterThanOrEqual(24)
  const r = await boxOf(remove)
  // Left of the hit area: the chip's own button (its value).
  expect(await landsOn(page, r.x - 5, r.y + r.height / 2, ['button[aria-label="Remove filter"]', '[class*="chipEdit"]'])).toBe('[class*="chipEdit"]')
})

test('Quick Add’s chip × takes a 24px press; the next chip is untouched', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await page.keyboard.press('q')
  const input = page.getByPlaceholder('New task…')
  if (!(await input.isVisible())) {
    await page.evaluate(async () => {
      const mod = (await import(/* @vite-ignore */ '/src/stores/ui-store.ts' as string)) as { useUIStore: { getState: () => { openQuickAdd: () => void } } }
      mod.useUIStore.getState().openQuickAdd()
    })
  }
  await input.pressSequentially('Call #docs #customer ')
  const removes = page.getByRole('button', { name: /^Remove / })
  await expect(removes.nth(1)).toBeVisible()
  const first = removes.first()
  expect((await boxOf(first)).width).toBe(14)
  const extent = await hitExtent(first)
  expect(extent.width).toBeGreaterThanOrEqual(24)
  expect(extent.height).toBeGreaterThanOrEqual(24)
  // The next chip's text (just right of the gap) is not the ×'s.
  const f = await boxOf(first)
  const chips = first.locator('xpath=../following-sibling::*[1]')
  const nb = await boxOf(chips)
  expect(nb.x).toBeGreaterThan(f.x + f.width / 2 + 12)
  expect(await landsOn(page, nb.x + 1, nb.y + nb.height / 2, ['button[aria-label^="Remove "]'])).toBe('')
})

test('the row’s checkbox takes a 24px press at Rows, drawn at 18px; the gutter and the title keep theirs; Lines stays small', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const row = page.locator('[data-list-widget="tA"] [data-todo-id]').first()
  await row.hover()
  const box = row.locator('input[type="checkbox"]')
  expect((await boxOf(box)).width).toBe(18)
  const extent = await hitExtent(box)
  expect(extent.width).toBeGreaterThanOrEqual(24)
  expect(extent.height).toBeGreaterThanOrEqual(24)
  // The priority gutter (J20: stays 8px) still takes its own press, at its centre.
  const gutter = row.locator('[data-row-cell="markers"]')
  const g = await boxOf(gutter)
  const at = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('input[type="checkbox"]') ? 'checkbox' : 'other', { x: g.x + g.width / 2, y: g.y + g.height / 2 })
  expect(at).toBe('other')
  // The title, from its first letter, is the title's.
  const title = row.locator('span[data-task-title]')
  const t = await boxOf(title)
  expect(await landsOn(page, t.x + 1, t.y + t.height / 2, ['input[type="checkbox"]'])).toBe('')

  // Lines (15px rows): its box is a different control and keeps its size.
  const line = page.locator('[data-list-widget="tL"] [data-row-key]').first()
  await expect(line).toBeVisible()
  expect(await line.locator('input[type="checkbox"]').count()).toBe(0)
})
