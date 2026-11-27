import { expect, test } from '@playwright/test'
import { seedWorkspace, wsRow } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * A Planner row opens its task on a single click, so a double-click's second
 * press lands on the editor's backdrop when the pointer is outside the
 * panel. That press closes nothing (`use-backdrop-press`: `detail >= 2`);
 * a single press on the backdrop still closes the editor.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const seed = {
  tasks: [{ title: 'Chase the invoice', followupInDays: 0 }],
  layouts: [{ name: 'Week', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' as const }] })] }] }],
}

test('a double-click on a Planner row outside the editor panel leaves the editor open', async ({ page }) => {
  await seedWorkspace(page, seed)
  const row = page.locator('[data-planner="plan"] [data-row-key]').filter({ hasText: 'Chase the invoice' })
  const r = await box(row)
  // Near the cell's left edge, on the title, clear of the checkbox.
  const point = { x: r.x + 70, y: r.y + r.height / 2 }
  await page.mouse.dblclick(point.x, point.y)

  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await expect(editor).toBeVisible()
  // The second press really landed outside the panel, on the backdrop.
  const panel = await box(editor)
  expect(point.x < panel.x || point.x > panel.x + panel.width || point.y < panel.y || point.y > panel.y + panel.height).toBe(true)
  await expect(editor).toBeVisible()

  // A single press there still closes it.
  await page.mouse.click(point.x, point.y)
  await expect(editor).toHaveCount(0)
})
