import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'

/**
 * A list's filters in Edit list: a chip row opens its picker as a popover
 * under it (over the dialog, never reflowing it), its "Another filter (OR)"
 * turns the chip into a group in its place, a group's chevron opens the
 * group's panel the same way; Esc closes the popover and Edit list stays. A
 * filter added from "+ Another filter (AND)" goes last. On the list's filter
 * line the group's panel is a popover under the group.
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

test('Edit list: a chip opens its picker as a popover under it, outside the dialog; Esc closes it, Edit list stays', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await wsListWidget(page, 't1').getByTestId('list-summary').click()
  const editList = page.getByTestId('edit-list')
  const chip = editList.getByTestId('list-filter-chip')
  const dialogBefore = (await editList.boundingBox())!
  await chip.click()
  await expect(chip).toHaveAttribute('aria-expanded', 'true')
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
  await expect(chip).toHaveAttribute('aria-expanded', 'false')
  await expect(editList).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editList).toHaveCount(0)
})

test('Edit list: Another filter (OR) makes a group in the chip’s place; the group’s chevron opens its panel with the focus in it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => titles(page)).toEqual(['Ann urgent', 'Bob urgent'])
  await wsListWidget(page, 't1').getByTestId('list-summary').click()
  const editList = page.getByTestId('edit-list')
  await editList.getByTestId('list-filter-chip').click()
  await page.getByTestId('list-filter-picker').getByRole('button', { name: /Another filter \(OR\)/ }).click()
  const group = editList.getByTestId('or-group')
  await expect(group.getByTestId('list-filter-chip')).toHaveText(/Priority\s*Urgent/)
  // The fields to add, the first one focused.
  const panel = page.getByTestId('or-group-panel')
  await expect(panel.getByRole('button', { name: 'Tags' })).toBeFocused()
  await panel.getByRole('button', { name: 'People' }).click()
  await page.getByTestId('list-filter-picker').getByRole('option', { name: '@Ann' }).click()
  await expect.poll(() => titles(page)).toEqual(['Ann urgent', 'Bob urgent', 'Ann calm'])
  await expect(group.getByTestId('list-filter-chip')).toHaveText([/Priority\s*Urgent/, /People\s*Ann/])
  await page.keyboard.press('Escape')

  await group.getByRole('button', { name: 'Group' }).click()
  await expect(panel.getByRole('button', { name: 'Tags' })).toBeFocused()
  await panel.getByRole('button', { name: /Remove group/ }).click()
  await expect.poll(() => titles(page)).toEqual(['Ann urgent', 'Bob urgent', 'Ann calm', 'Nobody calm'])
})

test('Edit list: a filter added from + Another filter (AND) goes last, below the group', async ({ page }) => {
  await seedWorkspace(page, {
    ...SEED,
    listDefinitions: [{
      name: 'Team',
      predicate: {
        statusIds: null,
        orGroups: [{ personIds: [1, 2], statusIds: null, tags: null, searchText: '', dates: {}, markers: null }],
      },
    }],
  })
  await wsListWidget(page, 't1').getByTestId('list-summary').click()
  const editList = page.getByTestId('edit-list')
  const stack = editList.getByTestId('filter-stack')
  await expect(stack.getByTestId('or-group')).toBeVisible()
  await editList.getByRole('button', { name: 'Another filter (AND)', exact: true }).click()
  await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Priority' }).click()
  await page.getByTestId('list-filter-picker').getByRole('radio', { name: 'Yes' }).first().click()
  // Priority sorts first in the stored order; added, it is the last row.
  const rows = stack.locator('[data-testid="list-filter-chip"]:not([data-testid="or-group"] *), [data-testid="or-group"]')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toHaveAttribute('data-testid', 'or-group')
  await expect(rows.nth(1)).toHaveText(/^Priority/)
  const groupBox = (await rows.nth(0).boundingBox())!
  const priorityBox = (await rows.nth(1).boundingBox())!
  expect(priorityBox.y).toBeGreaterThan(groupBox.y)
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
  await page.getByTestId('list-filter-picker').getByRole('button', { name: /Another filter \(OR\)/ }).click()
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

const NO_CLAUSE = { personIds: null, statusIds: null, tags: null, searchText: '', dates: {}, markers: null }

for (const where of ['Edit list', 'the filter line'] as const) {
  test(`${where}: a group's text typed over keeps the picker on that group, the focus in it; the other group untouched`, async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      listDefinitions: [{
        name: 'Team',
        predicate: { orGroups: [{ ...NO_CLAUSE, searchText: 'urgent' }, { ...NO_CLAUSE, markers: { urgent: true } }] },
      }],
    })
    await expect.poll(() => titles(page)).toEqual(['Ann urgent', 'Bob urgent'])
    const widget = wsListWidget(page, 't1')
    let block = widget
    if (where === 'Edit list') {
      await widget.getByTestId('list-summary').click()
      block = page.getByTestId('edit-list')
    }
    await block.getByTestId('list-filter-chip').filter({ hasText: 'Text' }).click()
    const input = page.getByRole('textbox', { name: 'Text contains' })
    await expect(input).toBeFocused()
    // Emptied, the group goes from the list; the picker stays on it.
    await page.keyboard.press('End')
    for (let i = 0; i < 'urgent'.length; i++) await page.keyboard.press('Backspace')
    await expect(block.getByTestId('or-group')).toHaveCount(1)
    await expect(input).toBeFocused()
    await page.keyboard.type('Ann')
    await expect.poll(() => titles(page)).toEqual(['Ann urgent'])
    await page.keyboard.press('Enter')
    await expect(block.getByTestId('or-group')).toHaveText([/Text\s*“Ann”/, /Priority\s*Urgent/])
  })
}
