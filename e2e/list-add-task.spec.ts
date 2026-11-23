import { expect, test } from '@playwright/test'
import { assignedNames, readStores } from './fixtures/db'
import { box } from './fixtures/geometry'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * UX cleanup 1A · a list's Add task is its last row, inside the scroll: in a
 * short cell it never covers a row (it was a footer under the scroll, read
 * as drawn over the last row), and while a view transition runs the list's
 * groups are clipped to the scroll (their pictures nest in the scroll's).
 * Its click opens Quick Add with the list's defaults already shown as chips.
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

test('Add task opens Quick Add with the list’s person, tag and status as chips; the task gets what they say', async ({ page }) => {
  await seedWorkspace(page, {
    people: ['Ann', 'Bob'],
    tags: ['work', 'home'],
    statuses: ['Waiting'],
    listDefinitions: [{ name: 'Ann’s work', people: ['Ann'], tags: ['work'], statuses: ['Waiting'] }],
    tasks: [{ title: 'Existing', people: ['Ann'], tags: ['work'], status: 'Waiting' }],
    layouts: [{ name: 'Main', table: { areas: ['a'], cells: [{ id: 'a', tabs: [{ id: TAB, kind: 'lens', listDefIdx: 0 }] }] } }],
  })
  const add = wsListWidget(page, TAB).getByRole('button', { name: 'Add task' })
  const dialog = page.getByRole('dialog', { name: 'Quick add task' })
  const chips = dialog.getByRole('group', { name: 'What the task gets' })
  const field = dialog.getByPlaceholder('New task…')

  // On open, before anything is typed: the chips typing `#work @Ann !Waiting` would show.
  await add.click()
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  await expect(chips).toBeVisible()
  for (const label of ['Remove #work', 'Remove @Ann', 'Remove status']) {
    await expect(chips.getByRole('button', { name: label })).toHaveCount(1)
  }
  await expect(chips).toContainText('#work')
  await expect(chips).toContainText('@Ann')
  await expect(chips).toContainText('Waiting')

  // A typed person goes beside the list's; Enter adds the task with all three.
  await field.fill('Call vendor @Bob ')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect.poll(() => assignedNames(page, 'Call vendor')).toEqual(['Ann', 'Bob'])
  expect(await assignedNames(page, 'Call vendor', 'tags')).toEqual(['work'])
  const statusOf = async (title: string) => {
    const data = await readStores(page, ['todos', 'statuses'])
    const todo = data.todos?.find((t) => t.title === title)
    return data.statuses?.find((s) => s.id === todo?.statusId)?.name
  }
  expect(await statusOf('Call vendor')).toBe('Waiting')

  // A chip's × drops that default: the task goes without it.
  await add.click()
  await chips.getByRole('button', { name: 'Remove #work' }).click()
  await expect(chips).not.toContainText('#work')
  await field.fill('Book room')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect.poll(() => assignedNames(page, 'Book room')).toEqual(['Ann'])
  expect(await assignedNames(page, 'Book room', 'tags')).toEqual([])
  expect(await statusOf('Book room')).toBe('Waiting')
})
