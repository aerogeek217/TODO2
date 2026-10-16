import { expect, test, type Locator, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList, seedWorkspace, TASK_LIST_TAB, wsCell, wsListWidget } from './fixtures/workspace'
import { box, clickOutside, expectInsideViewport, pointIn, type Point } from './fixtures/geometry'

/**
 * Popover-dismissal contract for portaled popovers built on
 * `usePopoverAnchor`: the task menu opened by right-click (`TaskMenu` on
 * `MenuPopover`) and the workspace cell's ⋯ menu (`MenuPopover`). JSDOM fires synthetic `scroll` /
 * `resize` events with no layout consequences; the contract reads the
 * capture-phase scroll handler and the window resize listener installed by
 * `usePopoverAnchor`, so a real browser is the authoritative surface.
 *
 * The task-row menu gets the four-leg dismissal check:
 *   - outside-click closes
 *   - Escape closes
 *   - window scroll closes
 *   - window resize closes
 * The cell menu opts out of closing on scroll (`closeOnScroll: false`), so it
 * gets outside-click, Escape and resize.
 */

async function rightClickRowCenter(page: Page, title: string): Promise<void> {
  // Right-click on the task title span specifically so the contextmenu lands
  // on the row (and not on a chip popover trigger under the row's bbox center).
  const at = await pointIn(taskRowByTitle(page, title).locator(`span[title="${title}"]`))
  await page.mouse.click(at.x, at.y, { button: 'right' })
}

async function titleCenter(row: Locator, title: string): Promise<Point> {
  const at = await pointIn(row.locator(`span[title="${title}"]`))
  return { x: Math.round(at.x), y: Math.round(at.y) }
}

test.describe('task-row context menu — portalized dismissal contract', () => {
  test.beforeEach(async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'seed' }] })
  })

  test('right-click opens a portalized menu with the task actions; outside-click closes it', async ({ page }) => {
    await rightClickRowCenter(page, 'seed')

    const menu = page.getByRole('menu', { name: 'Task actions' })
    await expect(menu.getByRole('menuitem')).toHaveText([
      /^Open/, /^Mark complete/, /^Set due date…/, /^Follow-up/, /^Followed up/, /^Assign people…/, /^Add tag…/, /^Delete/,
    ])
    await expect(menu.getByRole('menuitemcheckbox')).toHaveText(['Urgent', 'Important', 'Focus'])
    // Portalization invariant: the menu lives at body level, not inside the
    // task row's DOM subtree.
    expect(await menu.evaluate((el) => el.parentElement === document.body)).toBe(true)

    // The `usePopoverAnchor` outside-click listener attaches at `document` in
    // the capture phase, so any mousedown that reaches a non-panel element
    // triggers `onClose`.
    await clickOutside(page, wsListWidget(page, TASK_LIST_TAB))
    await expect(menu).toHaveCount(0)
  })

  test('Escape closes the context menu', async ({ page }) => {
    await rightClickRowCenter(page, 'seed')
    const menu = page.getByRole('menuitem', { name: 'Mark complete' })
    await expect(menu).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })

  test('window scroll closes the context menu', async ({ page }) => {
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

  test('window resize closes the context menu', async ({ page }) => {
    await rightClickRowCenter(page, 'seed')
    const menu = page.getByRole('menuitem', { name: 'Mark complete' })
    await expect(menu).toBeVisible()

    // Real viewport resize — fires `window.resize`.
    await page.setViewportSize({ width: 1180, height: 760 })
    await expect(menu).toHaveCount(0)
  })
})

test.describe('task-row context menu — re-anchor', () => {
  test('right-clicking task B while the menu for A is open re-positions the menu at B', async ({ page }) => {
    // Two widgets side by side showing the same list, so A and B sit far apart.
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'Tasks' }],
      tasks: [{ title: 'task A' }, { title: 'task B' }],
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'left', cells: [{ id: 'l1', tabs: [{ id: 'leftTab', kind: 'lens', listDefIdx: 0 }] }] },
          { id: 'right', cells: [{ id: 'r1', tabs: [{ id: 'rightTab', kind: 'lens', listDefIdx: 0 }] }] },
        ],
      }],
    })
    const rowA = wsListWidget(page, 'leftTab').locator('[data-row-key]').filter({ hasText: 'task A' })
    const rowB = wsListWidget(page, 'rightTab').locator('[data-row-key]').filter({ hasText: 'task B' })
    const menu = page.getByRole('menu')
    const pointA = await titleCenter(rowA, 'task A')
    await page.mouse.click(pointA.x, pointA.y, { button: 'right' })
    await expect(menu).toHaveCount(1)
    const boxA = await box(menu)

    const pointB = await titleCenter(rowB, 'task B')
    await page.mouse.click(pointB.x, pointB.y, { button: 'right' })
    // Exactly one menu, now anchored at B's click point (bottom-start + 4px
    // gap unless a viewport flip/clamp applies — B sits well inside).
    await expect(menu).toHaveCount(1)
    await expect.poll(async () => (await menu.boundingBox())?.x).toBeCloseTo(pointB.x, 0)
    const boxB = await box(menu)
    expect(boxB.y).toBeCloseTo(pointB.y + 4, 0)
    expect(Math.abs(boxB.x - boxA.x) + Math.abs(boxB.y - boxA.y)).toBeGreaterThan(200)

    // Stays inside the viewport (8px margin).
    await expectInsideViewport(page, menu)
  })
})

test.describe('cell ⋯ menu — portalized dismissal contract', () => {
  test.beforeEach(async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'seed' }] })
    await wsCell(page, 'cell').getByRole('button', { name: 'Cell options' }).click()
    await expect(page.getByRole('menu', { name: 'Cell options' })).toBeVisible()
  })

  test('outside-click closes the cell menu', async ({ page }) => {
    await clickOutside(page, wsListWidget(page, TASK_LIST_TAB))
    await expect(page.getByRole('menu', { name: 'Cell options' })).toHaveCount(0)
  })

  test('Escape closes the cell menu', async ({ page }) => {
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name: 'Cell options' })).toHaveCount(0)
  })

  test('window resize closes the cell menu', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 })
    await expect(page.getByRole('menu', { name: 'Cell options' })).toHaveCount(0)
  })
})
