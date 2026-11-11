import { expect, test, type Page } from '@playwright/test'
import { expectOpenLayout, readListDefinitions, seedWorkspace, wsListWidget, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * No way out of an Edit list holding changes skips its Save / Discard /
 * Keep editing question (`stores/editor-leave`): Settings by its shortcut,
 * a layout from the palette, a route change (an in-app one: a hash typed in
 * can't be held — the editor then closes and says its changes weren't saved). Keep editing leaves
 * everything as it was; Save and Discard then carry on with what the user
 * was doing.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Team' }],
  tasks: [{ title: 'Bravo' }, { title: 'Alpha' }],
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] },
    { name: 'Second', columns: [{ id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 'n2', kind: 'notes' }] })] }] },
  ],
}

const editList = (page: Page) => page.getByTestId('edit-list')
const question = (page: Page) => page.getByRole('dialog', { name: 'Save changes to list “Team”?' })
const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true })
const teamSort = async (page: Page) => (await readListDefinitions(page)).find((d) => d.name === 'Team')?.sort

/** Edit list open on Team with Sort by › Name picked (unsaved), the focus back on the page. */
async function dirtyEditList(page: Page): Promise<void> {
  await wsListWidget(page, 't1').getByTestId('list-summary').click()
  await expect(editList(page)).toBeVisible()
  await editList(page).getByRole('button', { name: /^Sort by/ }).click()
  await page.getByRole('menuitemradio', { name: /^Name/ }).click()
  await expect(wsListWidget(page, 't1').getByTestId('list-summary')).toHaveText('Name')
  // A key from the page, not the form (whose keys aren't the app's shortcuts).
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
}

async function answer(page: Page, label: 'Save' | 'Discard' | 'Keep editing'): Promise<void> {
  await question(page).getByRole('button', { name: label, exact: true }).click()
  await expect(question(page)).toHaveCount(0)
}

test.use({ viewport: { width: 1440, height: 900 } })

test('Settings by its shortcut asks; Keep editing stays; Discard drops the edit and opens Settings', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await dirtyEditList(page)
  await page.keyboard.press('g')
  await page.keyboard.press('s')
  await expect(question(page)).toBeVisible()
  await expect(settings(page)).toHaveCount(0)
  await answer(page, 'Keep editing')
  await expect(editList(page)).toBeVisible()
  await expect(settings(page)).toHaveCount(0)
  await expect(wsListWidget(page, 't1').getByTestId('list-summary')).toHaveText('Name')

  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
  await page.keyboard.press('g')
  await page.keyboard.press('s')
  await answer(page, 'Discard')
  await expect(settings(page)).toBeVisible()
  await expect(editList(page)).toHaveCount(0)
  expect(await teamSort(page)).toBe('manual')
})

test('Go to Layout from the palette asks; Save writes the list, then the layout opens', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await dirtyEditList(page)
  await page.keyboard.press('Control+k')
  const field = page.getByPlaceholder(/Find tasks, commands/)
  await expect(field).toBeFocused()
  await field.pressSequentially('second')
  await expect(page.getByRole('listbox').getByRole('option').first()).toHaveText('Go to Layout › Second')
  await page.keyboard.press('Enter')
  await expect(question(page)).toBeVisible()
  await expectOpenLayout(page, 'Main')
  await answer(page, 'Save')
  await expectOpenLayout(page, 'Second')
  await expect.poll(() => teamSort(page)).toBe('name')
})

test('a route change (the phone’s Settings tab) asks; Keep editing stays; Discard goes on to Settings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedWorkspace(page, SEED)
  await page.getByTestId('list-filter-row').getByTestId(/^list-filter-(expression|every)$/).click()
  await expect(editList(page)).toBeVisible()
  await editList(page).getByRole('button', { name: 'Sort by: Manual' }).click()
  await editList(page).getByRole('radio', { name: /^Name/ }).click()
  await expect(editList(page).getByRole('button', { name: 'Sort by: Name' })).toBeVisible()
  // The tab bar's Settings, as a press that reaches it (the sheet's scrim covers it for a pointer).
  const goToSettings = () => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings' }).evaluate((b: HTMLElement) => b.click())
  await goToSettings()
  await expect(question(page)).toBeVisible()
  await answer(page, 'Keep editing')
  await expect(page).toHaveURL(/#\/$/)
  await expect(editList(page)).toBeVisible()

  await goToSettings()
  await answer(page, 'Discard')
  await expect(page).toHaveURL(/#\/settings$/)
  expect(await teamSort(page)).toBe('manual')
})
