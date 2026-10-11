import { expect, test } from '@playwright/test'
import { seedTaskList } from './fixtures/workspace'

/**
 * A list widget's prompt (`runtimeFilter`) × its grouping, end-to-end:
 * a person pick shows only tasks directly assigned to the picked person, and
 * with grouping by people only the picked person's section emits — a
 * co-assignee outside the pick gets no section.
 *
 * JSDOM is unauthoritative: the picker's portaled panel rides
 * `usePopoverAnchor` (real-DOM `getBoundingClientRect`), and the pick flows
 * through `list-widget-store` → `useBuiltList` → `buildDashboardLists`.
 */

test.describe('Runtime filter × grouping (list widget)', () => {
  test('runtime person pick + group by people: only the picked person section emits with that person\'s tasks', async ({ page }) => {
    // T1 = {Alice, Charlie} → emits under Alice when Alice is picked.
    // T2 = {Bob, Charlie}   → emits under Bob when Bob is picked.
    // T3 = {Charlie}        → never appears (Charlie is never picked).
    // T4 = nobody           → never appears under a person pick.
    const widget = await seedTaskList(page, {
      people: ['Alice', 'Bob', 'Charlie'],
      tasks: [
        { title: 'T1 Alice and Charlie', people: ['Alice', 'Charlie'] },
        { title: 'T2 Bob and Charlie', people: ['Bob', 'Charlie'] },
        { title: 'T3 Charlie only', people: ['Charlie'] },
        { title: 'T4 Unassigned' },
      ],
      list: { name: 'Runtime person grouping', grouping: 'people', runtimeFilter: { field: 'person' } },
    })

    // `exact: true` keeps the match on the picker option, not a row's
    // aria-label that happens to contain the name.
    const personInput = widget.getByLabel('Filter tasks by person')
    await expect(personInput).toBeVisible()
    await personInput.click()
    await page.getByRole('button', { name: 'Alice', exact: true }).click()
    await expect(widget.getByRole('button', { name: 'Remove Alice' })).toBeVisible()

    const row = (title: string) => widget.locator('[data-todo-id]').filter({ hasText: title })
    const groups = widget.getByTestId('list-group-name')

    await expect(row('T1 Alice and Charlie'), 'T1 emits under Alice (direct)').toHaveCount(1)
    await expect(groups, 'only the Alice section — no Charlie section for the co-assignee').toHaveText(['Alice'])
    await expect(row('T2 Bob and Charlie'), 'T2 absent (no Alice on it)').toHaveCount(0)
    await expect(row('T3 Charlie only'), 'T3 absent (no Alice on it)').toHaveCount(0)
    await expect(row('T4 Unassigned'), 'unassigned task absent under a person pick').toHaveCount(0)

    // Flip the pick: clear Alice, pick Bob. Sections mirror the flip.
    await widget.getByRole('button', { name: 'Remove Alice' }).click()
    await expect(widget.getByRole('button', { name: 'Remove Alice' })).toHaveCount(0)
    await personInput.click()
    await page.getByRole('button', { name: 'Bob', exact: true }).click()
    await expect(widget.getByRole('button', { name: 'Remove Bob' })).toBeVisible()

    await expect(row('T2 Bob and Charlie'), 'T2 emits under Bob (direct)').toHaveCount(1)
    await expect(groups, 'only the Bob section after the flip').toHaveText(['Bob'])
    await expect(row('T1 Alice and Charlie'), 'T1 absent (no Bob on it)').toHaveCount(0)
    await expect(row('T3 Charlie only'), 'T3 absent (no Bob on it)').toHaveCount(0)
    await expect(row('T4 Unassigned')).toHaveCount(0)
  })
})
