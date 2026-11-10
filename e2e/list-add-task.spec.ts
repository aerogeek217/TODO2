import { expect, test } from '@playwright/test'
import { box } from './fixtures/geometry'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * UX cleanup 1A · a list's Add task is its last row, inside the scroll: in a
 * short cell it never covers a row (it was a footer under the scroll, read
 * as drawn over the last row), and while a view transition runs the list's
 * groups are clipped to the scroll (their pictures nest in the scroll's).
 */

const TAB = 'L'

function seed(grouping: string): WorkspaceSeed {
  return {
    people: ['Ann', 'Bob'],
    listDefinitions: [{ name: 'Ann’s', people: ['Ann'], grouping }],
    tasks: Array.from({ length: 14 }, (_, i) => ({ title: `Task ${i + 1}`, people: i % 2 ? ['Ann', 'Bob'] : ['Ann'] })),
    layouts: [{
      name: 'Main',
      table: {
        areas: ['a', 'b', 'b'],
        cells: [
          { id: 'a', tabs: [{ id: TAB, kind: 'lens', listDefIdx: 0 }] },
          { id: 'b', tabs: [{ id: 'n', kind: 'notes' }] },
        ],
      },
    }],
  }
}

test('Add task is the list’s last row: out of view under a long list, under the last row once scrolled there', async ({ page }) => {
  await seedWorkspace(page, seed('none'))
  const widget = wsListWidget(page, TAB)
  const add = widget.getByRole('button', { name: 'Add task' })
  const scroll = widget.locator('[data-task-row-grid]').locator('..')
  await expect(add).toHaveCount(1)
  // Inside the scroll, after the rows.
  expect(await add.evaluate((el) => el.parentElement === el.parentElement?.parentElement?.querySelector('[data-task-row-grid]')?.parentElement)).toBe(true)
  await expect(add).not.toBeInViewport()
  const rows = widget.locator('[data-row-key]')
  await expect(rows).toHaveCount(14)
  // No row is covered: every row in view is inside the scroll's box, and so is Add task once scrolled to.
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await expect(add).toBeInViewport()
  const last = await box(rows.last())
  const button = await box(add)
  const port = await box(scroll)
  expect(button.y).toBeGreaterThanOrEqual(last.y + last.height - 0.5)
  expect(button.y + button.height).toBeLessThanOrEqual(port.y + port.height + 0.5)
  // The click opens Quick Add seeded with the list's person.
  await add.click()
  await expect(page.getByRole('dialog', { name: 'Quick add task' })).toBeVisible()
})

test('a grouped list’s groups nest their view-transition pictures in the scroll’s, which clips them', async ({ page }) => {
  await seedWorkspace(page, seed('people'))
  const widget = wsListWidget(page, TAB)
  await expect(widget.locator('[data-list-group]').first()).toBeVisible()
  const styles = await widget.evaluate((el) => {
    const scroll = el.querySelector('[data-task-row-grid]')!.parentElement!
    const group = el.querySelector('[data-list-group]')!
    const cs = (e: Element) => getComputedStyle(e) as CSSStyleDeclaration & Record<string, string>
    return {
      scrollName: cs(scroll).viewTransitionName,
      scrollGroup: cs(scroll).getPropertyValue('view-transition-group'),
      scrollClass: cs(scroll).getPropertyValue('view-transition-class'),
      groupName: cs(group).viewTransitionName,
      groupGroup: cs(group).getPropertyValue('view-transition-group'),
    }
  })
  expect(styles).toEqual({
    scrollName: `ws-list-${TAB}`,
    scrollGroup: 'nearest',
    scrollClass: 'ws-list-scroll',
    groupName: expect.stringMatching(/^ws-group-L-/),
    groupGroup: 'nearest',
  })
  // A collapse runs through a view transition and lands: the group folds, Add task follows it.
  const first = widget.locator('[data-list-group]').first()
  await first.getByRole('button', { expanded: true }).first().click()
  await expect(first.locator('[data-row-key]')).toHaveCount(0)
})
