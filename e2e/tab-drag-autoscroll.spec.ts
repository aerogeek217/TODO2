import { expect, test } from '@playwright/test'
import { releaseDrag, seedWorkspace, wsTab, wsRow } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * A tab dragged to the edge of columns that don't fit scrolls them (dnd-kit's
 * auto-scroll); the drop lands in the cell under the pointer after that
 * scroll, not the one under it before (the drag's geometry is measured again
 * as they scroll — cr31 W3).
 */

test.use({ viewport: { width: 900, height: 700 } })

const COLUMNS = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => ({
  id,
  rows: [wsRow({ id: `${id}k`, tabs: [{ id: `${id}t`, kind: 'notes' as const }] })],
}))

// D26 P2: the table scrolls sideways only once its tracks have minimums (columns were 280px at least).
test.fixme('a tab drag that auto-scrolls the columns drops in the cell now under the pointer', async ({ page }) => {
  await seedWorkspace(page, { layouts: [{ name: 'Main', columns: COLUMNS.map((c, i) => i === 0 ? { ...c, rows: [wsRow({ id: 'c1k', tabs: [{ id: 'c1t', kind: 'notes' }, { id: 'mover', kind: 'notes' }], activeTabId: 'mover' })] } : c) }] })
  const scroller = page.locator('[data-ws-cell="c1k"]').locator('xpath=ancestor::*[contains(@class, "columnArea")]')
  await expect(scroller).toHaveCount(1)
  const s = await box(scroller)
  // The strips have fitted their tabs (two frames: the layout, then the strip's measure).
  await expect(wsTab(page, 'mover')).toBeVisible()
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))
  const t = await box(wsTab(page, 'mover'))
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2)
  await page.mouse.down()
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2 + 8, { steps: 2 })
  // Lifted: the drag shows where the tab would go.
  await expect(page.locator('[data-dragging-tab="true"]')).toHaveCount(1)
  // Hold near the columns' right edge, at the strips' height, until they have scrolled.
  const p = { x: s.x + s.width - 12, y: t.y + t.height / 2 }
  await page.mouse.move(p.x, p.y, { steps: 10 })
  // Held there, the pointer moving a pixel at a time, until they have scrolled to their end.
  const left = () => scroller.evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft)
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
  for (let i = 0; i < 120 && (await left()) >= 2; i++) {
    await page.mouse.move(p.x + (i % 2), p.y)
    await frame()
  }
  expect(await left()).toBeLessThan(2)
  // Now on to the last cell's tabs, revealed by the scroll (leftwards: no more scrolling).
  const c5 = await box(wsTab(page, 'c5t'))
  await page.mouse.move(c5.x + c5.width + 20, c5.y + c5.height / 2, { steps: 6 })
  await expect(page.locator('[data-ws-cell="c5k"] [data-testid="ws-tab-insert-line"]')).toHaveCount(1)
  await releaseDrag(page)
  await expect(page.locator('[data-ws-cell="c5k"] [data-ws-tab="mover"]')).toHaveCount(1)
})
