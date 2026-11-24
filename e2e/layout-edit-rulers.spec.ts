import { expect, test, type Locator, type Page } from '@playwright/test'
import { edgeTab, enterLayoutEdit, expectLayoutStored, newestUndoStep, seedWorkspace, type WsLayoutSeed } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * The layout edit mode's room, headers and edge tabs in a real browser:
 * entering the mode steps the table in — a frame round it, 26px top and
 * left for the headers, 14px right and bottom, and 16px gaps — with a
 * header on every track in the frame, outside the cards, and no "+"
 * anywhere; the selected card's headers light, and its edge tab inserts a
 * full row on the draft; a row header's Remove row moves the row's widget
 * into the cell above as a tab (its menu says so); Done stores the draft
 * as one step, and the global Undo puts it back.
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

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

test('the room and the headers, a row by an edge tab, Remove row moves a widget as a tab, Done, then the global Undo', async ({ page }) => {
  await seedWorkspace(page, { layouts: [main] })
  await enterLayoutEdit(page)
  await expect(bar(page)).toBeVisible()

  // The room: the cards 16px apart, 26px in from the area's top and left, 14px from its right and bottom.
  const area = await boxOf(page.locator('[data-ws-area]'))
  const a = await boxOf(page.locator('[data-ws-cell="m-a"]'))
  const b = await boxOf(page.locator('[data-ws-cell="m-b"]'))
  const c = await boxOf(page.locator('[data-ws-cell="m-c"]'))
  expect(Math.round(a.x - area.x)).toBe(26)
  expect(Math.round(a.y - area.y)).toBe(26)
  expect(Math.round(b.x - (a.x + a.width))).toBe(16)
  expect(Math.round(c.y - (a.y + a.height))).toBe(16)
  expect(Math.round(area.x + area.width - (b.x + b.width))).toBe(14)
  expect(Math.round(area.y + area.height - (c.y + c.height))).toBe(14)

  // A header per track in the frame, outside the cards; no "+" and no edge tab before a selection.
  const colA = page.getByRole('button', { name: 'Column A options' })
  const row2 = page.getByRole('button', { name: 'Row 2 options' })
  await expect(page.getByRole('button', { name: 'Column B options' })).toBeVisible()
  const colBox = await boxOf(colA)
  const rowBox = await boxOf(row2)
  expect(colBox.y + colBox.height).toBeLessThanOrEqual(a.y)
  expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(c.x)
  await expect(page.getByRole('button', { name: /^Insert (row|column) here$/ })).toHaveCount(0)
  await expect(page.locator('[data-edge-tab]')).toHaveCount(0)
  // A column's share shows on its header's hover.
  await colA.hover()
  await expect(colA).toContainText('50%')

  // The Breakdown selected: its headers light (A, B and 2), its edge tabs sit in the seams round it.
  const below = await edgeTab(page, 'm-c', 'Row below')
  await expect(page.locator('[data-ruler][data-lit]')).toHaveCount(3)
  await expect(row2).toHaveAttribute('data-lit', '')
  const above = await boxOf(page.getByRole('button', { name: 'Insert row above', exact: true }))
  expect(above.y + above.height / 2).toBeGreaterThan(a.y + a.height)
  expect(above.y + above.height / 2).toBeLessThan(c.y)
  // Its Row below: a full row at the bottom, on the draft only; its new slot selected.
  await below.click()
  await expect(cells(page)).toHaveCount(4)
  await expect(page.locator('[data-ws-table] [data-ws-cell][data-empty="true"]')).toHaveAttribute('data-edit-selected', '')
  await expect(page.getByRole('button', { name: 'Row 3 options' })).toBeVisible()
  expect((await storedMain(page)).cells).toHaveLength(3)
  expect(await newestUndoStep(page)).toBeNull()

  // Row 2's menu: Remove row says the Breakdown joins Notes as a tab.
  await row2.click()
  const remove = page.getByRole('menuitem', { name: /Remove row/ })
  await expect(remove).toContainText('Breakdown joins Notes as a tab.')
  // Esc closes the menu and hands the focus back to its header; the mode stays.
  await page.keyboard.press('Escape')
  await expect(remove).toHaveCount(0)
  await expect(row2).toBeFocused()
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
  await expect.poll(async () => (await storedMain(page)).cells.find((x) => x.id === 'm-a')?.tabs.map((t) => t.id)).toEqual(['m-notes', 'm-bd'])
  await expect.poll(() => newestUndoStep(page)).toBe('Edited layout “Main”')

  // The global Undo puts the layout back.
  await page.locator('[data-snackbar-live]').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await storedMain(page)).cells.map((x) => x.id).sort()).toEqual(['m-a', 'm-b', 'm-c'])
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

test('an edge tab beside a sliver previews and inserts a full-width row; a line a cell crosses previews new slots only beside it', async ({ page }) => {
  await seedWorkspace(page, { layouts: [slivered] })
  await enterLayoutEdit(page)
  const table = page.locator('[data-ws-table]')
  const fresh = page.locator('[data-preview-new]')

  // The sliver: a tick in the header band, no number.
  await expect(page.getByRole('button', { name: 'Row 2 options' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Row 3 options' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Narrow row after 1 options' })).toBeVisible()

  // The Calendar's Row below, on the sliver's line: hovered, the table makes room — one new slot across the
  // whole table (the sliver and its lines one line) —, the tab staying where it was, and the bar says it.
  const t = await boxOf(table)
  const tab = await edgeTab(page, 's-b', 'Row below')
  const at = await boxOf(tab)
  await tab.hover()
  await expect(fresh).toHaveCount(1)
  expect((await boxOf(fresh.first())).width).toBeGreaterThan(t.width * 0.9)
  await expect(page.getByTestId('layout-edit-preview-hint')).toHaveText(/^Row between 1 and 2/)
  expect(await boxOf(tab)).toEqual(at)

  // Clicked: a full-width empty row, the sliver gone; every widget kept; the preview gone.
  await tab.click()
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
  await (await edgeTab(page, 's-a', 'Column right')).hover()
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

test('a Numbers row that fits its content keeps its height in the mode', async ({ page }) => {
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
  // The Numbers' heights (the cards step in for the room: the weighted row gives it).
  const numberHeights = async () => (await cellBoxes(page)).filter((_, i) => i !== 2 && i !== 3).map((box) => box.split(',')[3])
  const before = await numberHeights()
  await enterLayoutEdit(page)
  await expect(page.getByRole('button', { name: 'Row 3 options' })).toBeVisible()
  expect(await numberHeights()).toEqual(before)
})
