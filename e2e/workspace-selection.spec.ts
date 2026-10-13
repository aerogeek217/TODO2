import { expect, test } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, wsListWidget, wsTab } from './fixtures/workspace'

/**
 * A list widget's row selection goes away with the widget: after switching
 * to another tab of the cell, Space / Delete act on nothing — never on rows
 * nobody can see.
 */

test.use({ viewport: { width: 1280, height: 800 } })

test('switching tabs drops the hidden list selection', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Tasks' }],
    tasks: [{ title: 'one' }, { title: 'two' }],
    layouts: [{
      name: 'Main',
      columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [
        { id: 'list', kind: 'lens', listDefIdx: 0 },
        { id: 'notes', kind: 'notes' },
      ] }] }],
    }],
  })
  await wsListWidget(page, 'list').waitFor({ state: 'visible' })
  await taskRowByTitle(page, 'one').locator('span[title="one"]').click()
  await expect(page.locator('[data-selected="true"]')).toHaveCount(1)

  await wsTab(page, 'notes').click()
  await expect(wsListWidget(page, 'list')).toHaveCount(0)
  await page.keyboard.press('Delete')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press(' ')

  await wsTab(page, 'list').click()
  await expect(taskRowByTitle(page, 'one').getByRole('checkbox', { name: 'Mark complete' })).toBeVisible()
  await expect(page.locator('[data-selected="true"]')).toHaveCount(0)
})
