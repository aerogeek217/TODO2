import { expect, test, type Locator, type Page } from '@playwright/test'
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

/** Rows 1 and 2 with a sliver between: part of the line between the left cells moved 10px down. */
const slivered: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['s-a s-b', 's-a s-d', 's-c s-d'],
    rows: [500, 10, 490],
    cells: [
      { id: 's-a', tabs: [{ id: 's-notes', kind: 'notes' }] },
      { id: 's-b', tabs: [{ id: 's-cal', kind: 'calendar' }] },
      { id: 's-c', tabs: [{ id: 's-notes2', kind: 'notes' }] },
      { id: 's-d', tabs: [{ id: 's-bd', kind: 'breakdown' }] },
    ],
  },
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

test('the "+" beside a sliver previews and inserts a full-width row; a line a cell crosses previews new slots only beside it', async ({ page }) => {
  await seedWorkspace(page, { layouts: [slivered] })
  await enterLayoutEdit(page)
  const table = page.locator('[data-ws-table]')
  const fresh = page.locator('[data-preview-new]')

  // The sliver: a tick, no number; one "+" for it and its two lines, named by the rows around it.
  await expect(page.getByRole('button', { name: 'Row 2 options' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Row 3 options' })).toHaveCount(0)
  await expect(page.locator('[data-ruler-plus="rows:2"]')).toHaveCount(0)
  const plus = page.locator('[data-ruler-plus="rows:1"]')
  await expect(plus).toHaveAttribute('data-tooltip', 'Insert row between 1 and 2')

  // Hovered (round two, concept A): the table makes room — one new slot across the whole table —,
  // the "+" pinned where it was, and the bar says it.
  const t = await boxOf(table)
  await plus.hover()
  await expect(fresh).toHaveCount(1)
  expect((await boxOf(fresh.first())).width).toBeGreaterThan(t.width * 0.9)
  await expect(page.getByTestId('layout-edit-preview-hint')).toHaveText(/^Row between 1 and 2/)

  // Clicked: a full-width empty row, the sliver gone; every widget kept; the preview gone.
  await page.locator('[data-pinned]').click()
  await expect(fresh).toHaveCount(0)
  const slots = page.locator('[data-edit-slot]')
  await expect(slots).toHaveCount(1)
  expect((await boxOf(slots.first())).width).toBeGreaterThan(t.width * 0.9)
  await expect(page.getByRole('button', { name: 'Row 3 options' })).toBeVisible()
  await expect(page.locator('[data-ruler^="rows:"]')).toHaveCount(3)
  await expect(page.locator('[data-ws-table] [data-ws-tab]')).toHaveCount(4)

  // Column line 1 is crossed by the new row's cell: the new column's slots lie in rows 1 and 3 only, the row's cell growing across.
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2)
  await expect(page.locator('[data-structure-preview]')).toHaveCount(0)
  await page.locator('[data-ruler-plus="columns:1"]').hover()
  await expect(fresh).toHaveCount(2)
  const slot = await boxOf(slots.first())
  const [top, bottom] = [await boxOf(fresh.nth(0)), await boxOf(fresh.nth(1))]
  expect(top.y + top.height).toBeLessThanOrEqual(slot.y + 1)
  expect(bottom.y).toBeGreaterThanOrEqual(slot.y + slot.height - 1)

  // Left: the table back as it was.
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2)
  await expect(fresh).toHaveCount(0)
  await expect(page.locator('[data-ruler^="columns:"]')).toHaveCount(2)
})

test('a Numbers row that fits its content keeps its height in the mode: no cell moves', async ({ page }) => {
  const number = (id: string, metric: string) => ({ id, kind: 'number' as const, glance: { metric } })
  await seedWorkspace(page, {
    layouts: [{
      name: 'Main',
      table: {
        areas: ['n1 n2', 'a b', 'n3 n3'],
        cells: [
          { id: 'n1', tabs: [number('num1', 'open')] },
          { id: 'n2', tabs: [number('num2', 'overdue')] },
          { id: 'a', tabs: [{ id: 'notesA', kind: 'notes' }] },
          { id: 'b', tabs: [{ id: 'calTab', kind: 'calendar' }] },
          { id: 'n3', tabs: [number('num3', 'focus')] },
        ],
      },
    }],
  })
  const before = await cellBoxes(page)
  await enterLayoutEdit(page)
  await expect(page.getByRole('button', { name: 'Row 3 options' })).toBeVisible()
  expect(await cellBoxes(page)).toEqual(before)
})
