import { expect, test, type Page } from '@playwright/test'
import { edges, openCellMenu, seedWorkspace, wsCell, type WsLayoutSeed } from './fixtures/workspace'

/**
 * Add widget's Where as a picture (D26 follow-ups, board BE): the cell
 * drawn, its middle a tab, its four sides a split that way, the bars outside
 * it a row or column at the layout's edge. Each zone puts the new widget
 * where it says; hover names it under the picture in the drag ghost's words.
 */

/** `a b`: Notes beside a Calendar. */
const pair: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['a b'],
    cells: [
      { id: 'a', tabs: [{ id: 'aTab', kind: 'notes' }] },
      { id: 'b', tabs: [{ id: 'bTab', kind: 'calendar' }] },
    ],
  },
}

type Edges = Awaited<ReturnType<typeof edges>>

/** Opens Add widget from cell a and returns its menu. */
async function openAddWidget(page: Page) {
  await openCellMenu(page, 'a')
  await page.getByRole('menuitem', { name: 'Add widget…' }).click()
  return page.getByRole('menu', { name: 'Add widget' })
}

/** The cell holding none of the seeded tabs: the one just added. */
function addedCell(page: Page) {
  return page.locator('[data-ws-cell]').filter({ hasNot: page.locator('[data-ws-tab="aTab"], [data-ws-tab="bTab"]') })
}

/** Where each zone puts the new cell, against cell a's and the table's edges as they were. */
const ZONES: ReadonlyArray<{ name: string; check: (n: Edges, a: Edges, t: Edges) => void }> = [
  { name: 'Split · above', check: (n, a) => { expect(n.left).toBeCloseTo(a.left, -1); expect(n.bottom).toBeLessThan(a.top + (a.bottom - a.top) / 2) } },
  { name: 'Split · below', check: (n, a) => { expect(n.left).toBeCloseTo(a.left, -1); expect(n.top).toBeGreaterThan(a.top + (a.bottom - a.top) / 2) } },
  { name: 'Split · left', check: (n, a) => { expect(n.top).toBeCloseTo(a.top, -1); expect(n.left).toBeCloseTo(a.left, -1); expect(n.right).toBeLessThan(a.right - 50) } },
  { name: 'Split · right', check: (n, a) => { expect(n.top).toBeCloseTo(a.top, -1); expect(n.left).toBeGreaterThan(a.left + 50); expect(n.right).toBeCloseTo(a.right, -1) } },
  { name: 'Insert row · full width, top', check: (n, _a, t) => { expect(n.top).toBeCloseTo(t.top, -1); expect(n.right - n.left).toBeGreaterThan(t.right - t.left - 24) } },
  { name: 'Insert row · full width, bottom', check: (n, _a, t) => { expect(n.bottom).toBeCloseTo(t.bottom, -1); expect(n.right - n.left).toBeGreaterThan(t.right - t.left - 24) } },
  { name: 'Insert column · full height, left', check: (n, a, t) => { expect(n.left).toBeCloseTo(a.left, -1); expect(n.bottom - n.top).toBeGreaterThan(t.bottom - t.top - 24) } },
  { name: 'Insert column · full height, right', check: (n, _a, t) => { expect(n.right).toBeGreaterThan(t.right - 24); expect(n.bottom - n.top).toBeGreaterThan(t.bottom - t.top - 24) } },
]

test.describe('Where, as a picture', () => {
  test('defaults to Tab and names the zone hovered or focused in the drag ghost’s words', async ({ page }) => {
    await seedWorkspace(page, { layouts: [pair] })
    const menu = await openAddWidget(page)
    const where = menu.getByRole('group', { name: 'Where' })
    const caption = where.locator('[data-menu-picture-caption]')
    await expect(where.getByRole('menuitemradio', { name: 'Add as tab' })).toHaveAttribute('aria-checked', 'true')
    await expect(where.getByRole('menuitemradio', { name: 'Add as tab' })).toBeFocused()
    await expect(caption).toHaveText('Add as tab')
    await where.getByRole('menuitemradio', { name: 'Insert column · full height, right' }).hover()
    await expect(caption).toHaveText('Insert column · full height, right')
    // The keyboard: ← from Tab to Left, Enter picks it.
    await where.getByRole('menuitemradio', { name: 'Add as tab' }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(where.getByRole('menuitemradio', { name: 'Split · left' })).toBeFocused()
    await expect(caption).toHaveText('Split · left')
    await page.keyboard.press('Enter')
    await expect(where.getByRole('menuitemradio', { name: 'Split · left' })).toHaveAttribute('aria-checked', 'true')
    // The picture fits in the menu.
    const pic = await edges(where)
    const m = await edges(menu)
    expect(pic.right).toBeLessThanOrEqual(m.right)
  })

  test('Tab adds the widget as a tab of the cell', async ({ page }) => {
    await seedWorkspace(page, { layouts: [pair] })
    const menu = await openAddWidget(page)
    await menu.getByRole('menuitem', { name: 'Notes', exact: true }).click()
    await expect(wsCell(page, 'a').locator('[data-ws-tab]')).toHaveCount(2)
    await expect(page.locator('[data-ws-cell]')).toHaveCount(2)
  })

  for (const zone of ZONES) {
    test(`${zone.name} puts the new widget there`, async ({ page }) => {
      await seedWorkspace(page, { layouts: [pair] })
      const a = await edges(wsCell(page, 'a'))
      const table = await edges(page.locator('[data-ws-table] [data-ws-cell]').first().locator('xpath=..'))
      const t = { left: table.left + 6, top: table.top, right: table.right - 6, bottom: table.bottom }
      const menu = await openAddWidget(page)
      await menu.getByRole('group', { name: 'Where' }).getByRole('menuitemradio', { name: zone.name }).click()
      await menu.getByRole('menuitem', { name: 'Notes', exact: true }).click()
      await expect(page.locator('[data-ws-cell]')).toHaveCount(3)
      zone.check(await edges(addedCell(page)), a, t)
    })
  }
})
