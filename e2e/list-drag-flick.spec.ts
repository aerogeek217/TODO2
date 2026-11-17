import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsListWidget, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * A quick flick of a list row — pressed, moved past the activation distance
 * and let go before the drag's first render — ends the drag. dnd-kit 6 tells
 * no one about a drag that ends before that render commits (its end event is
 * built from state a layout effect fills), so the list's drag state outlived
 * it: the drop slot (in a sorted list "Sorted by … · drop to switch to
 * manual") kept following the pointer over the rows until the tab remounted.
 * `components/workspace/drag-release` ends it on the release. Real-browser:
 * the bug is React's render timing against dnd-kit's sensor.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Sorted', sort: 'name' }],
  tasks: [{ title: 'Alpha' }, { title: 'Bravo' }, { title: 'Charlie' }, { title: 'Delta' }],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

/** Press, a move past the activation distance and the release in one task: React can't render between them. */
async function flick(page: Page, title: string): Promise<{ x: number; y: number }> {
  const row = wsListWidget(page, 't1').locator('[data-row-key]', { has: page.locator(`span[data-task-title="${title}"]`) })
  const b = await box(row)
  const at = { x: b.x + 12, y: b.y + b.height / 2 }
  await row.evaluate((el, p) => {
    const opts = (y: number, buttons: number): PointerEventInit => ({
      bubbles: true, cancelable: true, composed: true, pointerId: 1, isPrimary: true, button: 0, buttons, pointerType: 'mouse', clientX: p.x, clientY: y,
    })
    el.dispatchEvent(new PointerEvent('pointerdown', opts(p.y, 1)))
    document.dispatchEvent(new PointerEvent('pointermove', opts(p.y + 12, 1)))
    document.dispatchEvent(new PointerEvent('pointerup', opts(p.y + 12, 0)))
  }, at)
  return at
}

test.use({ viewport: { width: 1280, height: 800 } })

test('a flicked row leaves no drop slot behind: hovering the rows afterwards draws none', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const widget = wsListWidget(page, 't1')
  await expect(widget.locator('span[data-task-title="Bravo"]')).toBeVisible()
  const at = await flick(page, 'Bravo')
  // Hover over the rows, as after a drag: nothing may follow the pointer.
  for (const dy of [-40, -20, 0, 20, 40]) {
    await page.mouse.move(at.x, at.y + dy)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
    await expect(widget.locator('[data-drop-slot]')).toHaveCount(0)
  }
  // The row is drawn again (a drag hides its own row) and the list is as it was.
  await expect(widget.locator('span[data-task-title="Bravo"]')).toBeVisible()
  expect(await widget.locator('span[data-task-title]').allTextContents()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
})
