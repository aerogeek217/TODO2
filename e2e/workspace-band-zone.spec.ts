import { expect, test } from '@playwright/test'
import { dragTab, seedWorkspace, wsCell, wsShape, wsTab, wsRow, type WsLayoutSeed } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * The new-band zone never covers a cell, in a real browser (cr33 M9): a
 * headless Number row first in its column keeps its "New row above" zone,
 * and a column's last cell its "New row below"; the workspace's padding
 * outside the cells is the new band.
 */

test.use({ viewport: { width: 1280, height: 900 } })

/** [colA: (n1: numTab) fit, (a1: notesTab)] [colB: (b1: calTab) (b2: notes2)] */
const numberFirst: WsLayoutSeed = {
  name: 'Main',
  columns: [
    { id: 'colA', rows: [wsRow({ id: 'n1', tabs: [{ id: 'numTab', kind: 'number' }] }), wsRow({ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }] })] },
    { id: 'colB', rows: [wsRow({ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] }), wsRow({ id: 'b2', tabs: [{ id: 'notes2', kind: 'notes' }] })] },
  ],
}

test('a headless Number row first in its column: its top quarter is New row above, not a new band', async ({ page }) => {
  await seedWorkspace(page, { layouts: [numberFirst] })
  await expect(wsCell(page, 'n1')).toHaveAttribute('data-headless', 'true')
  const n = await box(wsCell(page, 'n1'))
  const area = await box(page.locator('[data-ws-area]'))
  // Inside the old band zone (the area's top 24px), in the cell's top quarter.
  const to = { x: n.x + n.width / 2, y: n.y + 8 }
  expect(to.y).toBeLessThan(area.y + 24)
  expect(to.y).toBeLessThan(n.y + n.height / 4)
  await dragTab(page, wsTab(page, 'notes2'), to, async () => {
    await expect(wsCell(page, 'n1').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', 'top')
    await expect(wsCell(page, 'n1').getByTestId('ws-drop-zones')).toContainText('New cell above')
    await expect(page.getByTestId('ws-new-band-strip')).toHaveCount(0)
  })
  await expect.poll(() => wsShape(page)).toEqual([[['notes2'], ['numTab'], ['notesTab']], [['calTab']]])
})

test('a column’s last cell: its bottom 18px are New row below; the padding under it is the new band', async ({ page }) => {
  await seedWorkspace(page, { layouts: [numberFirst] })
  const a1 = await box(wsCell(page, 'a1'))
  const area = await box(page.locator('[data-ws-area]'))
  const to = { x: a1.x + a1.width / 2, y: a1.y + a1.height - 8 }
  expect(to.y).toBeGreaterThan(area.y + area.height - 24)
  await dragTab(page, wsTab(page, 'calTab'), to, async () => {
    await expect(wsCell(page, 'a1').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', 'bottom')
    await expect(page.getByTestId('ws-new-band-strip')).toHaveCount(0)
    // Into the padding below: the new band.
    await page.mouse.move(to.x, area.y + area.height - 3, { steps: 3 })
    await expect(page.getByTestId('ws-new-band-strip')).toHaveAttribute('data-edge', 'bottom')
    await page.mouse.move(to.x, to.y, { steps: 3 })
    await expect(page.getByTestId('ws-new-band-strip')).toHaveCount(0)
  })
  await expect.poll(() => wsShape(page)).toEqual([[['numTab'], ['notesTab'], ['calTab']], [['notes2']]])
})
