import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
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

test('Add Widget from the palette asks before it adds; Keep editing adds nothing; Discard adds the widget', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await dirtyEditList(page)
  /** The kinds of the tabs in Main's one cell, as stored. */
  const tabKinds = async () => (await readStore<{ name: string; cells: Array<{ tabs: Array<{ kind: string }> }> }>(page, 'layouts'))
    .find((l) => l.name === 'Main')?.cells.flatMap((c) => c.tabs.map((t) => t.kind))
  const addNotes = async () => {
    await page.keyboard.press('Control+k')
    const field = page.getByPlaceholder(/Find tasks, commands/)
    await expect(field).toBeFocused()
    await field.pressSequentially('add widget notes')
    await expect(page.getByRole('listbox').getByRole('option').first()).toHaveText('Add Widget › Notes')
    await page.keyboard.press('Enter')
    // The Where picker (a tab of the list's cell by default), then Add Notes — all by the keys.
    const add = page.getByRole('menu', { name: 'Add widget' }).getByRole('menuitem', { name: 'Add Notes' })
    await expect(add).toBeVisible()
    await add.focus()
    await page.keyboard.press('Enter')
  }
  await addNotes()
  await expect(question(page)).toBeVisible()
  await answer(page, 'Keep editing')
  await expect(editList(page)).toBeVisible()
  expect(await tabKinds()).toEqual(['lens'])
  await expect(wsListWidget(page, 't1').getByTestId('list-summary')).toHaveText('Name')

  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
  await addNotes()
  await answer(page, 'Discard')
  await expect(editList(page)).toHaveCount(0)
  await expect.poll(tabKinds).toEqual(['lens', 'notes'])
  expect(await teamSort(page)).toBe('manual')
})

/** The kinds of the tabs of layout Main, as stored. */
async function mainTabKinds(page: Page): Promise<string[] | undefined> {
  return (await readStore<{ name: string; cells: Array<{ tabs: Array<{ kind: string }> }> }>(page, 'layouts'))
    .find((l) => l.name === 'Main')?.cells.flatMap((c) => c.tabs.map((t) => t.kind))
}

type MenuPick = [role: 'menuitem' | 'menuitemradio', name: string | RegExp]

/** Opens cell `cellId`'s menu `button` and runs its `items` in turn (a submenu's after its parent), all by the keys. */
async function pickByKeys(page: Page, cellId: string, button: 'Cell options' | 'Cell layout', ...items: MenuPick[]): Promise<void> {
  await page.locator(`[data-ws-cell="${cellId}"]`).getByRole('button', { name: button, exact: true }).focus()
  await page.keyboard.press('Enter')
  for (const [role, name] of items) {
    const entry = page.getByRole('menu').last().getByRole(role, { name })
    await expect(entry).toBeVisible()
    await entry.focus()
    await page.keyboard.press('Enter')
  }
}

/** Team's list and Notes as two tabs of one cell, the list shown. */
const TWO_TABS: WorkspaceSeed = {
  ...SEED,
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }, { id: 'n1', kind: 'notes' }] })] }] }],
}
const stripTab = (page: Page, tabId: string) => page.locator(`[role="tab"][data-ws-tab="${tabId}"]`)
/** The notice an editor closed without its question leaves behind. */
const droppedNotice = (page: Page) => page.getByText('weren’t saved')
/** Layout Main as stored: whether its first row is collapsed, and its cells' tab kinds. */
async function mainLayout(page: Page): Promise<{ collapsed: boolean; cells: string[][] } | undefined> {
  const main = (await readStore<{ name: string; grid: { rows: Array<{ collapsed?: boolean }> }; cells: Array<{ tabs: Array<{ kind: string }> }> }>(page, 'layouts'))
    .find((l) => l.name === 'Main')
  return main && { collapsed: main.grid.rows[0]?.collapsed === true, cells: main.cells.map((c) => c.tabs.map((t) => t.kind)) }
}

test('a tab switched by the arrow keys asks; Keep editing stays on the list; Discard switches, the focus on the new tab', async ({ page }) => {
  await seedWorkspace(page, TWO_TABS)
  await dirtyEditList(page)
  const list = stripTab(page, 't1')
  const notes = stripTab(page, 'n1')
  await list.focus()
  await page.keyboard.press('ArrowRight')
  await expect(question(page)).toBeVisible()
  await expect(list).toHaveAttribute('aria-selected', 'true')
  await answer(page, 'Keep editing')
  await expect(editList(page)).toBeVisible()
  await expect(list).toHaveAttribute('aria-selected', 'true')
  await expect(wsListWidget(page, 't1').getByTestId('list-summary')).toHaveText('Name')

  await list.focus()
  await page.keyboard.press('ArrowRight')
  await answer(page, 'Discard')
  await expect(notes).toHaveAttribute('aria-selected', 'true')
  await expect(notes).toBeFocused()
  await expect(editList(page)).toHaveCount(0)
  await expect(droppedNotice(page)).toHaveCount(0)
  expect(await teamSort(page)).toBe('manual')
})

/** Team's list and twelve Notes in half the width: most fold into +N (the list's filter line still shows). */
const FOLDED_TABS: WorkspaceSeed = {
  ...SEED,
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c1', weight: 1, rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }, ...Array.from({ length: 12 }, (_, i) => ({ id: `n${i + 1}`, kind: 'notes' as const }))], activeTabId: 't1' })] },
      { id: 'c2', weight: 1, rows: [wsRow({ id: 'k2', tabs: [{ id: 'm1', kind: 'notes' }] })] },
    ],
  }],
}

/** Seeds FOLDED_TABS, dirties Edit list, and returns the strip's last tab (a folded one: the shown tabs come first). */
async function foldedTarget(page: Page) {
  await seedWorkspace(page, FOLDED_TABS)
  const cell = page.locator('[data-ws-cell="k1"]')
  await expect(cell.locator('[role="tab"][data-ws-tab-folded]').first()).toBeAttached()
  await dirtyEditList(page)
  const lastId = (await cell.locator('[role="tab"]').last().getAttribute('data-ws-tab')) ?? ''
  const target = stripTab(page, lastId)
  await expect(target).toHaveAttribute('data-ws-tab-folded', '')
  return { cell, target }
}

async function expectShownAndFocused(target: Locator) {
  await expect(target).toHaveAttribute('aria-selected', 'true')
  await expect(target).not.toHaveAttribute('data-ws-tab-folded')
  await expect(target).toBeFocused()
}

test('a tab folded into +N, switched to by the keys, asks; after Discard it shows with the focus on it (cr34 X)', async ({ page }) => {
  const { target } = await foldedTarget(page)
  await stripTab(page, 't1').focus()
  await page.keyboard.press('End')
  await expect(question(page)).toBeVisible()
  await answer(page, 'Discard')
  await expectShownAndFocused(target)
  await expect(editList(page)).toHaveCount(0)
})

test('a tab picked from the +N menu by the keys asks; Keep editing stays; after Discard it shows with the focus on it (cr34 X)', async ({ page }) => {
  const { cell, target } = await foldedTarget(page)
  const pick = async () => {
    await cell.getByRole('button', { name: /more tabs$/ }).focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu', { name: 'More tabs' })
    await expect(menu.getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(question(page)).toBeVisible()
  }
  await pick()
  await answer(page, 'Keep editing')
  await expect(editList(page)).toBeVisible()
  await expect(stripTab(page, 't1')).toHaveAttribute('aria-selected', 'true')
  await expect(target).not.toBeFocused()

  await pick()
  await answer(page, 'Discard')
  await expectShownAndFocused(target)
  await expect(editList(page)).toHaveCount(0)
})

test('a click on another tab asks once; Keep editing stays; Save writes the list, then the tab switches', async ({ page }) => {
  await seedWorkspace(page, TWO_TABS)
  await dirtyEditList(page)
  const list = stripTab(page, 't1')
  const notes = stripTab(page, 'n1')
  await notes.click()
  await expect(question(page)).toBeVisible()
  await expect(page.getByRole('dialog', { name: /^Save changes/ })).toHaveCount(1)
  await answer(page, 'Keep editing')
  await expect(editList(page)).toBeVisible()
  await expect(list).toHaveAttribute('aria-selected', 'true')

  await notes.click()
  await answer(page, 'Save')
  // The click carries on: the tab switches, with no second question.
  await expect(notes).toHaveAttribute('aria-selected', 'true')
  await expect(editList(page)).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: /^Save changes/ })).toHaveCount(0)
  await expect(droppedNotice(page)).toHaveCount(0)
  await expect.poll(() => teamSort(page)).toBe('name')
})

test('Collapse row asks — the header’s button and the menu’s, by the keys; Discard collapses the row', async ({ page }) => {
  await seedWorkspace(page, TWO_TABS)
  await dirtyEditList(page)
  await page.locator('[data-ws-cell="k1"]').getByRole('button', { name: 'Collapse row' }).focus()
  await page.keyboard.press('Enter')
  await expect(question(page)).toBeVisible()
  await answer(page, 'Keep editing')
  await expect(editList(page)).toBeVisible()
  expect((await mainLayout(page))?.collapsed).toBe(false)

  await pickByKeys(page, 'k1', 'Cell layout', ['menuitem', 'Collapse row'])
  await expect(question(page)).toBeVisible()
  await answer(page, 'Discard')
  await expect(editList(page)).toHaveCount(0)
  await expect.poll(async () => (await mainLayout(page))?.collapsed).toBe(true)
  await expect(droppedNotice(page)).toHaveCount(0)
  expect(await teamSort(page)).toBe('manual')
})

test('Merge with from a menu run by the keys asks; Keep editing merges nothing; Discard merges the cells', async ({ page }) => {
  await seedWorkspace(page, {
    ...SEED,
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c0', rows: [wsRow({ id: 'k0', tabs: [{ id: 'n0', kind: 'notes' }] })] },
        { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] },
      ],
    }],
  })
  await dirtyEditList(page)
  // Notes takes the list's cell: its tabs join after Notes, which stays shown — the list would go out of sight.
  const merge = () => pickByKeys(page, 'k0', 'Cell layout', ['menuitem', 'Merge with'], ['menuitem', 'Right'])
  await merge()
  await expect(question(page)).toBeVisible()
  await answer(page, 'Keep editing')
  await expect(editList(page)).toBeVisible()
  expect((await mainLayout(page))?.cells).toEqual([['notes'], ['lens']])

  await merge()
  await answer(page, 'Discard')
  await expect(editList(page)).toHaveCount(0)
  await expect.poll(async () => (await mainLayout(page))?.cells).toEqual([['notes', 'lens']])
  await expect(droppedNotice(page)).toHaveCount(0)
})

test('closing the widget popup over an Edit list with changes asks; Keep editing keeps both; Discard closes it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const cell = page.locator('[data-ws-cell="k1"]')
  await cell.hover()
  await cell.getByRole('button', { name: 'Open larger' }).click()
  const popup = page.getByTestId('widget-popup')
  await expect(popup).toBeVisible()
  await popup.getByRole('button', { name: 'Widget options' }).click()
  await page.getByRole('menu', { name: 'Widget options' }).getByRole('menuitem', { name: /^Edit list/ }).click()
  await expect(editList(page)).toBeVisible()
  await editList(page).getByRole('button', { name: /^Sort by/ }).click()
  await page.getByRole('menuitemradio', { name: /^Name/ }).click()

  // Its ×.
  await popup.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(question(page)).toBeVisible()
  await answer(page, 'Keep editing')
  await expect(popup).toBeVisible()
  await expect(editList(page)).toBeVisible()
  // A press on its scrim.
  await page.mouse.click(6, 894)
  await expect(question(page)).toBeVisible()
  await answer(page, 'Keep editing')
  await expect(popup).toBeVisible()
  await expect(editList(page)).toBeVisible()

  await popup.getByRole('button', { name: 'Close', exact: true }).click()
  await answer(page, 'Discard')
  await expect(popup).toHaveCount(0)
  await expect(editList(page)).toHaveCount(0)
  await expect(droppedNotice(page)).toHaveCount(0)
  expect(await teamSort(page)).toBe('manual')
})

test('Delete on a tab asks before it closes the tab; Keep editing closes nothing; Discard closes it', async ({ page }) => {
  await seedWorkspace(page, TWO_TABS)
  await dirtyEditList(page)
  const tab = page.locator('[data-ws-tab="t1"]')
  await tab.focus()
  await page.keyboard.press('Delete')
  await expect(question(page)).toBeVisible()
  expect(await mainTabKinds(page)).toEqual(['lens', 'notes'])
  await answer(page, 'Keep editing')
  await expect(editList(page)).toBeVisible()
  await expect(wsListWidget(page, 't1').getByTestId('list-summary')).toHaveText('Name')
  expect(await mainTabKinds(page)).toEqual(['lens', 'notes'])

  await tab.focus()
  await page.keyboard.press('Delete')
  await answer(page, 'Discard')
  await expect(editList(page)).toHaveCount(0)
  await expect.poll(() => mainTabKinds(page)).toEqual(['notes'])
  // It closed as ever: one undo step, named as ever, and no notice that an edit was dropped.
  await expect(page.getByText('Removed “Team”')).toBeVisible()
})

test('Change widget and Close cell from a menu run by the keys ask first; Keep editing changes nothing', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await dirtyEditList(page)
  const pick = (button: 'Cell options' | 'Cell layout', ...items: MenuPick[]) => pickByKeys(page, 'k1', button, ...items)
  const changeToCalendar = () => pick('Cell options', ['menuitem', /^Change widget/], ['menuitemradio', 'Calendar'])

  await changeToCalendar()
  await expect(question(page)).toBeVisible()
  await answer(page, 'Keep editing')
  await expect(editList(page)).toBeVisible()
  expect(await mainTabKinds(page)).toEqual(['lens'])

  await pick('Cell layout', ['menuitem', 'Close cell'])
  await expect(question(page)).toBeVisible()
  await answer(page, 'Keep editing')
  await expect(editList(page)).toBeVisible()
  expect(await mainTabKinds(page)).toEqual(['lens'])
  await expect(wsListWidget(page, 't1').getByTestId('list-summary')).toHaveText('Name')

  // Discard: the edit is dropped, then the widget changes.
  await changeToCalendar()
  await answer(page, 'Discard')
  await expect(editList(page)).toHaveCount(0)
  await expect.poll(() => mainTabKinds(page)).toEqual(['calendar'])
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
