import { expect, test } from '@playwright/test'
import { railBySide, seedCanvas } from './fixtures/seed'

/**
 * Regression covers two bugs on the bottom-rail "+ Add tab" → "List" flow:
 *
 * 1. ListDefinitionPickerPopup clipped the viewport bottom because
 *    `usePopoverAnchor`'s INITIAL_STYLE forced the panel to 0×0
 *    (maxWidth/maxHeight: 0) on the first commit — the only `compute()`
 *    pass measured 0 height, the `panelHeight > 0` gate skipped both flip
 *    and clamp, and the panel ended up positioned at the raw anchor
 *    (button.bottom + 4), which is near the viewport bottom for the
 *    bottom rail.
 * 2. After the flip landed it in the lower-left, the popup rendered
 *    behind CanvasToolbar — its `--z-dropdown: 10` lost to CanvasToolbar's
 *    `--z-fab: 100`. Both are children of `body`, both create their own
 *    stacking context. Bumped to `--z-popover` to match the other portaled
 *    popovers on the flow (WidgetKindMenu / SlotMenu).
 *
 * JSDOM is unauthoritative for both — `getBoundingClientRect()` reports
 * 0×0 regardless of inline style and `elementFromPoint` is non-functional,
 * so the unit tests can't repro either bug.
 */
test('bottom rail "+ Add tab" → List picker stays inside the viewport, above CanvasToolbar', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await seedCanvas(page, {
    listDefinitions: [
      { name: 'List A' },
      { name: 'List B' },
      { name: 'List C' },
      { name: 'List D' },
      { name: 'List E' },
    ],
    canvasRails: {
      left: null,
      right: null,
      top: null,
      bottom: {
        orientation: 'horizontal',
        slots: [{
          id: 'seed-bottom-slot',
          tabs: [{ id: 'seed-bottom-tab', type: 'notes' }],
          activeTabId: 'seed-bottom-tab',
        }],
      },
    },
  })

  const bottomRail = railBySide(page, 'bottom')
  await expect(bottomRail).toBeVisible()

  const addBtn = bottomRail.getByRole('button', { name: 'Add tab' })
  await expect(addBtn).toBeVisible()
  await addBtn.click()

  const kindMenu = page.locator('[role="menu"][aria-label="Add tab"]')
  await expect(kindMenu).toBeVisible()
  await kindMenu.getByRole('menuitem', { name: 'List' }).click()

  // ListDefinitionPickerPopup portals to body with header "Add list to canvas".
  const pickerHeader = page.getByText('Add list to canvas')
  await expect(pickerHeader).toBeVisible()

  // 1. The panel's bottom edge must be inside the viewport. Walk up from
  //    the header to the position:fixed root (the popup container) and
  //    read its rect / computed z-index. Pre-flip-fix the bottom edge was
  //    ~y=1280 in an 800px viewport.
  const viewport = page.viewportSize()!
  const popupInfo = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('div'))
      .filter((d) => d.textContent === 'Add list to canvas')
    const header = headers[0]
    if (!header) return null
    let el: HTMLElement | null = header
    while (el && getComputedStyle(el).position !== 'fixed') {
      el = el.parentElement
    }
    if (!el) return null
    const r = el.getBoundingClientRect()
    const toolbar = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Canvas toolbar"]')
    return {
      popup: { x: r.x, y: r.y, width: r.width, height: r.height, zIndex: parseInt(getComputedStyle(el).zIndex, 10) },
      toolbarZ: toolbar ? parseInt(getComputedStyle(toolbar).zIndex, 10) : null,
    }
  })

  expect(popupInfo).not.toBeNull()
  expect(popupInfo!.popup.height).toBeGreaterThan(0)
  expect(popupInfo!.popup.y + popupInfo!.popup.height).toBeLessThanOrEqual(viewport.height)
  expect(popupInfo!.popup.y).toBeGreaterThanOrEqual(0)

  // 2. The popup must stack above CanvasToolbar — both are children of body
  //    and create their own stacking context, so straight z-index compare
  //    decides the winner if their bounds ever overlap (which they do at
  //    narrower viewports / wider toolbars). Pre-z-index-fix this was 10
  //    (--z-dropdown) vs 100 (--z-fab).
  expect(popupInfo!.toolbarZ).not.toBeNull()
  expect(popupInfo!.popup.zIndex).toBeGreaterThanOrEqual(popupInfo!.toolbarZ!)
})
