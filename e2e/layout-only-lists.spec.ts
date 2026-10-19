import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSettings, readListDefinitions, seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * Layout-only lists in a real browser: the list picker's This layout only
 * makes a list only that layout shows — not in Settings › Lists, not in
 * another layout's Change list, in its own layout's (marked This layout);
 * Save as gives the new layout a copy that edits on its own; Delete layout
 * takes its lists with it (the confirm says so); a closed tab's list goes
 * when the layout is saved, Discard keeps it; the tab menu's Save to my
 * lists makes it a saved list.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Shared' }, { name: 'Mine', layoutIdx: 0 }],
  tasks: [{ title: 'Call the plumber' }, { title: 'Book flights' }],
  layouts: [
    {
      name: 'Main',
      columns: [
        { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'sharedTab', kind: 'lens', listDefIdx: 0 }, { id: 'mineTab', kind: 'lens', listDefIdx: 1 }] }] },
        { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'notesTab', kind: 'notes' }] }] },
      ],
    },
    { name: 'Second', columns: [{ id: 'colX', cells: [{ id: 'x1', tabs: [{ id: 'otherTab', kind: 'lens', listDefIdx: 0 }] }] }] },
  ],
}

type StoredList = { id: number; name: string; owner?: { layoutId?: number; eisenhower?: true }; membership: { predicate: { searchText: string } } }
const lists = async (page: Page) => (await readListDefinitions(page)) as unknown as StoredList[]
const layouts = async (page: Page) => readStore<{ id: number; name: string }>(page, 'layouts')
const layoutId = async (page: Page, name: string) => (await layouts(page)).find((l) => l.name === name)!.id

async function layoutMenu(page: Page, item: string): Promise<void> {
  await page.getByTestId('layout-picker').click()
  await page.getByRole('menuitem', { name: item }).click()
}

async function switchLayout(page: Page, name: string): Promise<void> {
  await page.getByTestId('layout-picker').click()
  await page.getByRole('menuitemradio', { name }).click()
  await expect(page.getByTestId('layout-picker')).toHaveAccessibleName(`Layout: ${name}`)
}

/** The tab's Change list › submenu's choices. */
async function changeListChoices(page: Page, tabId: string): Promise<string[]> {
  await wsTab(page, tabId).click({ button: 'right' })
  const row = page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitem', { name: /Change list/ })
  await row.focus()
  await page.keyboard.press('ArrowRight')
  const sub = page.getByRole('menu', { name: 'Change list' })
  await expect(sub).toBeVisible()
  const names = await sub.getByRole('menuitem').evaluateAll((els) => els.map((el) => el.getAttribute('data-menu-label') ?? ''))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  return names
}

/** Settings › Lists lists (or doesn't list) each of `names`. */
async function expectInSettingsLists(page: Page, names: Record<string, boolean>): Promise<void> {
  const settings = await openSettings(page, 'People, statuses & tags')
  await settings.getByRole('button', { name: 'Manage lists…' }).click()
  const manager = page.getByRole('dialog', { name: 'Lists', exact: true })
  await expect(manager).toBeVisible()
  for (const [name, listed] of Object.entries(names)) {
    await expect(manager.getByText(name, { exact: true })).toHaveCount(listed ? 1 : 0)
  }
  await page.keyboard.press('Escape')
  await expect(manager).toHaveCount(0)
  await settings.getByRole('button', { name: 'Close settings' }).click()
}

const filterLine = (scope: Locator) => scope.getByTestId('list-filter-row')

test.use({ viewport: { width: 1600, height: 900 } })

test('This layout only: the new list only its layout offers; not in Settings › Lists', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await wsCell(page, 'b1').getByRole('button', { name: 'Add widget as tab' }).click()
  await page.getByRole('menu', { name: 'Add widget' }).getByRole('menuitem', { name: 'List' }).click()
  // Saved list first; the layout's own list is offered, marked.
  await expect(page.getByRole('radio', { name: 'Saved list' })).toBeChecked()
  await expect(page.getByRole('button', { name: /^Mine\s*This layout/ })).toBeVisible()
  await page.getByRole('radio', { name: 'This layout only' }).check()
  await page.getByRole('button', { name: /Create new list/ }).click()
  const editor = page.getByRole('dialog', { name: 'Edit list New list' })
  await expect(editor).toBeVisible()
  await editor.getByRole('textbox', { name: 'Name' }).fill('Errands')
  await page.getByRole('dialog', { name: 'Edit list Errands' }).getByRole('button', { name: 'Save list' }).click()
  await expect.poll(async () => (await lists(page)).find((d) => d.name === 'Errands')?.owner).toEqual({ layoutId: await layoutId(page, 'Main') })
  // The tab is a layout edit: save the layout.
  await page.getByTestId('layout-save').click()
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')

  await expectInSettingsLists(page, { Shared: true, Errands: false, Mine: false })
  expect(await changeListChoices(page, 'sharedTab')).toEqual(['Shared', 'Mine', 'Errands'])
  await switchLayout(page, 'Second')
  expect(await changeListChoices(page, 'otherTab')).toEqual(['Shared'])
})

test('Save as: the new layout shows a copy of its own list that edits on its own', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const mine = (await lists(page)).find((d) => d.name === 'Mine')!
  await layoutMenu(page, 'Save as new layout…')
  const dialog = page.getByRole('dialog', { name: 'Save as new layout' })
  await dialog.getByLabel('Name').fill('Copy')
  await dialog.getByRole('button', { name: 'Save layout' }).click()
  await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Copy')
  const copyId = await layoutId(page, 'Copy')
  await expect.poll(async () => (await lists(page)).filter((d) => d.name === 'Mine').map((d) => d.owner?.layoutId).sort())
    .toEqual([mine.owner!.layoutId, copyId].sort())
  const copy = (await lists(page)).find((d) => d.name === 'Mine' && d.owner?.layoutId === copyId)!
  expect(copy.id).not.toBe(mine.id)
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')

  // Edit the copy's filter from its line: Text contains "plumber"; Save.
  await wsTab(page, 'mineTab').click()
  const widget = wsCell(page, 'a1')
  await filterLine(widget).getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: /Text contains/ }).click()
  await page.keyboard.type('plumber')
  await page.keyboard.press('Enter')
  await expect(widget.locator('[data-row-key]').filter({ hasText: 'Book flights' })).toHaveCount(0)
  await filterLine(widget).getByTestId('save-list').click()
  await expect.poll(async () => (await lists(page)).find((d) => d.id === copy.id)?.membership.predicate.searchText).toBe('plumber')
  expect((await lists(page)).find((d) => d.id === mine.id)?.membership.predicate.searchText).toBe('')

  // The original layout still shows the original, unfiltered.
  await switchLayout(page, 'Main')
  await wsTab(page, 'mineTab').click()
  await expect(wsCell(page, 'a1').locator('[data-row-key]').filter({ hasText: 'Book flights' })).toBeVisible()
})

test('Delete layout takes its own lists with it; the confirm says so', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const mine = (await lists(page)).find((d) => d.name === 'Mine')!
  await layoutMenu(page, 'Delete layout…')
  const confirm = page.getByRole('dialog', { name: 'Delete layout “Main”?' })
  await expect(confirm).toContainText('The layout and its layout-only list are removed. This can’t be undone.')
  await confirm.getByRole('button', { name: 'Delete layout' }).click()
  await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Second')
  await expect.poll(async () => (await lists(page)).some((d) => d.id === mine.id)).toBe(false)
  // A saved list stays.
  expect((await lists(page)).some((d) => d.name === 'Shared')).toBe(true)
})

test('a closed tab’s list goes when the layout is saved; Discard keeps it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const mine = (await lists(page)).find((d) => d.name === 'Mine')!
  await wsTab(page, 'mineTab').hover()
  await wsTab(page, 'mineTab').getByRole('button', { name: 'Close Mine' }).click()
  await layoutMenu(page, 'Discard changes')
  await expect(wsTab(page, 'mineTab')).toBeVisible()
  expect((await lists(page)).some((d) => d.id === mine.id)).toBe(true)

  await wsTab(page, 'mineTab').hover()
  await wsTab(page, 'mineTab').getByRole('button', { name: 'Close Mine' }).click()
  await page.getByTestId('layout-save').click()
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
  await expect.poll(async () => (await lists(page)).some((d) => d.id === mine.id)).toBe(false)
})

test('Save to my lists: listed in Settings › Lists and every layout’s Change list; Undo puts it back', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const mine = (await lists(page)).find((d) => d.name === 'Mine')!
  await wsTab(page, 'mineTab').click({ button: 'right' })
  await page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitem', { name: 'Save to my lists' }).click()
  await expect.poll(async () => (await lists(page)).find((d) => d.id === mine.id)?.owner).toBeUndefined()
  const snackbar = page.locator('[data-keeps-selection]').filter({ hasText: 'Undo' })
  await expect(snackbar).toContainText('Saved “Mine” to my lists')
  // A saved list now: no Save to my lists.
  await wsTab(page, 'mineTab').click({ button: 'right' })
  await expect(page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitem', { name: 'Save to my lists' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expectInSettingsLists(page, { Shared: true, Mine: true })
  await switchLayout(page, 'Second')
  expect(await changeListChoices(page, 'otherTab')).toEqual(['Shared', 'Mine'])
})
