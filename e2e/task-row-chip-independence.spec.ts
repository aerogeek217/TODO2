import { expect, test } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'

/**
 * Locks in chip-independence on `TaskRow`.
 *
 * The reported bug ("person chip not showing up on task row until status
 * is set") was a TOCTOU race in `assignment-helpers.loadAssignments`,
 * not a render-time CSS adjacency rule. The fix (re-read the map after
 * the DB await, prefer optimistic writes over stale fetched data) lives
 * in `src/stores/assignment-helpers.ts`. This spec covers two angles:
 *
 * 1. **QuickAdd `@person` chip survives the load race** — the actual
 *    regression. Creating a task via QuickAdd with `@person` triggers
 *    `applyNlpMetadata` → `assignPerson` running in parallel with the
 *    workspace's assignment load (which fires on every `todos` change).
 *    Pre-fix, the optimistic map entry was clobbered. Post-fix, the avatar
 *    must be visible immediately on the new row, with no reload.
 *
 * 2. **Static render independence** — the avatar chip renders whenever
 *    a person is assigned, regardless of whether a status is set; the
 *    status chip likewise renders independent of assignments. Cheap
 *    regression guard for any future render gating that creeps back in.
 */

test.describe('TaskRow chip independence', () => {
  test('QuickAdd @person chip is visible without setting status (race regression)', async ({ page }) => {
    await seedTaskList(page, { people: [{ name: 'Alice', initials: 'A' }] })

    // Open QuickAdd via the top bar's New task button and submit a task with
    // @Alice. The race window is the few ms between `useTodoStore.add`
    // resolving and `applyNlpMetadata` finishing — the assignment load fires
    // in that window on every `todos` change, and pre-fix its post-fetch
    // `setMap` clobbered the optimistic assign.
    await page.getByRole('button', { name: 'New task' }).click()
    const input = page.locator('input[placeholder="New task…"]')
    await input.waitFor({ state: 'visible' })
    await input.fill('Race regression @Alice')
    // Trailing space closes the autocomplete popup that intercepts Enter
    // for token-completion before the submit handler can see it.
    await input.press('Space')
    await input.press('Enter')

    const row = taskRowByTitle(page, 'Race regression')
    await row.waitFor({ state: 'visible' })

    // Avatar must be visible right after submit — no reload, no status set.
    const avatar = row.locator('[data-person-avatar]').first()
    await expect(avatar, 'Alice avatar should render immediately after QuickAdd submit').toBeVisible()
    await expect(avatar).toHaveText(/A/)

    // The people cell is filled, not the empty one.
    await expect(
      row.getByRole('button', { name: 'Assign people' }),
      'the empty people cell should not render when a person is assigned',
    ).toHaveCount(0)
  })

  test('avatar renders independently of status (no-status row)', async ({ page }) => {
    await seedTaskList(page, {
      people: [{ name: 'Alice', initials: 'A' }],
      tasks: [{ title: 'person no status', people: ['Alice'] }],
    })

    const row = taskRowByTitle(page, 'person no status')
    await row.waitFor({ state: 'visible' })
    const avatar = row.locator('[data-person-avatar]').first()
    await expect(avatar).toBeVisible()
    await expect(avatar).toHaveText(/A/)
    // The status cell renders even when status is unset (its empty dot is
    // hover-revealed via CSS).
    await expect(row.getByRole('button', { name: 'Set status' })).toHaveCount(1)
  })

  test('status renders independently of assignments (no-person row)', async ({ page }) => {
    await seedTaskList(page, {
      statuses: ['Working'],
      tasks: [{ title: 'status no person', status: 'Working' }],
    })

    const row = taskRowByTitle(page, 'status no person')
    await row.waitFor({ state: 'visible' })
    const status = row.locator('[data-row-cell="status"]')
    await expect(status, 'status indicator should render even without a person').toBeVisible()
    await expect(status).toHaveAttribute('aria-label', /Working/)
    // No avatars — the people cell is the empty one.
    await expect(row.locator('[data-person-avatar]')).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'Assign people' })).toHaveCount(1)
  })
})
