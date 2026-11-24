import { expect, test, type Locator, type Page } from '@playwright/test'
import { edges, expectLayoutStored, newestUndoStep, releaseDrag, seedWorkspace, wsCell, wsDivider, type WsLayoutSeed } from './fixtures/workspace'
import { box } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * Collapse column, and one collapse control for rows and columns: a pill on
 * a divider (shown on its hover) collapses the columns on either side of a
 * vertical divider (◂ ▸) or the rows on either side of a horizontal one
 * (▴ ▾). A collapsed column is a strip — Expand column, then its widgets'
 * names — saved with the layout. A drag on the divider still resizes.
 */

/** Notes on the left, a Calendar on the right. */
const twoColumns: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['a b'],
    cells: [
      { id: 'a', tabs: [{ id: 'aTab', kind: 'notes' }] },
      { id: 'b', tabs: [{ id: 'bTab', kind: 'calendar' }] },
    ],
  },
}

/** Notes over a Calendar. */
const twoRows: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['a', 'b'],
    cells: [
      { id: 'a', tabs: [{ id: 'aTab', kind: 'notes' }] },
      { id: 'b', tabs: [{ id: 'bTab', kind: 'calendar' }] },
    ],
  },
}

type StoredTrack = { id: string; weight?: number; collapsed?: boolean }

async function storedTracks(page: Page, axis: 'columns' | 'rows'): Promise<boolean[]> {
  const row = (await readStore<{ grid: Record<'columns' | 'rows', StoredTrack[]> }>(page, 'layouts'))[0]
  return (row?.grid[axis] ?? []).map((t) => t.collapsed === true)
}

/** Hovers a divider's middle; its pill shows there. */
async function hoverDivider(page: Page, divider: Locator): Promise<void> {
  const b = await box(divider)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 40)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
}

const strip = (page: Page) => page.getByRole('region', { name: 'Collapsed column' })

test.describe('the divider’s pill between columns', () => {
  test('hovering the divider shows ◂ ▸; ▸ collapses the right column to a strip, its ›‹ expands it — view state, no undo step', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const right = page.getByRole('button', { name: 'Collapse the column on the right' })
    await expect(right).toBeHidden()
    await hoverDivider(page, wsDivider(page, 'a', 'b'))
    await expect(right).toBeVisible()
    await expect(page.getByRole('button', { name: 'Collapse the column on the left' })).toBeVisible()
    await right.click()
    await expect(strip(page)).toBeVisible()
    await expect(wsCell(page, 'b')).toHaveCount(0)
    expect(Math.round((await box(strip(page))).width)).toBe(34)
    await expect(strip(page).getByRole('button', { name: 'Calendar' })).toBeVisible()
    // The other column takes its room: no divider is left beside the strip.
    await expect(page.locator('[data-ws-divider][data-axis="columns"]')).toHaveCount(0)
    const stripLeft = (await box(strip(page))).x
    expect(Math.abs((await edges(wsCell(page, 'a'))).right + 6 - stripLeft)).toBeLessThanOrEqual(1)
    await expectLayoutStored(page)
    await expect.poll(() => storedTracks(page, 'columns')).toEqual([false, true])
    expect(await newestUndoStep(page)).toBeNull()

    await strip(page).getByRole('button', { name: 'Expand column' }).click()
    await expect(strip(page)).toHaveCount(0)
    await expect(wsCell(page, 'b')).toBeVisible()
    await expect.poll(() => storedTracks(page, 'columns')).toEqual([false, false])
  })

  test('◂ collapses the left column; a name in the strip opens that widget larger, the column left collapsed', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await hoverDivider(page, wsDivider(page, 'a', 'b'))
    await page.getByRole('button', { name: 'Collapse the column on the left' }).click()
    await expect(wsCell(page, 'a')).toHaveCount(0)
    const strips = strip(page)
    await expect(strips).toBeVisible()
    expect((await box(strips)).x).toBeLessThan((await box(wsCell(page, 'b'))).x)
    await strips.getByRole('button', { name: 'Notes' }).click()
    await expect(page.getByRole('dialog', { name: /Notes/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(strips).toBeVisible()
    await expect.poll(() => storedTracks(page, 'columns')).toEqual([true, false])
  })

  test('a collapsed column is kept over a reload', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await hoverDivider(page, wsDivider(page, 'a', 'b'))
    await page.getByRole('button', { name: 'Collapse the column on the right' }).click()
    await expectLayoutStored(page)
    await expect.poll(() => storedTracks(page, 'columns')).toEqual([false, true])
    await page.reload()
    await expect(strip(page)).toBeVisible()
    await expect(strip(page).getByRole('button', { name: 'Calendar' })).toBeVisible()
    await expect(wsCell(page, 'b')).toHaveCount(0)
  })

  test('a drag on the divider still resizes, and never presses the pill', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const a0 = await edges(wsCell(page, 'a'))
    const b = await box(wsDivider(page, 'a', 'b'))
    // Away from the pill at the middle: near the divider's top.
    const from = { x: b.x + b.width / 2, y: b.y + 30 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x - 120, from.y, { steps: 12 })
    await releaseDrag(page)
    await expect.poll(async () => Math.round(a0.right - (await edges(wsCell(page, 'a'))).right)).toBeGreaterThan(100)
    await expect(strip(page)).toHaveCount(0)
    await expect.poll(() => storedTracks(page, 'columns')).toEqual([false, false])
  })

  test('the cell’s ⋯ has Collapse column beside Collapse row', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await wsCell(page, 'b').hover()
    await wsCell(page, 'b').getByRole('button', { name: 'Cell options' }).click()
    const menu = page.getByRole('menu', { name: 'Cell options' })
    await expect(menu.getByRole('menuitem', { name: 'Collapse row' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Collapse column' }).click()
    await expect(strip(page)).toBeVisible()
    await expect.poll(() => storedTracks(page, 'columns')).toEqual([false, true])
  })
})

test.describe('the divider’s pill between rows', () => {
  test('▾ collapses the row below, ▴ the row above (today’s Collapse row)', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoRows] })
    await hoverDivider(page, wsDivider(page, 'a', 'b'))
    await page.getByRole('button', { name: 'Collapse the row below' }).click()
    await expect(wsCell(page, 'b').getByRole('button', { name: 'Expand row' })).toBeVisible()
    await expect.poll(() => storedTracks(page, 'rows')).toEqual([false, true])
    // A line beside a collapsed row has no divider: expand, then collapse the row above.
    await wsCell(page, 'b').getByRole('button', { name: 'Expand row' }).click()
    await expect.poll(() => storedTracks(page, 'rows')).toEqual([false, false])
    await hoverDivider(page, wsDivider(page, 'a', 'b'))
    await page.getByRole('button', { name: 'Collapse the row above' }).click()
    await expect.poll(() => storedTracks(page, 'rows')).toEqual([true, false])
  })
})
