import { expect, test } from '@playwright/test'
import { seedWorkspace, wsListWidget, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * A list's filters in Edit list: a chip row opens its picker as a popover
 * under it (over the dialog, never reflowing it); Esc closes the popover and
 * Edit list stays. A filter added from "+ Another filter (AND)" goes last.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob'],
  listDefinitions: [{ name: 'Team', predicate: { markers: [{ values: ['urgent'] }] } }],
  tasks: [
    { title: 'Ann urgent', people: ['Ann'], urgent: true },
    { title: 'Bob urgent', people: ['Bob'], urgent: true },
    { title: 'Ann calm', people: ['Ann'] },
    { title: 'Nobody calm' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

test.use({ viewport: { width: 1600, height: 900 } })

test('Edit list: a chip opens its picker as a popover under it, outside the dialog; Esc closes it, Edit list stays', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await wsListWidget(page, 't1').getByTestId('list-summary').click()
  const editList = page.getByTestId('edit-list')
  const chip = editList.getByTestId('list-filter-chip')
  const dialogBefore = (await editList.boundingBox())!
  await chip.click()
  // The chip's own button (the × is its sibling, cr31 F9).
  await expect(chip.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true')
  const picker = page.getByTestId('list-filter-picker')
  await expect(picker).toBeVisible()
  await expect(editList.getByTestId('list-filter-picker')).toHaveCount(0)
  // Under the chip (kept inside the viewport, so it may start left of the chip), and the dialog kept its size.
  const chipBox = (await chip.boundingBox())!
  const pickerBox = (await picker.boundingBox())!
  expect(pickerBox.y).toBeGreaterThanOrEqual(chipBox.y + chipBox.height)
  expect(pickerBox.x).toBeLessThanOrEqual(chipBox.x + 2)
  expect(pickerBox.x + pickerBox.width).toBeGreaterThanOrEqual(chipBox.x)
  const dialogAfter = (await editList.boundingBox())!
  expect(dialogAfter.height).toBe(dialogBefore.height)
  expect(dialogAfter.width).toBe(dialogBefore.width)

  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(chip.getByRole('button').first()).toHaveAttribute('aria-expanded', 'false')
  await expect(editList).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editList).toHaveCount(0)
})

test('Edit list: a filter added from + Another filter (AND) goes last', async ({ page }) => {
  await seedWorkspace(page, { ...SEED, listDefinitions: [{ name: 'Team', predicate: { personIds: [1, 2] } }] })
  await wsListWidget(page, 't1').getByTestId('list-summary').click()
  const editList = page.getByTestId('edit-list')
  const stack = editList.getByTestId('filter-stack')
  await editList.getByRole('button', { name: 'Another filter (AND)', exact: true }).click()
  await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Priority' }).click()
  await page.getByTestId('list-filter-picker').getByRole('option', { name: 'Focus' }).click()
  // Priority sorts first in the stored order; added, it is the last row.
  const rows = stack.getByTestId('list-filter-chip')
  await expect(rows).toHaveText([/^People/, /^Priority/])
  const peopleBox = (await rows.nth(0).boundingBox())!
  const priorityBox = (await rows.nth(1).boundingBox())!
  expect(priorityBox.y).toBeGreaterThan(peopleBox.y)
})
