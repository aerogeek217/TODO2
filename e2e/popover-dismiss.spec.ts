import { expect, test, type Page } from '@playwright/test'
import {
  railBySide,
  seedCanvas,
  seedCanvasWithProjects,
  taskRowByTitle,
} from './fixtures/seed'

/**
 * P13 migration: ui-consistency P1's popover-dismissal contract for the
 * three popovers that gained `usePopoverAnchor` portalization
 * (`CanvasContextMenu`, `ProjectPickerPopup`, `SlotMenu`). The previous
 * JSDOM cover (`src/test/components/overlays/popover-dismiss.test.tsx`)
 * fired synthetic `scroll` / `resize` events that JSDOM treats as bare
 * Event objects with no layout consequences — the actual contract reads
 * the capture-phase scroll handler installed in `usePopoverAnchor.ts:302`,
 * so a real browser running the listener against a real `window`/`document`
 * stack is the authoritative surface.
 *
 * Each popover gets the universal four-leg dismissal check:
 *   - outside-click closes
 *   - Escape closes
 *   - window scroll closes (gained via portal migration)
 *   - window resize closes (gained via portal migration)
 */

async function rightClickRowCenter(page: Page, title: string): Promise<void> {
  // Helper-local: avoid repeating the right-click pattern at three sites below.
  // Right-click on the task title span specifically so the contextmenu lands
  // on the row (and not on a chip popover trigger that lives under the row's
  // bbox center per the post-P10 slot reorder).
  const span = taskRowByTitle(page, title).locator(`span[title="${title}"]`)
  const box = await span.boundingBox()
  if (!box) throw new Error(`right-click target "${title}" has no bounding box`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
}

test.describe('CanvasContextMenu — portalized dismissal contract', () => {
  test('right-click opens a portalized menu; outside-click closes it', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'P1', tasks: ['seed'] }],
    })
    await rightClickRowCenter(page, 'seed')

    // Portalization invariant: the menu lives at body level, not inside the
    // task row's DOM subtree. Hidden-but-present is fine; we just check the
    // menu mounted.
    const menu = page.getByRole('menuitem', { name: 'Mark complete' })
    await expect(menu).toBeVisible()

    // Outside-click — fire a real mousedown well below the menu via
    // `page.mouse.click` (skips Playwright's actionability checks that fail
    // on a viewport intercepted by `react-flow__pane`). The
    // `usePopoverAnchor` outside-click listener attaches at `document` in the
    // capture phase, so any mousedown that reaches a non-panel element
    // triggers `onClose`.
    await page.mouse.click(600, 600)
    await expect(menu).toHaveCount(0)
  })

  test('Escape closes the context menu', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'P1', tasks: ['seed'] }],
    })
    await rightClickRowCenter(page, 'seed')
    const menu = page.getByRole('menuitem', { name: 'Mark complete' })
    await expect(menu).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })

  test('window scroll closes the context menu (gained via portal migration)', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'P1', tasks: ['seed'] }],
    })
    await rightClickRowCenter(page, 'seed')
    const menu = page.getByRole('menuitem', { name: 'Mark complete' })
    await expect(menu).toBeVisible()

    // Synthetic scroll on document.body — `usePopoverAnchor` listens
    // capture-phase on `window` for `scroll`, so any scroll up the tree
    // (including a body-level dispatch) hits the handler.
    await page.evaluate(() => {
      document.body.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await expect(menu).toHaveCount(0)
  })

  test('window resize closes the context menu (gained via portal migration)', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'P1', tasks: ['seed'] }],
    })
    await rightClickRowCenter(page, 'seed')
    const menu = page.getByRole('menuitem', { name: 'Mark complete' })
    await expect(menu).toBeVisible()

    // Real viewport resize — fires `window.resize`, which `usePopoverAnchor`
    // listens for. Restore the configured viewport at the end so subsequent
    // assertions don't drift if the helper is reused.
    await page.setViewportSize({ width: 1180, height: 760 })
    await expect(menu).toHaveCount(0)
  })
})

test.describe('ProjectPickerPopup — portalized dismissal contract', () => {
  test('opens via context menu; outside-click closes it', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [
        { name: 'P1', tasks: ['seed'] },
        { name: 'P2', tasks: [] },
      ],
    })
    await rightClickRowCenter(page, 'seed')
    await page.getByRole('menuitem', { name: 'Move to project…' }).click()
    // Anchor on the picker's search input — unique to the picker portal,
    // unambiguous vs. the project node's `P2` text on the canvas.
    const picker = page.getByPlaceholder('Search projects...')
    await expect(picker).toBeVisible()

    await page.mouse.click(600, 600)
    await expect(picker).toHaveCount(0)
  })

  test('Escape closes the project picker', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [
        { name: 'P1', tasks: ['seed'] },
        { name: 'P2', tasks: [] },
      ],
    })
    await rightClickRowCenter(page, 'seed')
    await page.getByRole('menuitem', { name: 'Move to project…' }).click()
    // Anchor on the picker's search input — unique to the picker portal,
    // unambiguous vs. the project node's `P2` text on the canvas.
    const picker = page.getByPlaceholder('Search projects...')
    await expect(picker).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
  })

  test('window scroll closes the project picker', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [
        { name: 'P1', tasks: ['seed'] },
        { name: 'P2', tasks: [] },
      ],
    })
    await rightClickRowCenter(page, 'seed')
    await page.getByRole('menuitem', { name: 'Move to project…' }).click()
    // Anchor on the picker's search input — unique to the picker portal,
    // unambiguous vs. the project node's `P2` text on the canvas.
    const picker = page.getByPlaceholder('Search projects...')
    await expect(picker).toBeVisible()

    await page.evaluate(() => {
      document.body.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await expect(picker).toHaveCount(0)
  })

  test('window resize closes the project picker', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [
        { name: 'P1', tasks: ['seed'] },
        { name: 'P2', tasks: [] },
      ],
    })
    await rightClickRowCenter(page, 'seed')
    await page.getByRole('menuitem', { name: 'Move to project…' }).click()
    // Anchor on the picker's search input — unique to the picker portal,
    // unambiguous vs. the project node's `P2` text on the canvas.
    const picker = page.getByPlaceholder('Search projects...')
    await expect(picker).toBeVisible()

    await page.setViewportSize({ width: 1180, height: 760 })
    await expect(picker).toHaveCount(0)
  })
})

test.describe('SlotMenu — portalized dismissal contract', () => {
  // SlotMenu lives on a rail slot's "Slot options" button. Seeding a left
  // rail with one lens slot (referencing a real list def, so the slot
  // renders without `useDefaultRails` reseeding) gives us the trigger.
  async function seedRailWithLensSlot(page: Page): Promise<void> {
    await seedCanvas(page, {
      listDefinitions: [{ name: 'Source list' }],
      canvasRails: {
        left: {
          orientation: 'vertical',
          slots: [{
            id: 'slot-A',
            tabs: [{ id: 'tab-A', type: 'lens', listDefIdx: 0 }],
            activeTabId: 'tab-A',
          }],
        },
        right: null,
        top: null,
        bottom: null,
      },
    })
    await railBySide(page, 'left').waitFor({ state: 'visible' })
  }

  test('opens via slot-options button; outside-click closes it', async ({ page }) => {
    await seedRailWithLensSlot(page)
    await page.getByRole('button', { name: 'Slot options' }).first().click()
    const menu = page.getByRole('menu', { name: /list slot options/i })
    await expect(menu).toBeVisible()

    // Outside-click via direct mouse coords (avoids
    // `react-flow__pane intercepts pointer events` actionability check on
    // viewport locators).
    await page.mouse.click(700, 500)
    await expect(menu).toHaveCount(0)
  })

  test('Escape closes the slot menu', async ({ page }) => {
    await seedRailWithLensSlot(page)
    await page.getByRole('button', { name: 'Slot options' }).first().click()
    const menu = page.getByRole('menu', { name: /list slot options/i })
    await expect(menu).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })

  test('window scroll closes the slot menu', async ({ page }) => {
    await seedRailWithLensSlot(page)
    await page.getByRole('button', { name: 'Slot options' }).first().click()
    const menu = page.getByRole('menu', { name: /list slot options/i })
    await expect(menu).toBeVisible()

    await page.evaluate(() => {
      document.body.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await expect(menu).toHaveCount(0)
  })

  test('window resize closes the slot menu', async ({ page }) => {
    await seedRailWithLensSlot(page)
    await page.getByRole('button', { name: 'Slot options' }).first().click()
    const menu = page.getByRole('menu', { name: /list slot options/i })
    await expect(menu).toBeVisible()

    await page.setViewportSize({ width: 1180, height: 760 })
    await expect(menu).toHaveCount(0)
  })
})
