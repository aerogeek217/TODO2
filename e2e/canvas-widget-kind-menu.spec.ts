import { expect, test } from '@playwright/test'
import {
  listInsetByIndex,
  seedCanvas,
  widgetKindMenu,
  widgetKindMenuFlyout,
} from './fixtures/seed'

/**
 * Phase 6 canvas-coverage: WidgetKindMenu hover flyout. Encodes the lens-only
 * "Change list…" secondary row and its in-place hover flyout, added by
 * `lists-consistency P1` (commit 9005fe4) and consumed by `ListInsetNode` /
 * `LensSlotContent` / rails `WidgetKindMenu` callers.
 *
 * JSDOM is unauthoritative for this surface — `WidgetKindMenu` portals two
 * `<div role="menu">` panels to `document.body` and `clientX/clientY`-derived
 * placement clamps run on `getBoundingClientRect`, both of which are
 * unreliable under JSDOM. `pointerenter`-driven hover intent + the leave-delay
 * timer are also order-sensitive in real browsers but coalesce into noise in
 * JSDOM.
 */
test.describe('canvas WidgetKindMenu hover flyout (P6)', () => {
  test('lens widget: title-caret opens menu → hover Change list → pick changes the lens', async ({ page }) => {
    await seedCanvas(page, {
      listDefinitions: [
        { name: 'Source list' },
        { name: 'Target list' },
      ],
      listInsets: [
        { listDefIdx: 0, x: 320, y: 200, width: 320, height: 240 },
      ],
    })

    const inset = listInsetByIndex(page)
    await expect(inset).toBeVisible()
    // The lens widget's header title is rendered as a title-caret button when
    // `onTitleClick` is wired. WidgetHeader's button uses `aria-label="Change List"`
    // (KIND_LABEL.lens === 'List'), title contains the def name.
    const titleButton = inset.locator('button[aria-haspopup="menu"][aria-label="Change List"]').first()
    await expect(titleButton).toContainText('Source list')

    await titleButton.click()
    const menu = widgetKindMenu(page)
    await expect(menu).toBeVisible()

    // Lens-only secondary row carries the current def name; hovering opens the
    // in-place flyout (`onPointerEnter={openFlyoutFromRow}`).
    const secondary = menu.locator('button[role="menuitem"][aria-haspopup="menu"]')
    await expect(secondary).toContainText('Change list (Source list)…')

    await secondary.hover()
    const flyout = widgetKindMenuFlyout(page)
    await expect(flyout).toBeVisible()

    // Pick "Target list" → the menu's `pickListForLens` callback fires;
    // `ListInsetNode.handleSelectList` updates the inset; menu closes.
    await flyout.getByRole('button', { name: 'Target list' }).click()
    await expect(menu).toHaveCount(0)
    await expect(flyout).toHaveCount(0)
    await expect(titleButton).toContainText('Target list')
  })

  test('keyboard: ArrowRight opens flyout, Escape closes back to the menu', async ({ page }) => {
    await seedCanvas(page, {
      listDefinitions: [
        { name: 'Source list' },
        { name: 'Target list' },
      ],
      listInsets: [
        { listDefIdx: 0, x: 320, y: 200, width: 320, height: 240 },
      ],
    })

    const inset = listInsetByIndex(page)
    await expect(inset).toBeVisible()
    const titleButton = inset.locator('button[aria-haspopup="menu"][aria-label="Change List"]').first()
    await titleButton.click()
    const menu = widgetKindMenu(page)
    await expect(menu).toBeVisible()

    // Roving tabindex: focus lands on the first menuitem; ArrowDown to the
    // secondary "Change list…" row (after Edit list + 5 kinds).
    // The order is: Edit list, lens, notes, calendar, taskboard, horizons,
    // Change list… → 6 ArrowDown presses to land on the secondary row.
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown')
    const secondary = menu.locator('button[role="menuitem"][aria-haspopup="menu"]')
    await expect(secondary).toBeFocused()

    // ArrowRight on the secondary opens the flyout (hover-equivalent).
    await page.keyboard.press('ArrowRight')
    const flyout = widgetKindMenuFlyout(page)
    await expect(flyout).toBeVisible()

    // Escape closes the flyout but leaves the parent menu open.
    await page.keyboard.press('Escape')
    await expect(flyout).toHaveCount(0)
    await expect(menu).toBeVisible()
    await expect(secondary).toBeFocused()
  })
})
