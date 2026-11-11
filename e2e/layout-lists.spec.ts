import { expect, test, type Page } from '@playwright/test'
import { ADD_FILTER, closeListFilterEditor, expectOpenLayout, openListFilterEditor, openLayoutAction, openSettings, readListDefinitions, seedWorkspace, switchLayout as openLayout, wsCell, wsTab, type WorkspaceSeed, wsRow, expectLayoutStep, expectLayoutStored } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * Every list belongs to one layout, in a real browser: the list picker's
 * Create new list… makes a list of the open layout (a list tab is never
 * pointed at another list); Settings
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
        { id: 'colA', rows: [wsRow({ id: 'a1', tabs: [{ id: 'sharedTab', kind: 'lens', listDefIdx: 0 }, { id: 'mineTab', kind: 'lens', listDefIdx: 1 }] })] },
        { id: 'colB', rows: [wsRow({ id: 'b1', tabs: [{ id: 'notesTab', kind: 'notes' }] })] },
      ],
    },
    {
      name: 'Second',
      columns: [{ id: 'colX', rows: [wsRow({ id: 'x1', tabs: [{ id: 'otherTab', kind: 'lens', listDefIdx: 2 }] })] }],
    },
  ],
}

type StoredList = { id: number; name: string; owner?: { layoutId?: number }; membership: { predicate: { searchText: string } } }
const lists = async (page: Page) => (await readListDefinitions(page)) as unknown as StoredList[]
const layouts = async (page: Page) => readStore<{ id: number; name: string }>(page, 'layouts')
const layoutId = async (page: Page, name: string) => (await layouts(page)).find((l) => l.name === name)!.id

const layoutMenu = openLayoutAction

async function switchLayout(page: Page, name: string): Promise<void> {
  await openLayout(page, name)
  await expectOpenLayout(page, name)
}

test.use({ viewport: { width: 1600, height: 900 } })

test('a new list widget’s list is the open layout’s; a list tab is never pointed at another list; Settings has no Lists', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await wsCell(page, 'b1').hover()
  await wsCell(page, 'b1').getByRole('button', { name: 'Cell options' }).click()
  await page.getByRole('menuitem', { name: 'Add widget…' }).click()
  await page.getByRole('menu', { name: 'Add widget' }).getByRole('menuitem', { name: 'List' }).click()
  // A new list for this layout at once: no picker, no choice of where it goes.
  const editor = page.getByRole('dialog', { name: 'Edit list New list' })
  await expect(editor).toBeVisible()
  await editor.getByRole('textbox', { name: 'Name' }).fill('Errands')
  await page.getByRole('dialog', { name: 'Edit list Errands' }).getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => (await lists(page)).find((d) => d.name === 'Errands')?.owner).toEqual({ layoutId: await layoutId(page, 'Main') })
  // The tab is a layout edit, saved at once.
  await expectLayoutStored(page)

  // No Change list (UX cleanup 4A, decision 11): a list tab keeps its list; each list is its layout's.
  await wsTab(page, 'sharedTab').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Cell options' })
  await expect(menu.getByRole('menuitem', { name: 'Edit list…' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Change list/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  const main = await layoutId(page, 'Main')
  const second = await layoutId(page, 'Second')
  const owners = Object.fromEntries((await lists(page)).map((d) => [d.name, d.owner?.layoutId]))
  expect(owners).toMatchObject({ Shared: main, Mine: main, Errands: main, Theirs: second })
  await switchLayout(page, 'Second')
  await expect(wsTab(page, 'otherTab')).toContainText('Theirs')

  const settings = await openSettings(page, 'People, statuses & tags')
  await expect(settings.getByRole('button', { name: 'Manage people…' })).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Manage lists…' })).toHaveCount(0)
})

test('Duplicate layout: the new layout shows copies of its lists that edit on their own', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const mine = (await lists(page)).find((d) => d.name === 'Mine')!
  await layoutMenu(page, 'Duplicate layout…')
  const dialog = page.getByRole('dialog', { name: 'Duplicate layout' })
  await dialog.getByLabel('Name').fill('Copy')
  await dialog.getByRole('button', { name: 'Duplicate' }).click()
  await expectOpenLayout(page, 'Copy')
  const copyId = await layoutId(page, 'Copy')
  await expect.poll(async () => (await lists(page)).filter((d) => d.name === 'Mine').map((d) => d.owner?.layoutId).sort())
    .toEqual([mine.owner!.layoutId, copyId].sort())
  const copy = (await lists(page)).find((d) => d.name === 'Mine' && d.owner?.layoutId === copyId)!
  expect(copy.id).not.toBe(mine.id)
  await expectLayoutStored(page)

  // Edit the copy's filter (Edit list, from its line's words): Text contains "plumber"; Save.
  await wsTab(page, 'mineTab').click()
  const widget = wsCell(page, 'a1')
  const editor = await openListFilterEditor(page, widget)
  await editor.getByRole('button', { name: ADD_FILTER }).click()
  await page.getByRole('menuitem', { name: /Text contains/ }).click()
  await page.keyboard.type('plumber')
  await page.keyboard.press('Enter')
  await expect(widget.locator('[data-row-key]').filter({ hasText: 'Book flights' })).toHaveCount(0)
  await closeListFilterEditor(page)
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

test('closing a list’s last tab deletes the list at once; Undo brings back the list and its tab', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const mine = (await lists(page)).find((d) => d.name === 'Mine')!
  await wsTab(page, 'mineTab').hover()
  await wsTab(page, 'mineTab').getByRole('button', { name: 'Close Mine' }).click()
  await expectLayoutStep(page, 'Closed tab “Mine”')
  await expect.poll(async () => (await lists(page)).some((d) => d.id === mine.id)).toBe(false)

  await page.locator('[data-snackbar-live]').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(wsTab(page, 'mineTab')).toBeVisible()
  await expect.poll(async () => (await lists(page)).find((d) => d.id === mine.id)?.owner).toEqual(mine.owner)
  await expectLayoutStored(page)
  await page.reload()
  await expect(wsTab(page, 'mineTab')).toBeVisible()
})
