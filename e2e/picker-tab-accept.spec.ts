import { expect, test } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'
import { assignedNames } from './fixtures/db'

/**
 * The people / tag picker (`ChipSelector`) behind a row's cells and the task
 * editor's "+ Add": with a query typed, Tab takes the highlighted row, as the
 * `@` / `#` popup does — the item is assigned, the query clears and the
 * focus stays in the search. Focus handoffs need a real browser.
 */

test.beforeEach(async ({ page }) => {
  await seedTaskList(page, {
    people: ['Alice', 'Bob', 'Carol'],
    tags: ['home', 'work', 'errands'],
    tasks: [{ title: 'Fix the sink' }],
  })
})

test('a desktop row’s tag cell: part of a tag name, Tab, the task has the tag', async ({ page }) => {
  await taskRowByTitle(page, 'Fix the sink').getByRole('button', { name: 'Add tag' }).click()
  const search = page.locator('[data-anchored-picker]').getByRole('combobox')
  await expect(search).toBeFocused()
  await search.pressSequentially('err')
  await search.press('Tab')
  await expect.poll(() => assignedNames(page, 'Fix the sink', 'tags')).toEqual(['errands'])
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
})

test('the task editor’s People: part of a name, Tab, the task has the person', async ({ page }) => {
  await taskRowByTitle(page, 'Fix the sink').locator('span[data-task-title="Fix the sink"]').dblclick()
  const peopleLabel = page.getByText('People', { exact: true }).and(page.locator(':not([data-filter-row] *)'))
  await peopleLabel.locator('..').getByRole('button', { name: '+ Add' }).click()
  const search = page.getByRole('combobox').and(page.locator(':focus'))
  await expect(search).toBeFocused()
  await search.pressSequentially('bo')
  await search.press('Tab')
  await expect.poll(() => assignedNames(page, 'Fix the sink')).toEqual(['Bob'])
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
})
