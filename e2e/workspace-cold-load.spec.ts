import { expect, test } from '@playwright/test'
import { gotoSettingsDeepLink, openSettings, seedWorkspace, wsCell } from './fixtures/workspace'

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

test('a cold load of the Settings deep link, then closing it, renders the same chips', async ({ page }) => {
  await seedWorkspace(page, seed)
  await page.goto('about:blank')
  await page.goto('/#/settings')
  // Desktop: the deep link opens the workspace with the Settings modal open.
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await expect(page).toHaveURL(/#\/$/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
  await expectChipsAndGroups(page)
})

test('Settings counts people, statuses and tags on a cold load to an empty layout', async ({ page }) => {
  await seedWorkspace(page, {
    people: ['Alice', 'Ben'],
    tags: ['home', 'work', 'q4'],
    statuses: ['Blocked'],
    layouts: [{ name: 'Empty', columns: [] }],
  })
  await expect(page.getByText('This layout is empty')).toBeVisible()
  const counts = async (dialog: import('@playwright/test').Locator) => {
    await expect(dialog.getByText('2 people', { exact: true })).toBeVisible()
    await expect(dialog.getByText('1 status', { exact: true })).toBeVisible()
    await expect(dialog.getByText('3 tags', { exact: true })).toBeVisible()
  }
  await counts(await openSettings(page, 'People, statuses & tags'))

  // Straight into Settings from a cold start, too.
  await page.goto('about:blank')
  await gotoSettingsDeepLink(page)
  await counts(await openSettings(page, 'People, statuses & tags'))
})
