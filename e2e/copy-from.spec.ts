import { expect, test, type Locator, type Page } from '@playwright/test'
import { readListDefinitions, seedWorkspace, wsListWidget, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { readStore } from './fixtures/db'
import { rowTitles } from './fixtures/seed'

/**
 * Copy from, in a real browser: Edit list's Copy from… takes another list's
 * filters, group, sort, prompt and filter line into the list as an unsaved
 * edit (its name kept; Revert drops it, Save list keeps it). One chooser:
 * the lists by layout — this one first —, then the Eisenhower's.
 */

const SEED: WorkspaceSeed = {
  tasks: [{ title: 'Call the plumber' }, { title: 'Book flights' }, { title: 'Call mom' }],
  listDefinitions: [
    { name: 'Mine', layoutIdx: 0 },
    { name: 'Ordered', layoutIdx: 0 },
    {
      name: 'Calls',
      layoutIdx: 1,
      predicate: { searchText: 'call' },
      sort: 'deadline',
      sortDirection: 'desc',
      grouping: 'status',
      showFilterLine: false,
    },
  ],
  layouts: [
    {
      name: 'Main',
      columns: [
        { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'mineTab', kind: 'lens', listDefIdx: 0 }, { id: 'orderedTab', kind: 'lens', listDefIdx: 1 }] }] },
        { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'notesTab', kind: 'notes' }] }] },
      ],
    },
    {
      name: 'Second',
      columns: [{ id: 'colX', cells: [{ id: 'x1', tabs: [{ id: 'callsTab', kind: 'lens', listDefIdx: 2 }] }] }],
    },
  ],
}

type StoredList = {
  id: number
  name: string
  owner?: { layoutId?: number; eisenhower?: true }
  sort: string
  sortDirection?: string
  grouping: string
  showFilterLine?: false
  runtimeFilter?: unknown
  membership: { predicate: { searchText: string } }
}
const lists = async (page: Page) => (await readListDefinitions(page)) as unknown as StoredList[]
const listNamed = async (page: Page, name: string) => (await lists(page)).find((d) => d.name === name)
const layoutId = async (page: Page, name: string) =>
  (await readStore<{ id: number; name: string }>(page, 'layouts')).find((l) => l.name === name)!.id

/** A menu's headings and items in order: `# Heading` / item names (separators skipped). */
async function menuOutline(menu: Locator): Promise<string[]> {
  return menu.evaluate((el) => Array.from(el.children).flatMap((c) => {
    if (c.getAttribute('role') === 'presentation') return [`# ${c.textContent ?? ''}`]
    const label = c.getAttribute('data-menu-label')
    return label != null ? [label] : []
  }))
}

const editList = (page: Page) => page.getByTestId('edit-list')

async function openEditList(page: Page, tabId: string): Promise<Locator> {
  await wsTab(page, tabId).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit list…' }).click()
  await expect(editList(page)).toBeVisible()
  return editList(page)
}

test.use({ viewport: { width: 1600, height: 900 } })

test('Edit list › Copy from…: by layout; the copy is an unsaved edit — Revert drops it, Save list keeps it, the name stays', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const editor = await openEditList(page, 'mineTab')
  await editor.getByRole('button', { name: 'Copy from…' }).click()
  const menu = page.getByRole('menu', { name: 'Copy from' })
  await expect(menu).toBeVisible()
  // This layout first (the list being edited left out), then the others, then the Eisenhower's.
  expect(await menuOutline(menu)).toEqual(['# Main · this layout', 'Ordered', '# Second', 'Calls', '# Eisenhower', 'Eisenhower'])
  await expect(menu.getByRole('menuitem', { name: /^Calls/ })).toContainText('Text: “call”')
  await expect(menu.getByRole('menuitem', { name: /^Ordered/ })).toContainText('All tasks')
  // Esc closes the chooser only.
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(editor).toBeVisible()

  await editor.getByRole('button', { name: 'Copy from…' }).click()
  await menu.getByRole('menuitem', { name: /^Calls/ }).click()
  // A pick in the chooser isn't a press elsewhere: Edit list stays, unsaved, its name kept.
  await expect(menu).toHaveCount(0)
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Mine')
  await expect(editor.getByRole('status')).toHaveText('Copied from “Calls” · unsaved')
  await expect.poll(() => rowTitles(wsListWidget(page, 'mineTab'))).toEqual(['Call the plumber', 'Call mom'])
  await expect(wsTab(page, 'mineTab').getByRole('img', { name: 'unsaved list changes' })).toBeVisible()

  await editor.getByRole('button', { name: 'Revert' }).click()
  await expect(editor).toHaveCount(0)
  await expect.poll(async () => (await rowTitles(wsListWidget(page, 'mineTab'))).length).toBe(3)

  await openEditList(page, 'mineTab')
  await editList(page).getByRole('button', { name: 'Copy from…' }).click()
  await menu.getByRole('menuitem', { name: /^Calls/ }).click()
  await editList(page).getByRole('button', { name: 'Save list' }).click()
  await expect(editList(page)).toHaveCount(0)
  await expect.poll(() => listNamed(page, 'Mine')).toMatchObject({
    sort: 'deadline',
    sortDirection: 'desc',
    grouping: 'status',
    showFilterLine: false,
    membership: { predicate: { searchText: 'call' } },
    owner: { layoutId: await layoutId(page, 'Main') },
  })
  // The source is untouched.
  expect((await lists(page)).filter((d) => d.name === 'Calls')).toHaveLength(1)
})
