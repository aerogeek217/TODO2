import { expect, test } from '@playwright/test'
import { seedCanvasWithProjects, taskRowByTitle } from './fixtures/seed'

/**
 * triage-2026-04-27-batch2 P1 — Task row UX fixes (items 7, 9, 10).
 *
 * Ghost rows on the canvas (filtered-out tasks that stay rendered for
 * spatial context) used to:
 *   - Suppress right-click entirely (item 7)
 *   - Lose their dim styling (item 9 — regressed)
 *   - End up with a different / missing menu vs. non-ghost rows (item 10)
 *
 * The fix routes the same right-click menu through both surfaces and dims
 * the row via a `[data-ghosted]` attribute selector. JSDOM covers the
 * handler + DOM attribute, but the dim is computed-style — Chromium is
 * authoritative for `getComputedStyle(row).opacity`.
 */

test.describe('canvas task-row context menu — ghost parity', () => {
  test('ghosted row carries data-ghosted, dims, and opens the same right-click menu', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'Garden', tasks: ['weed beds', 'water plants'] }],
    })

    const ghostable = taskRowByTitle(page, 'weed beds')
    const stable = taskRowByTitle(page, 'water plants')
    await expect(ghostable).toBeVisible()
    await expect(stable).toBeVisible()

    // Apply a search filter that matches `water plants` only, so `weed beds`
    // becomes a ghost row on the canvas via CanvasPage's `filterGhostIds`.
    const search = page.getByPlaceholder('Search...')
    await search.fill('water')

    // CanvasPage recomputes ghost ids on the next render. Anchor the wait on
    // the attribute itself (the row stays mounted; only its dim treatment
    // changes).
    const ghostedRow = ghostable.locator('[data-todo-id]').first()
    await expect(ghostedRow).toHaveAttribute('data-ghosted', '')
    await expect(stable.locator('[data-todo-id]').first()).not.toHaveAttribute('data-ghosted', '')

    // Visual dim — read computed opacity to prove the CSS rule fires.
    const opacity = await ghostedRow.evaluate((el) => getComputedStyle(el).opacity)
    expect(parseFloat(opacity)).toBeLessThan(0.95)

    // Blur the search input without clearing it, so the mini-list dropdown
    // unmounts and stops covering the row but the filter — and hence the
    // ghost state — is preserved. (Escape would clear the searchText after a
    // 150 ms debounce.)
    await search.evaluate((el: HTMLInputElement) => el.blur())
    await expect(ghostedRow).toHaveAttribute('data-ghosted', '')

    // Right-click parity — ghosted task should open the same menu items as
    // a non-ghost task. Use the inner `[data-todo-id]` element so the
    // contextmenu coordinates land on the row, not the SortableTaskList wrap.
    const box = await ghostedRow.boundingBox()
    if (!box) throw new Error('ghosted row has no bounding box')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })

    await expect(page.getByRole('menuitem', { name: 'Mark complete' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Add to Taskboard|Remove from Taskboard/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Move to project…' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
  })
})
