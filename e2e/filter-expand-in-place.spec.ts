import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'

/**
 * A list's filters in Edit list expand in place: a chip row opens its
 * picker under it, its "Or another filter" turns the chip into a group
 * there, a group's chevron opens the group's panel; Esc folds the row back
 * with the focus on it. On the list's filter line the group's panel is a
 * popover under the group.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob'],
  listDefinitions: [{ name: 'Team', predicate: { markers: { urgent: true } } }],
  tasks: [
    { title: 'Ann urgent', people: ['Ann'], urgent: true },
    { title: 'Bob urgent', people: ['Bob'], urgent: true },
    { title: 'Ann calm', people: ['Ann'] },
    { title: 'Nobody calm' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

const titles = (page: Page) => rowTitles(wsListWidget(page, 't1'))

test.use({ viewport: { width: 1600, height: 900 } })

test('Edit list: a chip expands in place; Esc folds it with the focus back on the chip, Edit list stays', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await wsListWidget(page, 't1').getByTestId('list-summary').click()
  const editList = page.getByTestId('edit-list')
  const chip = editList.getByTestId('list-filter-chip')
  await chip.click()
  await expect(chip).toHaveAttribute('aria-expanded', 'true')
  const expansion = editList.getByTestId('list-filter-expansion')
  await expect(expansion).toBeVisible()
  await expect(page.getByTestId('list-filter-picker')).toHaveCount(0)
  // Under its row, inside the Filters block.
  const chipBox = (await chip.boundingBox())!
  const expansionBox = (await expansion.boundingBox())!
  expect(expansionBox.y).toBeGreaterThanOrEqual(chipBox.y + chipBox.height)

  await page.keyboard.press('Escape')
  await expect(expansion).toHaveCount(0)
  await expect(chip).toBeFocused()
  await expect(editList).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editList).toHaveCount(0)
})

test('Edit list: Or another filter makes a group in place; the group’s chevron opens its panel with the focus in it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => titles(page)).toEqual(['Ann urgent', 'Bob urgent'])
  await wsListWidget(page, 't1').getByTestId('list-summary').click()
  const editList = page.getByTestId('edit-list')
  await editList.getByTestId('list-filter-chip').click()
  await editList.getByRole('button', { name: /Or another filter/ }).click()
  const group = editList.getByTestId('or-group')
  await expect(group.getByTestId('list-filter-chip')).toHaveText(/Priority\s*Urgent/)
  // The fields to add, the first one focused.
  const expansion = editList.getByTestId('list-filter-expansion')
  await expect(expansion.getByRole('button', { name: 'Tags' })).toBeFocused()
  await expansion.getByRole('button', { name: 'People' }).click()
  await expansion.getByRole('option', { name: '@Ann' }).click()
  await expect.poll(() => titles(page)).toEqual(['Ann urgent', 'Bob urgent', 'Ann calm'])
  await expect(group.getByTestId('list-filter-chip')).toHaveText([/Priority\s*Urgent/, /People\s*Ann/])

  await group.getByRole('button', { name: 'Group' }).click()
  await expect(expansion.getByRole('button', { name: 'Tags' })).toBeFocused()
  await expansion.getByRole('button', { name: /Remove group/ }).click()
  await expect.poll(() => titles(page)).toEqual(['Ann urgent', 'Bob urgent', 'Ann calm', 'Nobody calm'])
})

test('the filter line: a group’s "or" opens its panel as a popover under the group', async ({ page }) => {
  await seedWorkspace(page, {
    ...SEED,
    listDefinitions: [{
      name: 'Team',
      predicate: {
        orGroups: [{ personIds: null, statusIds: null, tags: null, searchText: '', dates: {}, markers: { urgent: true } }],
      },
    }],
  })
  const widget = wsListWidget(page, 't1')
  // One chip in the group: give it a second alternative from its picker.
  await widget.getByTestId('list-filter-chip').click()
  await page.getByTestId('list-filter-picker').getByRole('button', { name: /Or another filter/ }).click()
  await page.getByTestId('or-group-panel').getByRole('button', { name: 'People' }).click()
  await page.getByTestId('list-filter-picker').getByRole('option', { name: '@Ann' }).click()
  await expect.poll(() => titles(page)).toEqual(['Ann urgent', 'Bob urgent', 'Ann calm'])
  await page.keyboard.press('Escape')

  const group = widget.getByTestId('or-group')
  await group.getByRole('button', { name: 'Group' }).click()
  const panel = page.getByRole('dialog', { name: 'Group' })
  await expect(panel).toBeVisible()
  const groupBox = (await group.boundingBox())!
  const panelBox = (await panel.boundingBox())!
  expect(panelBox.y).toBeGreaterThanOrEqual(groupBox.y + groupBox.height)
  expect(Math.abs(panelBox.x - groupBox.x)).toBeLessThan(2)
  await expect(panel.getByRole('button', { name: 'Tags' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
})
