import { expect, test, type Page } from '@playwright/test'
import { enterLayoutEdit, expectLayoutStored, newestUndoStep, seedWorkspace, type WsLayoutSeed } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * The layout edit mode's rulers (E2) in a real browser: entering the mode
 * draws a ruler on every track and a "+" on every line, overlaid so no cell
 * moves; a "+" inserts a full row on the draft; a row ruler's Remove row
 * moves the row's widget into the cell above as a tab (its menu says so);
 * Done stores the draft as one step, and the global Undo puts it back.
 */

const main: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['m-a m-b', 'm-c m-c'],
    cells: [
      { id: 'm-a', tabs: [{ id: 'm-notes', kind: 'notes' }] },
      { id: 'm-b', tabs: [{ id: 'm-cal', kind: 'calendar' }] },
      { id: 'm-c', tabs: [{ id: 'm-bd', kind: 'breakdown' }] },
    ],
  },
}

const bar = (page: Page) => page.locator('[data-layout-edit-bar]')
const cells = (page: Page) => page.locator('[data-ws-table] [data-ws-cell]')

/** Every cell's box, rounded (px). */
function cellBoxes(page: Page): Promise<string[]> {
  return page.locator('[data-ws-table] [data-ws-cell]').evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect()
    return [r.left, r.top, r.width, r.height].map(Math.round).join(',')
  }))
}

async function storedMain(page: Page): Promise<{ cells: Array<{ id: string; tabs: Array<{ id: string }> }> }> {
  const rows = await readStore<{ name: string; cells: Array<{ id: string; tabs: Array<{ id: string }> }> }>(page, 'layouts')
  const row = rows.find((r) => r.name === 'Main')
  if (!row) throw new Error('no layout “Main”')
  return row
}

test('rulers without a shift, insert a row by “+”, Remove row moves a widget as a tab, Done, then the global Undo', async ({ page }) => {
  await seedWorkspace(page, { layouts: [main] })
  const before = await cellBoxes(page)
  await enterLayoutEdit(page)
  await expect(bar(page)).toBeVisible()

  // The rulers: a column ruler per column, a row ruler per row, a "+" on every line; no cell moved.
  await expect(page.getByRole('button', { name: 'Column A options' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Column B options' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Row 2 options' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Insert column here' })).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Insert row here' })).toHaveCount(3)
  expect(await cellBoxes(page)).toEqual(before)

  // The last row line's "+": a full row at the bottom, on the draft only.
  await page.getByRole('button', { name: 'Insert row here' }).last().click()
  await expect(cells(page)).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Row 3 options' })).toBeVisible()
  expect((await storedMain(page)).cells).toHaveLength(3)
  expect(await newestUndoStep(page)).toBeNull()

  // Row 2's menu: Remove row says the Breakdown joins Notes as a tab.
  const ruler = page.getByRole('button', { name: 'Row 2 options' })
  await ruler.click()
  const remove = page.getByRole('menuitem', { name: /Remove row/ })
  await expect(remove).toContainText('Breakdown joins Notes as a tab.')
  // Esc closes the menu and hands the focus back to its ruler; the mode stays.
  await page.keyboard.press('Escape')
  await expect(remove).toHaveCount(0)
  await expect(ruler).toBeFocused()
  await expect(bar(page)).toBeVisible()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: /Remove row/ }).click()
  await expect(cells(page)).toHaveCount(3)
  await expect(page.locator('[data-ws-cell="m-a"] [data-ws-tab]')).toHaveCount(2)
  expect((await storedMain(page)).cells).toHaveLength(3)

  // Done: one write, one global step.
  await bar(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(bar(page)).toHaveCount(0)
  await expectLayoutStored(page)
  await expect.poll(async () => (await storedMain(page)).cells.find((c) => c.id === 'm-a')?.tabs.map((t) => t.id)).toEqual(['m-notes', 'm-bd'])
  await expect.poll(() => newestUndoStep(page)).toBe('Edited layout “Main”')

  // The global Undo puts the layout back.
  await page.locator('[data-snackbar-live]').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await storedMain(page)).cells.map((c) => c.id).sort()).toEqual(['m-a', 'm-b', 'm-c'])
  await expect(cells(page)).toHaveCount(3)
  await expect(page.locator('[data-ws-cell="m-c"]')).toBeVisible()
})
