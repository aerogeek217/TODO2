import { expect, test } from '@playwright/test'
import { floatingHorizonsByIndex, seedCanvas } from './fixtures/seed'

/**
 * Regression for triage-2026-05-01 P1: the "+ Add list" footer in
 * `HorizonRibbon` was gated on `rows.length === 0`, so once any horizon
 * existed the affordance disappeared and the user had no obvious way to
 * add another. The footer now renders unconditionally; the right-click
 * "Insert below" menu still exists as the secondary path.
 */
test('horizons ribbon "+ Add list" footer stays visible with rows + opens picker', async ({ page }) => {
  await seedCanvas(page, {
    listDefinitions: [
      { name: 'This week' },
      { name: 'Later' },
    ],
    horizonSlotIndexes: [0, 1],
    floatingHorizons: [{ x: 320, y: 280, width: 360, height: 320 }],
  })

  const widget = floatingHorizonsByIndex(page)
  await expect(widget).toBeVisible()

  const ribbonRows = widget.locator('[data-horizon-defid]')
  await expect(ribbonRows.first()).toBeVisible()
  expect(await ribbonRows.count()).toBe(2)

  const addBtn = widget.locator('button', { hasText: '+ Add list' })
  await expect(addBtn).toBeVisible()
  await addBtn.click()

  // Picker portals to body; assert via the header copy passed by
  // `HorizonsSlotContent` → `ListDefinitionPickerPopup`.
  await expect(page.getByText('Add list to canvas')).toBeVisible()
})
