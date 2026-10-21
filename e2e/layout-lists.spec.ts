import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectOpenLayout, openLayoutAction, openSettings, readListDefinitions, seedWorkspace, switchLayout as openLayout, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * Every list belongs to one layout, in a real browser: the list picker's
 * Create new list… makes a list of the open layout — offered by its Change
 * list and its dashboards' Add a list ›, not by another layout's; Settings
 * has no Lists; Save as gives the new layout copies that edit on their own;
 * Delete layout takes its lists with it (the confirm says so); a closed
 * tab's list goes when the layout is saved, Discard keeps it.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Shared', layoutIdx: 0 }, { name: 'Mine', layoutIdx: 0 }, { name: 'Theirs', layoutIdx: 1 }],
  tasks: [{ title: 'Call the plumber' }, { title: 'Book flights' }],
  layouts: [
    {
      name: 'Main',
      columns: [
        { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'sharedTab', kind: 'lens', listDefIdx: 0 }, { id: 'mineTab', kind: 'lens', listDefIdx: 1 }] }] },
        { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'notesTab', kind: 'notes' }, { id: 'dashTab', kind: 'dashboard' }] }] },
      ],
    },
    {
      name: 'Second',
      columns: [{ id: 'colX', cells: [{ id: 'x1', tabs: [{ id: 'otherTab', kind: 'lens', listDefIdx: 2 }, { id: 'otherDash', kind: 'dashboard' }] }] }],
    },
  ],
}

type StoredList = { id: number; name: string; owner?: { layoutId?: number; eisenhower?: true }; membership: { predicate: { searchText: string } } }
const lists = async (page: Page) => (await readListDefinitions(page)) as unknown as StoredList[]
const layouts = async (page: Page) => readStore<{ id: number; name: string }>(page, 'layouts')
const layoutId = async (page: Page, name: string) => (await layouts(page)).find((l) => l.name === name)!.id

const layoutMenu = openLayoutAction

async function switchLayout(page: Page, name: string): Promise<void> {
  await openLayout(page, name)
  await expectOpenLayout(page, name)
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

/** A dashboard tab's Customize › Add a list › choices. */
async function addListTileChoices(page: Page, tabId: string): Promise<string[]> {
  await wsTab(page, tabId).click({ button: 'right' })
  await page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitem', { name: 'Customize dashboard…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Customize dashboard' })
  await dialog.getByRole('button', { name: 'Add a list' }).click()
  const menu = page.getByRole('menu', { name: 'Lists' })
  await expect(menu).toBeVisible()
  const names = await menu.getByRole('menuitem').evaluateAll((els) => els.map((el) => el.getAttribute('data-menu-label') ?? ''))
  await page.keyboard.press('Escape')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)
  return names
}

const filterLine = (scope: Locator) => scope.getByTestId('list-filter-row')

test.use({ viewport: { width: 1600, height: 900 } })

test('a new list widget’s list is the open layout’s, offered only there (Change list, Add a list ›); Settings has no Lists', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await wsCell(page, 'b1').getByRole('button', { name: 'Add widget as tab' }).click()
  await page.getByRole('menu', { name: 'Add widget' }).getByRole('menuitem', { name: 'List' }).click()
  // A new list for this layout at once: no picker, no choice of where it goes.
  const editor = page.getByRole('dialog', { name: 'Edit list New list' })
  await expect(editor).toBeVisible()
  await editor.getByRole('textbox', { name: 'Name' }).fill('Errands')
  await page.getByRole('dialog', { name: 'Edit list Errands' }).getByRole('button', { name: 'Save list' }).click()
  await expect.poll(async () => (await lists(page)).find((d) => d.name === 'Errands')?.owner).toEqual({ layoutId: await layoutId(page, 'Main') })
  // The tab is a layout edit: save the layout.
  await page.getByTestId('layout-save').click()
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')

  expect(await changeListChoices(page, 'sharedTab')).toEqual(['Shared', 'Mine', 'Errands'])
  await wsTab(page, 'dashTab').click()
  expect(await addListTileChoices(page, 'dashTab')).toEqual(['Shared', 'Mine', 'Errands'])
  await switchLayout(page, 'Second')
  expect(await changeListChoices(page, 'otherTab')).toEqual(['Theirs'])
  await wsTab(page, 'otherDash').click()
  expect(await addListTileChoices(page, 'otherDash')).toEqual(['Theirs'])

  const settings = await openSettings(page, 'People, statuses & tags')
  await expect(settings.getByRole('button', { name: 'Manage people…' })).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Manage lists…' })).toHaveCount(0)
})

test('Save as: the new layout shows copies of its lists that edit on their own', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const mine = (await lists(page)).find((d) => d.name === 'Mine')!
  await layoutMenu(page, 'Save as new layout…')
  const dialog = page.getByRole('dialog', { name: 'Save as new layout' })
  await dialog.getByLabel('Name').fill('Copy')
  await dialog.getByRole('button', { name: 'Save layout' }).click()
  await expectOpenLayout(page, 'Copy')
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

test('Delete layout takes its lists with it; the confirm says so', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const mine = (await lists(page)).find((d) => d.name === 'Mine')!
  await layoutMenu(page, 'Delete layout…')
  const confirm = page.getByRole('dialog', { name: 'Delete layout “Main”?' })
  await expect(confirm).toContainText('The layout and its 2 lists are removed. This can’t be undone.')
  await confirm.getByRole('button', { name: 'Delete layout' }).click()
  await expectOpenLayout(page, 'Second')
  await expect.poll(async () => (await lists(page)).some((d) => d.id === mine.id)).toBe(false)
  expect((await lists(page)).some((d) => d.name === 'Shared')).toBe(false)
  // Another layout's list stays.
  expect((await lists(page)).some((d) => d.name === 'Theirs')).toBe(true)
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
