import { expect, test, type Locator, type Page } from '@playwright/test'
import { readListDefinitions, readListOrders, seedWorkspace, wsCell, wsListWidget, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { readStore, writeStores } from './fixtures/db'
import { rowTitles } from './fixtures/seed'

/**
 * Copy from, in a real browser: Edit list's Copy from… takes another list's
 * filters, group, sort, prompt and filter line into the list as an unsaved
 * edit (its name kept; Revert drops it, Save list keeps it); a list
 * picker's Copy of › makes a copy of any layout's list for the open layout
 * (named uniquely within it, with the source's manual order). One chooser:
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

/** Manual ranks for `Ordered`: Call mom, Book flights, Call the plumber. */
async function seedOrderedRanks(page: Page): Promise<void> {
  const todos = await readStore<{ id: number; title: string }>(page, 'todos')
  const id = (title: string) => todos.find((t) => t.title === title)!.id
  const ordered = (await listNamed(page, 'Ordered'))!.id
  await writeStores(page, {
    add: {
      listOrders: [
        { listDefinitionId: ordered, todoId: id('Call mom'), rank: 1000 },
        { listDefinitionId: ordered, todoId: id('Book flights'), rank: 2000 },
        { listDefinitionId: ordered, todoId: id('Call the plumber'), rank: 3000 },
      ],
    },
  })
  await page.reload()
  await expect(wsTab(page, 'orderedTab')).toBeVisible()
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

test('a list picker’s Copy of ›: a copy of another layout’s list, or this one’s (named uniquely, its manual order kept), for this layout', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await seedOrderedRanks(page)
  const main = await layoutId(page, 'Main')

  const addFromCopyOf = async (source: RegExp, mainLists: string[]) => {
    await wsCell(page, 'b1').getByRole('button', { name: 'Add widget as tab' }).click()
    await page.getByRole('menu', { name: 'Add widget' }).getByRole('menuitem', { name: 'List' }).click()
    await page.getByRole('button', { name: 'Copy of' }).click()
    const menu = page.getByRole('menu', { name: 'Copy of' })
    await expect(menu).toBeVisible()
    expect(await menuOutline(menu)).toEqual(['# Main · this layout', ...mainLists, '# Second', 'Calls', '# Eisenhower', 'Eisenhower'])
    await menu.getByRole('menuitem', { name: source }).first().click()
    await expect(menu).toHaveCount(0)
  }

  // Another layout's list: same name (Main has none), its parts, owned by Main; Edit list opens on it.
  await addFromCopyOf(/^Calls/, ['Mine', 'Ordered'])
  await expect(page.getByRole('dialog', { name: 'Edit list Calls' })).toBeVisible()
  await expect(wsCell(page, 'b1').getByRole('tab', { name: 'Calls' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(async () => (await lists(page)).filter((d) => d.name === 'Calls').length).toBe(2)
  const copy = (await lists(page)).find((d) => d.name === 'Calls' && d.owner?.layoutId === main)!
  expect(copy).toMatchObject({ sort: 'deadline', sortDirection: 'desc', grouping: 'status', showFilterLine: false, membership: { predicate: { searchText: 'call' } } })
  // Nothing unsaved about the copy: Esc just closes Edit list.
  await page.keyboard.press('Escape')
  await expect(editList(page)).toHaveCount(0)

  // This layout's own list: `Ordered 2`, with Ordered's manual order.
  await addFromCopyOf(/^Ordered/, ['Mine', 'Ordered', 'Calls'])
  await expect(page.getByRole('dialog', { name: 'Edit list Ordered 2' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(() => listNamed(page, 'Ordered 2')).toMatchObject({ owner: { layoutId: main }, sort: 'manual', grouping: 'none' })
  const ordered = (await listNamed(page, 'Ordered'))!.id
  const ordered2 = (await listNamed(page, 'Ordered 2'))!.id
  const ranksOf = async (listId: number) => Object.fromEntries((await readListOrders(page))
    .filter((r) => r.listDefinitionId === listId).map((r) => [r.todoId, r.rank]))
  expect(await ranksOf(ordered2)).toEqual(await ranksOf(ordered))
  const tab = wsCell(page, 'b1').getByRole('tab', { name: 'Ordered 2' })
  const tabId = (await tab.getAttribute('data-ws-tab'))!
  await expect.poll(() => rowTitles(wsListWidget(page, tabId))).toEqual(['Call mom', 'Book flights', 'Call the plumber'])
})
