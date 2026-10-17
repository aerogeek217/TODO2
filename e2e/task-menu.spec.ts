import { expect, test, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList, seedWorkspace, TASK_LIST_TAB, wsListWidget } from './fixtures/workspace'

/**
 * The task menu, the tooltip and the list bulk bar's ⋯ More in a real
 * browser: focus handoff (open → first item, Esc → back to ⋯), arrow-key
 * navigation into and out of the Follow-up submenu, submenu placement beside
 * its item (flipped left near the right edge), the 400 ms tooltip delay, and
 * the bulk bar's width. JSDOM is not authoritative for any of these.
 */

const moreButton = (page: Page, title: string) =>
  taskRowByTitle(page, title).getByRole('button', { name: 'Task actions' })

const focusedLabel = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-menu-label') ?? document.activeElement?.getAttribute('aria-label') ?? null)

test.describe('task menu', () => {
  test.beforeEach(async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'alpha', followupInDays: 3 }, { title: 'beta', urgent: true }] })
  })

  test('⋯ is revealed on hover and opens the menu; arrows move, Esc returns focus to ⋯', async ({ page }) => {
    const more = moreButton(page, 'alpha')
    await expect(more).toBeHidden()
    await taskRowByTitle(page, 'alpha').hover()
    await expect(more).toBeVisible()
    await more.click()
    const menu = page.getByRole('menu', { name: 'Task actions' })
    await expect(menu).toBeVisible()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    // Anchored under the ⋯ button, right edges aligned.
    const mb = (await more.boundingBox())!
    const pb = (await menu.boundingBox())!
    expect(Math.abs(pb.x + pb.width - (mb.x + mb.width))).toBeLessThanOrEqual(1)
    expect(pb.y).toBeGreaterThanOrEqual(mb.y + mb.height)

    expect(await focusedLabel(page)).toBe('Open')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    expect(await focusedLabel(page)).toBe('Set due date…')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowUp')
    expect(await focusedLabel(page)).toBe('Delete')
    // Type-ahead.
    await page.keyboard.press('a')
    expect(await focusedLabel(page)).toBe('Assign people…')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(more).toBeFocused()
  })

  test('Follow-up ›: → opens the submenu beside the item with focus inside; ← closes it; an interval sets the date', async ({ page }) => {
    // Right-click near the row's left end, so there is room on the right.
    await taskRowByTitle(page, 'alpha').locator('span[title="alpha"]').click({ button: 'right' })
    const item = page.getByRole('menuitem', { name: /^Follow-up/ })
    await item.focus()
    await page.keyboard.press('ArrowRight')
    const sub = page.getByRole('menu', { name: 'Follow-up' })
    await expect(sub).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /^1 week/ })).toBeFocused()
    const ib = (await item.boundingBox())!
    const sb = (await sub.boundingBox())!
    // Beside the parent menu, its first item level with the parent item.
    expect(sb.x).toBeGreaterThanOrEqual(ib.x + ib.width)
    expect(Math.abs(sb.y + 4 - ib.y)).toBeLessThanOrEqual(2)

    await page.keyboard.press('ArrowLeft')
    await expect(sub).toHaveCount(0)
    await expect(item).toBeFocused()
    // Esc with the submenu open closes only the submenu.
    await item.click()
    await expect(sub).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sub).toHaveCount(0)
    await expect(page.getByRole('menu', { name: 'Task actions' })).toBeVisible()

    await item.click()
    await page.getByRole('menuitem', { name: /^2 weeks/ }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(taskRowByTitle(page, 'alpha').locator('[data-pill="followup"]')).toBeVisible()
  })

  test('the submenu flips to the left of the menu near the right edge', async ({ page }) => {
    const vp = page.viewportSize()!
    // Right-click the row near the right edge of the viewport.
    const row = taskRowByTitle(page, 'alpha')
    const rb = (await row.boundingBox())!
    await page.mouse.click(Math.min(rb.x + rb.width - 10, vp.width - 10), rb.y + rb.height / 2, { button: 'right' })
    const menu = page.getByRole('menu', { name: 'Task actions' })
    await expect(menu).toBeVisible()
    await page.getByRole('menuitem', { name: /^Follow-up/ }).hover()
    const sub = page.getByRole('menu', { name: 'Follow-up' })
    await expect(sub).toBeVisible()
    const mb = (await menu.boundingBox())!
    const sb = (await sub.boundingBox())!
    expect(sb.x + sb.width).toBeLessThanOrEqual(vp.width)
    // No room on the right of the menu, so the submenu sits on its left.
    expect(mb.x + mb.width + sb.width).toBeGreaterThan(vp.width - 8)
    expect(sb.x + sb.width).toBeLessThanOrEqual(mb.x + 1)
  })

  test('markers are checkbox items; Urgent is checked for a flagged task', async ({ page }) => {
    await taskRowByTitle(page, 'beta').locator('span[title="beta"]').click({ button: 'right' })
    await expect(page.getByRole('menuitemcheckbox', { name: 'Urgent' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('menuitemcheckbox', { name: 'Important' }).click()
    await expect(taskRowByTitle(page, 'beta').getByRole('img', { name: 'Important' })).toBeVisible()
  })

  test('tooltip: the follow-up pill tooltip opens after 400 ms, not before', async ({ page }) => {
    const pill = taskRowByTitle(page, 'alpha').locator('[data-pill="followup"]')
    // Timed in the page from the pointer entering the pill (the event that
    // starts the delay) — not from a later evaluate, whose start lags the
    // hover by however long the round trip takes.
    await pill.evaluate((el) => {
      const w = window as Window & { tooltipShownAfter?: number }
      el.addEventListener('pointerenter', () => {
        const enteredAt = performance.now()
        const tick = () => {
          if (document.querySelector('[role="tooltip"]')) w.tooltipShownAfter = performance.now() - enteredAt
          else requestAnimationFrame(tick)
        }
        tick()
      }, { once: true })
    })
    await pill.hover()
    const shownAfter = await (await page.waitForFunction(
      () => (window as Window & { tooltipShownAfter?: number }).tooltipShownAfter,
    )).jsonValue()
    expect(shownAfter).toBeGreaterThanOrEqual(395)
    const tip = page.getByRole('tooltip')
    await expect(tip).toContainText('Next follow-up')
    await expect(tip).toContainText('Never followed up')
    await expect(pill).toHaveAttribute('aria-describedby', (await tip.getAttribute('id'))!)
    await page.mouse.move(0, 0)
    await expect(tip).toHaveCount(0)
  })
})

test('list bulk bar fits 320px; ⋯ More holds Followed up and the markers (mixed)', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Tasks' }],
    tasks: [{ title: 'one', focus: true }, { title: 'two' }],
    layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: TASK_LIST_TAB, kind: 'lens', listDefIdx: 0 }] }] }] }],
  })
  await wsListWidget(page, TASK_LIST_TAB).waitFor({ state: 'visible' })
  await taskRowByTitle(page, 'one').locator('span[title="one"]').click()
  await taskRowByTitle(page, 'two').locator('span[title="two"]').click({ modifiers: ['Shift'] })
  const bar = page.getByTestId('list-bulk-bar')
  await expect(bar).toBeVisible()
  expect((await bar.boundingBox())!.width).toBeLessThanOrEqual(320)

  const more = bar.getByRole('button', { name: 'More' })
  await more.click()
  const menu = page.getByRole('menu', { name: 'More actions' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /^Followed up/ })).toBeFocused()
  const focus = menu.getByRole('menuitemcheckbox', { name: /Focus/ })
  await expect(focus).toHaveAttribute('aria-checked', 'mixed')
  await expect(focus).toContainText('1 of 2')
  await focus.click()
  await expect(menu).toHaveCount(0)
  await more.click()
  await expect(page.getByRole('menuitemcheckbox', { name: /Focus/ })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()
})
