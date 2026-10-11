import { expect, test } from '@playwright/test'
import { seedWorkspace, wsCell } from './fixtures/workspace'

/**
 * Widgets must show people / tag chips and person groups whatever route the
 * app was opened on — the assignment maps are loaded by the workspace
 * itself, not by whichever page happened to load first.
 */
const seed = {
  people: ['Alice'],
  tags: ['home'],
  listDefinitions: [{ name: 'By person', grouping: 'people' }],
  tasks: [{ title: 'Water the plants', people: ['Alice'], tags: ['home'] }, { title: 'Nobody’s task' }],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens' as const, listDefIdx: 0 }] }] }] }],
}

async function expectChipsAndGroups(page: import('@playwright/test').Page) {
  const cell = wsCell(page, 'k1')
  const row = cell.locator('[data-todo-id]').filter({ hasText: 'Water the plants' })
  await expect(row).toBeVisible()
  await expect(row.getByText('#home')).toBeVisible()
  // Grouped by person: Alice's task is under Alice, not "Unassigned" (her
  // own group doesn't repeat her avatar on the row).
  await expect(cell.getByTestId('list-group-name')).toHaveText(['Alice', 'Unassigned'])
  await expect(cell.locator('[data-list-group="person-1"]')).toContainText('Water the plants')
}

test('cold load of / renders person and tag chips and person groups', async ({ page }) => {
  await seedWorkspace(page, seed)
  await page.goto('/')
  await page.reload()
  await expect(page.locator('[data-ws-area]')).toBeVisible()
  await expectChipsAndGroups(page)
})

test('opening the app on another route, then the workspace, renders the same chips', async ({ page }) => {
  await seedWorkspace(page, seed)
  await page.goto('/#/settings')
  await page.reload()
  await page.getByRole('button', { name: 'Workspace' }).click()
  await expectChipsAndGroups(page)
})
