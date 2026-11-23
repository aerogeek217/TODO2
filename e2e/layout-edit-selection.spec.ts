import { expect, test, type Page } from '@playwright/test'
import { drag, edgeTab, enterLayoutEdit, layoutEditBar, seedWorkspace, wsCard, wsCell, wsShape, type WsLayoutSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'

/**
 * The layout edit mode's selection in a real browser: the selected card's
 * toolbar sits inside the card (inside the viewport too, for the right
 * column's card), icons only in a narrow card, its ⋯ the card's menu; the
 * neighbours it makes a rectangle with carry merge buttons worded from its
 * side — as tabs, a Numbers strip's `Merge with`, a slot's `Stretch over` —
 * that draw the merge on hover and make it on a click (one step of the
 * mode's undo); its edge tabs and merge buttons follow it in the Tab
 * order; all of it steps aside while a card is dragged; and a card dropped
 * in the frame inserts a column.
 */

/**
 * `a b f` / `d b f` / `n1 n2 e`: Notes + Created vs completed (tabs), the
 * Neglect map, Notes, a Calendar, two Numbers and an empty slot.
 */
const seed: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['a b f', 'd b f', 'n1 n2 e'],
    cells: [
      { id: 'a', tabs: [{ id: 'notesA', kind: 'notes' }, { id: 'trendA', kind: 'trend' }] },
      { id: 'b', tabs: [{ id: 'mapB', kind: 'neglect' }] },
      { id: 'f', tabs: [{ id: 'notesF', kind: 'notes' }] },
      { id: 'd', tabs: [{ id: 'calD', kind: 'calendar' }] },
      { id: 'n1', tabs: [{ id: 'num1', kind: 'number', glance: { metric: 'open' } }] },
      { id: 'n2', tabs: [{ id: 'num2', kind: 'number', glance: { metric: 'overdue' } }] },
      { id: 'e', tabs: [] },
    ],
  },
}

const toolbar = (page: Page, cellId: string) => page.locator(`[data-edit-toolbar="${cellId}"]`)
const mergeButton = (page: Page, cellId: string) => page.locator(`[data-merge-button="${cellId}"]`)
const hint = (page: Page) => page.getByTestId('layout-edit-preview-hint')

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
})

test('the toolbar sits inside its card — the right column’s too —, icons only in a narrow card; its ⋯ opens the card menu', async ({ page }) => {
  await seedWorkspace(page, { layouts: [seed] })
  await enterLayoutEdit(page)
  await wsCard(page, 'f').focus()
  const bar = toolbar(page, 'f')
  await expect(bar).toBeVisible()
  const card = await box(wsCell(page, 'f'))
  const t = await box(bar)
  expect(t.x).toBeGreaterThanOrEqual(card.x)
  expect(t.y).toBeGreaterThanOrEqual(card.y)
  expect(t.x + t.width).toBeLessThanOrEqual(card.x + card.width)
  expect(t.y + t.height).toBeLessThanOrEqual(card.y + card.height)
  expect(t.x + t.width).toBeLessThanOrEqual(1280)
  await expect(bar).toContainText('Split →')
  await expect(bar).toContainText('Remove')
  await expect(bar).not.toContainText('Swap')
  // Its ⋯ stands in for the card's corner one: the card menu, Swap with in it.
  await expect(wsCell(page, 'f').getByRole('button', { name: 'Cell layout' })).toHaveCount(1)
  await bar.getByRole('button', { name: 'Cell layout' }).click()
  await expect(page.getByRole('menu', { name: 'Cell layout' }).getByRole('menuitem', { name: 'Swap with', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  // A card under 330px: the same buttons as icons, still inside it.
  await page.setViewportSize({ width: 900, height: 800 })
  await expect(bar).toHaveAttribute('data-compact', '')
  await expect(bar).not.toContainText('Split →')
  await expect(bar.getByRole('button', { name: 'Split side by side' })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Remove widget' })).toBeVisible()
  const narrow = await box(wsCell(page, 'f'))
  const n = await box(bar)
  expect(n.x + n.width).toBeLessThanOrEqual(narrow.x + narrow.width)
  expect(n.x + n.width).toBeLessThanOrEqual(900)
})

test('a merge button on each neighbour that makes a rectangle: drawn on hover, merged on a click as one undo step', async ({ page }) => {
  await seedWorkspace(page, { layouts: [seed] })
  await enterLayoutEdit(page)
  await wsCard(page, 'd').focus()
  // The Calendar's neighbours: the tabs above, the Number below; the Neglect map (two rows high) none.
  await expect(page.locator('[data-merge-button]')).toHaveCount(2)
  await expect(mergeButton(page, 'b')).toHaveCount(0)
  const above = mergeButton(page, 'a')
  await expect(above).toHaveText('↑Merge as tabs with Notes')
  const where = await box(above)
  const a = await box(wsCell(page, 'a'))
  expect(where.y).toBeGreaterThan(a.y)
  expect(where.y + where.height).toBeLessThanOrEqual(a.y + a.height)

  // Hovered: the merged cell drawn (the Calendar's tab first), the bar says it; the button stays put.
  await above.hover()
  await expect(hint(page)).toHaveText('Merge Calendar with Notes · one cell, 3 tabs · click to merge')
  await expect(page.locator('[data-preview-grew="d"]')).toBeVisible()
  await expect(wsCell(page, 'd').getByRole('tab')).toHaveCount(3)
  expect(await box(above)).toEqual(where)
  // Clicked: one cell of three tabs, the Calendar's first, still selected; one step of the mode's undo.
  await above.click()
  await expect.poll(() => wsShape(page).then((s) => s.flat().find((c) => c.includes('calD')))).toEqual(['calD', 'notesA', 'trendA'])
  await expect(wsCell(page, 'd')).toHaveAttribute('data-edit-selected', '')
  await expect(page.locator('[data-preview-grew]')).toHaveCount(0)
  await layoutEditBar(page).getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(wsCell(page, 'a')).toBeVisible()
  await expect(wsCell(page, 'd').getByRole('tab')).toHaveCount(0)
})

test('two Numbers merge into a strip; a card stretches over a slot; Merge ▾ lists the same', async ({ page }) => {
  await seedWorkspace(page, { layouts: [seed] })
  await enterLayoutEdit(page)
  await wsCard(page, 'n2').focus()
  // n2's neighbours: the Number on its left (one strip), the slot on its right; the Neglect map above.
  await expect(mergeButton(page, 'n1')).toHaveText(/^←Merge with /)
  await expect(mergeButton(page, 'e')).toHaveText('→Stretch over this slot')
  await expect(mergeButton(page, 'b')).toHaveText(/^↑Merge as tabs with /)
  await toolbar(page, 'n2').getByRole('button', { name: 'Merge' }).click()
  const menu = page.getByRole('menu', { name: 'Merge with' })
  await expect(menu.getByRole('menuitem')).toHaveText([/^With .* \(left\)$/, /^As tabs with .* \(above\)$/, 'Over the empty slot (right)'])
  // An entry hovered draws its merge.
  await menu.getByRole('menuitem', { name: 'Over the empty slot (right)' }).hover()
  await expect(hint(page)).toHaveText(/ over the empty slot · click to stretch$/)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-structure-preview]')).toHaveCount(0)

  await mergeButton(page, 'n1').click()
  await expect(wsCell(page, 'n2').locator('[data-number-slot]')).toHaveCount(2)
  await expect(wsCell(page, 'n1')).toHaveCount(0)
})

test('the edge tabs and merge buttons follow the selected card in the Tab order; Enter on an edge tab inserts', async ({ page }) => {
  await seedWorkspace(page, { layouts: [seed] })
  await enterLayoutEdit(page)
  await wsCard(page, 'd').focus()
  // The card, its toolbar's five buttons, then its edge tabs and merge buttons.
  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab')
  await expect(toolbar(page, 'd').getByRole('button', { name: 'Cell layout' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Insert row above', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(mergeButton(page, 'a')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Insert column right', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  // A column right of the Calendar: its slot beside it, selected and focused.
  await expect(page.locator('[data-ruler^="columns:"]')).toHaveCount(4)
  const slot = page.locator('[data-edit-slot]:focus')
  await expect(slot).toHaveCount(1)
})

test('while a card drags its selection’s controls step aside; dropped in the frame it inserts a column', async ({ page }) => {
  await seedWorkspace(page, { layouts: [seed] })
  await enterLayoutEdit(page)
  await edgeTab(page, 'd', 'Row above')
  await expect(page.locator('[data-merge-button]')).toHaveCount(2)
  const area = await box(page.locator('[data-ws-area]'))
  const d = await box(wsCell(page, 'd'))
  await drag(page, await pointIn(wsCard(page, 'd'), 0.5, 0.7), { x: area.x + 12, y: d.y + d.height / 2 }, {
    during: async () => {
      await expect(page.locator('[data-edge-tab]')).toHaveCount(0)
      await expect(page.locator('[data-merge-button]')).toHaveCount(0)
      await expect(page.locator('[data-edit-toolbar]')).toHaveCount(0)
      await expect(page.getByTestId('ws-drop-label')).toHaveText('Insert column · full height')
    },
  })
  await expect(page.locator('[data-ruler^="columns:"]')).toHaveCount(4)
  // The Calendar is the new first column, full height.
  const calendar = page.locator('[data-ws-table] [data-ws-cell]:has([data-ws-tab="calD"])')
  await expect.poll(async () => Math.round((await box(calendar)).x - area.x)).toBe(26)
  await expect.poll(async () => Math.round((await box(calendar)).height)).toBe(Math.round(area.height - 26 - 14))
})

test('a collapsed card is named once: by its blueprint, its inert top line hidden', async ({ page }) => {
  await seedWorkspace(page, {
    layouts: [{
      name: 'Main',
      table: {
        areas: ['a b', 'c c'],
        rows: [{ weight: 1000, collapsed: true }, 1000],
        cells: [
          { id: 'a', tabs: [{ id: 'notesTab', kind: 'notes' }] },
          { id: 'b', tabs: [{ id: 'calTab', kind: 'calendar' }] },
          { id: 'c', tabs: [{ id: 'notes2', kind: 'notes' }] },
        ],
      },
    }],
    settings: { showWidgetNames: 'true' },
  })
  // Outside the mode the collapsed Notes cell shows its top line.
  await expect(wsCell(page, 'a').locator('[data-widget-top-line]').first()).toBeVisible()
  await enterLayoutEdit(page)
  await expect(wsCell(page, 'a').locator('[data-edit-blueprint]')).toBeVisible()
  await expect(wsCell(page, 'a').locator('[data-ws-cell-body] [data-widget-top-line]')).toBeHidden()
})
