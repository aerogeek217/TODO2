import { expect, test, type Page } from '@playwright/test'
import {
  enterLayoutEdit,
  expectOpenLayout,
  layoutEditBar,
  newestUndoStep,
  openCellLayoutMenu,
  readListDefinitions,
  seedWorkspace,
  switchLayout,
  wsCard,
  wsTab,
  type WorkspaceSeed,
} from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * Move / Copy to layout (2026-11-18) in a real browser: a widget's ⋯ (here a
 * right-click on its top line) › Move to layout › another layout opens that
 * layout in the edit mode with the widget in hand — Done off until it is
 * placed —; placed and Done, both layouts are stored and the list goes with
 * it, as one undo step; Copy cell to layout from a card's menu copies the
 * list, and Esc while it is still in hand goes back with nothing written.
 */

const SEED: WorkspaceSeed = {
  // The widget menus open from each widget's top line, so Notes alone in its cell needs its name line.
  settings: { showWidgetNames: 'true' },
  listDefinitions: [{ name: 'Errands', layoutIdx: 0 }, { name: 'Planning list', layoutIdx: 1 }],
  tasks: [{ title: 'Call the plumber' }],
  layouts: [
    {
      name: 'Main',
      table: {
        areas: ['a b'],
        cells: [
          { id: 'a', tabs: [{ id: 'errandsTab', kind: 'lens', listDefIdx: 0 }] },
          { id: 'b', tabs: [{ id: 'notesTab', kind: 'notes' }] },
        ],
      },
    },
    {
      name: 'Second',
      table: {
        areas: ['x e'],
        cells: [
          { id: 'x', tabs: [{ id: 'planTab', kind: 'lens', listDefIdx: 1 }] },
          { id: 'e', tabs: [] },
        ],
      },
    },
  ],
}

type StoredLayout = { id: number; name: string; cells: Array<{ id: string; tabs: Array<{ id: string; kind: string; config: { listDefinitionId?: number } }> }> }
type StoredList = { id: number; name: string; owner?: { layoutId?: number } }

const layouts = (page: Page) => readStore<StoredLayout>(page, 'layouts')
const lists = async (page: Page) => (await readListDefinitions(page)) as unknown as StoredList[]
const layoutNamed = async (page: Page, name: string) => (await layouts(page)).find((l) => l.name === name)!
const tabsOf = (l: StoredLayout) => l.cells.flatMap((c) => c.tabs)
const listIdsOf = (l: StoredLayout) => tabsOf(l).flatMap((t) => (t.config.listDefinitionId != null ? [t.config.listDefinitionId] : []))

async function pickFromWidgetMenu(page: Page, tabId: string, parent: 'Move to layout' | 'Copy to layout', layout: string): Promise<void> {
  await wsTab(page, tabId).click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Cell options' })
  await menu.getByRole('menuitem', { name: parent }).click()
  await page.getByRole('menu', { name: parent }).getByRole('menuitem', { name: layout, exact: true }).click()
}

test.use({ viewport: { width: 1600, height: 900 } })

test('Move to layout carries a list widget into another layout, placed in a slot; Done moves its list; Undo puts it back', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const errands = (await lists(page)).find((d) => d.name === 'Errands')!
  const main = await layoutNamed(page, 'Main')
  const second = await layoutNamed(page, 'Second')

  await pickFromWidgetMenu(page, 'errandsTab', 'Move to layout', 'Second')
  await expectOpenLayout(page, 'Second')
  const bar = layoutEditBar(page)
  await expect(bar).toBeVisible()
  await expect(page.getByTestId('layout-edit-incoming-hint')).toHaveText('Place “Errands” from “Main”: click a slot, a card to join it, or a +')
  await expect(bar.getByRole('button', { name: 'Done', exact: true })).toBeDisabled()
  // Nothing is written yet.
  expect(tabsOf(await layoutNamed(page, 'Main')).map((t) => t.id)).toContain('errandsTab')

  // A click on the empty slot places it there.
  await page.locator('[data-edit-slot="e"]').click()
  await expect(page.getByTestId('layout-edit-incoming-hint')).toHaveText('Done moves “Errands” here from “Main”')
  await bar.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(bar).toHaveCount(0)

  await expect.poll(async () => listIdsOf(await layoutNamed(page, 'Second')).sort()).toEqual([errands.id, (await lists(page)).find((d) => d.name === 'Planning list')!.id].sort())
  await expect.poll(async () => tabsOf(await layoutNamed(page, 'Main')).map((t) => t.id)).toEqual(['notesTab'])
  // Its list now belongs to Second, the same list.
  await expect.poll(async () => (await lists(page)).find((d) => d.id === errands.id)?.owner).toEqual({ layoutId: second.id })
  await expect.poll(() => newestUndoStep(page)).toBe('Moved “Errands” to “Second”')

  // Undo from the other layout puts both back.
  await switchLayout(page, 'Main')
  await expectOpenLayout(page, 'Main')
  await page.keyboard.press('Control+z')
  await expect(wsTab(page, 'errandsTab')).toBeVisible()
  await expect.poll(async () => (await lists(page)).find((d) => d.id === errands.id)?.owner).toEqual({ layoutId: main.id })
  await expect.poll(async () => listIdsOf(await layoutNamed(page, 'Second'))).not.toContain(errands.id)
})

test('Copy cell to layout from a card’s menu joins a card there; the target gets its own copy of the list', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const errands = (await lists(page)).find((d) => d.name === 'Errands')!
  await enterLayoutEdit(page)
  const menu = await openCellLayoutMenu(page, 'a')
  await menu.getByRole('menuitem', { name: 'Copy cell to layout' }).click()
  await page.getByRole('menu', { name: 'Copy cell to layout' }).getByRole('menuitem', { name: 'Second', exact: true }).click()
  await expectOpenLayout(page, 'Second')
  await expect(page.getByTestId('layout-edit-incoming-hint')).toContainText('Place a copy of “Errands” from “Main”')

  // A click on a card joins it as a tab.
  await wsCard(page, 'x').click()
  await layoutEditBar(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(layoutEditBar(page)).toHaveCount(0)

  const second = await layoutNamed(page, 'Second')
  await expect.poll(async () => (await layoutNamed(page, 'Second')).cells.find((c) => c.id === 'x')?.tabs.length).toBe(2)
  // Main keeps its widget and its list; Second shows a new list of its own named the same.
  expect(tabsOf(await layoutNamed(page, 'Main')).map((t) => t.id)).toEqual(['errandsTab', 'notesTab'])
  const copies = (await lists(page)).filter((d) => d.name === 'Errands')
  expect(copies).toHaveLength(2)
  const copy = copies.find((d) => d.id !== errands.id)!
  expect(copy.owner).toEqual({ layoutId: second.id })
  expect(listIdsOf(await layoutNamed(page, 'Second'))).toContain(copy.id)
  await expect.poll(() => newestUndoStep(page)).toBe('Copied “Errands” to “Second”')
})

test('Esc with the widget still in hand goes back to its layout, nothing written; At the bottom places it in a new row', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const before = await layouts(page)
  await pickFromWidgetMenu(page, 'notesTab', 'Move to layout', 'Second')
  await expect(layoutEditBar(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(layoutEditBar(page)).toHaveCount(0)
  await expectOpenLayout(page, 'Main')
  expect((await layouts(page)).map((l) => l.cells)).toEqual(before.map((l) => l.cells))

  await pickFromWidgetMenu(page, 'notesTab', 'Move to layout', 'Second')
  await page.getByTestId('layout-edit-place-bottom').click()
  await layoutEditBar(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(layoutEditBar(page)).toHaveCount(0)
  await expect.poll(async () => (await layoutNamed(page, 'Second')).cells.length).toBe(3)
  await expect.poll(async () => tabsOf(await layoutNamed(page, 'Second')).map((t) => t.id)).toContain('notesTab')
})

test('Save at a switch’s question with the widget still in hand calls the move off: both layouts as they were, a notice says so', async ({ page }) => {
  const third = { name: 'Third', table: { areas: ['t'], cells: [{ id: 't', tabs: [{ id: 'thirdNotes', kind: 'notes' as const }] }] } }
  await seedWorkspace(page, { ...SEED, layouts: [...(SEED.layouts ?? []), third] })
  const before = await layouts(page)
  await pickFromWidgetMenu(page, 'notesTab', 'Move to layout', 'Second')
  await expect(layoutEditBar(page)).toBeVisible()
  // An edit that isn't the placing: the draft has changes, so leaving asks.
  const menu = await openCellLayoutMenu(page, 'x')
  await menu.getByRole('menuitem', { name: 'Insert', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New cell right', exact: true }).click()
  await expect(page.locator('[data-ws-table] [data-ws-cell]')).toHaveCount(3)

  // The palette's Go to Layout › Third.
  const field = page.getByPlaceholder(/Find tasks, commands|Type to filter/)
  await page.keyboard.press('Control+k')
  await expect(field).toBeFocused()
  await field.pressSequentially('go to lay')
  await expect(page.getByRole('listbox').getByRole('option').first()).toHaveText(/^Go to Layout/)
  await page.keyboard.press('Enter')
  await field.pressSequentially('Third')
  await page.keyboard.press('Enter')
  const question = page.getByRole('dialog', { name: 'Save changes to layout “Second”?' })
  await question.getByRole('button', { name: 'Save' }).click()

  await expect(layoutEditBar(page)).toHaveCount(0)
  await expectOpenLayout(page, 'Third')
  await expect(page.getByText('Nothing moved. Place the widgets before saving to move them.')).toBeVisible()
  expect((await layouts(page)).map((l) => [l.name, l.cells])).toEqual(before.map((l) => [l.name, l.cells]))
})
