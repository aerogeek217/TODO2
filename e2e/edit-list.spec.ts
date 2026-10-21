import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, wsListWidget, wsTab, readListDefinitions, editListDraft, type WorkspaceSeed } from './fixtures/workspace'
import { box, type Box } from './fixtures/geometry'
import { readStore } from './fixtures/db'
import { rowTitles } from './fixtures/seed'

/**
 * Edit list: one non-modal popover beside the list's panel that edits the
 * list's shared draft live (every widget showing the list updates and shows
 * it unsaved); Revert · Save on the list's filter line while the list is
 * unsaved. The filter line itself always shows.
 */

const editList = (page: Page) => page.getByTestId('edit-list')

/** Three columns; the middle and right ones show the same list. */
const shared: WorkspaceSeed = {
  people: ['Alice', 'Bob'],
  listDefinitions: [{ name: 'Team' }, { name: 'Other' }],
  tasks: [
    { title: 'Bravo', people: ['Bob'] },
    { title: 'Alpha', people: ['Alice'] },
    { title: 'Charlie', people: ['Alice'] },
  ],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c0', cells: [{ id: 'k0', tabs: [{ id: 't0', kind: 'lens', listDefIdx: 1 }] }] },
      { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] },
      { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 0 }] }] },
    ],
  }],
}

async function openFromTabMenu(page: Page, tabId: string): Promise<Locator> {
  await wsTab(page, tabId).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit list…' }).click()
  await expect(editList(page)).toBeVisible()
  return editList(page)
}

async function pick(page: Page, row: string, choice: string): Promise<void> {
  await editList(page).getByRole('button', { name: new RegExp(`^${row}`) }).click()
  await page.getByRole('menuitemradio', { name: new RegExp(`^${choice}`) }).click()
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

for (const width of [1440, 1100]) {
  test(`${width}px: the popover sits beside its panel — right, or left near the window's right edge — never over its own list`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await seedWorkspace(page, shared)

    // The middle panel: to its right, top 6px below the panel's, arrow on the left.
    let popover = await openFromTabMenu(page, 't1')
    let cell = await box(wsCell(page, 'k1'))
    let p = await box(popover)
    expect(Math.round(p.width)).toBe(340)
    await expect(popover).toHaveAttribute('data-placement', 'right-start')
    expect(Math.round(p.x)).toBe(Math.round(cell.x + cell.width + 8))
    expect(Math.round(p.y)).toBe(Math.round(cell.y + 6))
    expect(overlaps(p, cell)).toBe(false)
    expect(p.x + p.width).toBeLessThanOrEqual(width - 8)
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)

    // The right panel: no room on its right, so to its left.
    popover = await openFromTabMenu(page, 't2')
    cell = await box(wsCell(page, 'k2'))
    p = await box(popover)
    await expect(popover).toHaveAttribute('data-placement', 'left-start')
    expect(Math.round(p.x + p.width)).toBe(Math.round(cell.x - 8))
    expect(overlaps(p, cell)).toBe(false)
  })
}

test('a panel too wide for either side: the popover drops below its filter line, right-aligned to the panel', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 })
  await seedWorkspace(page, {
    ...shared,
    listDefinitions: [{ name: 'Team', predicate: { searchText: 'a' } }],
    layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
  })
  const popover = await openFromTabMenu(page, 't1')
  await expect(popover).toHaveAttribute('data-placement', 'below')
  const cell = await box(wsCell(page, 'k1'))
  const line = await box(wsListWidget(page, 't1').getByTestId('list-filter-row'))
  const p = await box(popover)
  expect(Math.round(p.y)).toBeGreaterThanOrEqual(Math.round(line.y + line.height))
  expect(Math.round(p.x + p.width)).toBe(Math.round(cell.x + cell.width - 6))
})

test('edits show live in every widget showing the list; the popover stays open; Save list writes and closes it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  // Opened from the filter line's summary (shown with no filters set and the list saved).
  const summary = wsListWidget(page, 't1').getByTestId('list-summary')
  await expect(summary).toHaveText('Manual')
  await summary.click()
  const popover = editList(page)
  await expect(popover).toBeVisible()
  await expect(popover.getByRole('textbox', { name: 'Name' })).toBeFocused()
  await expect(popover.getByRole('button', { name: 'Save list' })).toBeDisabled()
  await expect(popover.getByRole('button', { name: 'Revert' })).toBeDisabled()
  await expect(popover).toContainText('Shared · 2 widgets')
  // Unset Group by: a blank field with a muted placeholder, no "None".
  const group = popover.getByRole('button', { name: 'Group by', exact: true })
  await expect(group).toHaveText('Group by…')
  const [placeholderColour, nameColour] = await Promise.all([
    group.locator('[data-placeholder]').evaluate((el) => getComputedStyle(el).color),
    popover.getByRole('button', { name: /^Sort by/ }).evaluate((el) => getComputedStyle(el.querySelector('span')!).color),
  ])
  expect(placeholderColour).not.toBe(nameColour)
  await expect(popover).not.toContainText('None')

  await pick(page, 'Group by', 'People')
  await expect(popover).toBeVisible()
  for (const tabId of ['t1', 't2']) {
    await expect(wsListWidget(page, tabId).getByTestId('list-group-name')).toHaveText(['Alice', 'Bob'])
    await expect(wsTab(page, tabId).getByRole('img', { name: 'unsaved list changes' })).toBeVisible()
    await expect(wsListWidget(page, tabId).getByTestId('save-list')).toBeVisible()
  }
  await pick(page, 'Sort by', 'Name')
  await expect.poll(() => rowTitles(wsListWidget(page, 't2'))).toEqual(['Alpha', 'Charlie', 'Bravo'])
  await expect(summary).toHaveText('People · Name')
  // Changed rows are marked.
  await expect(popover.locator('[data-changed]')).toHaveText(['Group by', 'Sort by'])

  // The name is part of the draft: the tab titles follow it live.
  await popover.getByRole('textbox', { name: 'Name' }).fill('Team A')
  await expect(wsTab(page, 't2')).toContainText('Team A')

  await popover.getByRole('button', { name: 'Save list' }).click()
  await expect(popover).toHaveCount(0)
  await expect(summary).toBeFocused()
  await expect(wsListWidget(page, 't2').getByTestId('save-list')).toHaveCount(0)
  await expect.poll(async () => (await readListDefinitions(page)).find((d) => d.name === 'Team A')).toMatchObject({ grouping: 'people', sort: 'name' })
})

/** The unsaved-list question — never asked when Edit list closes. */
const unsavedPrompt = (page: Page) => page.getByRole('dialog', { name: /^Save changes to list/ })

test('no unsaved changes: a press in its own panel closes Edit list, and the press goes through', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const popover = await openFromTabMenu(page, 't1')
  const widget = wsListWidget(page, 't1')
  const row = widget.locator('[data-row-key]', { hasText: 'Charlie' })
  await row.locator('[data-task-title]').click()
  await expect(popover).toHaveCount(0)
  await expect(unsavedPrompt(page)).toHaveCount(0)
  await expect(row).toHaveAttribute('data-selected', 'true')

  // In another panel too: its checkbox completes the task (which then leaves the list).
  await openFromTabMenu(page, 't1')
  await wsListWidget(page, 't0').locator('[data-row-key]', { hasText: 'Alpha' }).getByRole('checkbox', { name: 'Mark complete' }).click()
  await expect(popover).toHaveCount(0)
  await expect.poll(async () => (await readStore<{ title: string; isCompleted: boolean }>(page, 'todos')).find((t) => t.title === 'Alpha')?.isCompleted).toBe(true)
})

test('an unsaved list: a press elsewhere closes Edit list at once, nothing asked, and goes through; the list stays unsaved', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const popover = await openFromTabMenu(page, 't1')
  await pick(page, 'Sort by', 'Name')
  const widget = wsListWidget(page, 't1')
  await expect.poll(() => rowTitles(widget)).toEqual(['Alpha', 'Bravo', 'Charlie'])

  // A press on a row in another panel: Edit list closes, the row is selected.
  const other = wsListWidget(page, 't0').locator('[data-row-key]', { hasText: 'Alpha' })
  await other.locator('[data-task-title]').click()
  await expect(popover).toHaveCount(0)
  await expect(unsavedPrompt(page)).toHaveCount(0)
  await expect(other).toHaveAttribute('data-selected', 'true')
  // The edit is the list's draft: the tab's dot, Revert · Save on the filter line, the rows as edited.
  await expect(wsTab(page, 't1').getByRole('img', { name: 'unsaved list changes' })).toBeVisible()
  await expect(widget.getByTestId('save-list')).toBeVisible()
  await expect.poll(() => rowTitles(widget)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  await expect.poll(async () => (await readListDefinitions(page)).find((d) => d.name === 'Team')).not.toMatchObject({ sort: 'name' })

  // A press on a row's checkbox in its own panel goes through as well.
  await openFromTabMenu(page, 't1')
  await widget.locator('[data-row-key]', { hasText: 'Charlie' }).getByRole('checkbox', { name: 'Mark complete' }).click()
  await expect(popover).toHaveCount(0)
  await expect.poll(async () => (await readStore<{ title: string; isCompleted: boolean }>(page, 'todos')).find((t) => t.title === 'Charlie')?.isCompleted).toBe(true)
})

test('an unsaved list: Settings opens at once, closing Edit list; the edit stays unsaved, and Save on the filter line writes it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const popover = await openFromTabMenu(page, 't1')
  await pick(page, 'Sort by', 'Name')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
  await expect(popover).toHaveCount(0)
  await expect(unsavedPrompt(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await wsListWidget(page, 't1').getByTestId('save-list').click()
  await expect(wsListWidget(page, 't1').getByTestId('save-list')).toHaveCount(0)
  await expect.poll(async () => (await readListDefinitions(page)).find((d) => d.name === 'Team')).toMatchObject({ sort: 'name' })
})

test('Esc and × close it at once while the list is unsaved (also for edits made before it opened), the draft kept', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  // An edit from outside Edit list: unsaved when it opens.
  await editListDraft(page, 'Team', { sort: 'name' })
  const popover = await openFromTabMenu(page, 't1')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(unsavedPrompt(page)).toHaveCount(0)

  await openFromTabMenu(page, 't1')
  await popover.getByRole('button', { name: 'Close Edit list' }).click()
  await expect(popover).toHaveCount(0)
  await expect(unsavedPrompt(page)).toHaveCount(0)
  await expect(wsListWidget(page, 't1').getByTestId('save-list')).toBeVisible()
  await expect(wsListWidget(page, 't2').getByTestId('save-list')).toBeVisible()
})

test('the summary toggles Edit list, unsaved or not', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const summary = wsListWidget(page, 't1').getByTestId('list-summary')
  await summary.click()
  const popover = editList(page)
  await expect(popover).toBeVisible()
  await summary.click()
  await expect(popover).toHaveCount(0)
  await summary.click()
  await pick(page, 'Sort by', 'Name')
  await summary.click()
  await expect(popover).toHaveCount(0)
  await expect(unsavedPrompt(page)).toHaveCount(0)
  await expect(wsListWidget(page, 't1').getByTestId('save-list')).toBeVisible()
})

test('Group by and Copy from… toggle their menus: a second press closes it, Edit list stays open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const popover = await openFromTabMenu(page, 't1')
  for (const [button, menu] of [['Group by', 'Group by'], ['Copy from…', 'Copy from']] as const) {
    const trigger = popover.getByRole('button', { name: new RegExp(`^${button}`) })
    await trigger.click()
    await expect(page.getByRole('menu', { name: menu })).toBeVisible()
    await trigger.click()
    await expect(page.getByRole('menu', { name: menu })).toHaveCount(0)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(popover).toBeVisible()
  }
})

test('Revert drops the edit and closes it, with Undo', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const popover = await openFromTabMenu(page, 't1')
  await pick(page, 'Group by', 'People')
  await expect(wsListWidget(page, 't1').getByTestId('save-list')).toBeVisible()
  await popover.getByRole('button', { name: 'Revert' }).click()
  await expect(popover).toHaveCount(0)
  await expect(wsListWidget(page, 't1').getByTestId('save-list')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(wsListWidget(page, 't1').getByTestId('save-list')).toBeVisible()
})

test('Esc closes it (after a menu inside) and returns focus to the summary; unsaved, too', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, { ...shared, listDefinitions: [{ name: 'Team', predicate: { searchText: 'a' } }, { name: 'Other' }] })
  const summary = wsListWidget(page, 't1').getByTestId('list-summary')
  await summary.click()
  const popover = editList(page)
  await popover.getByRole('button', { name: /^Group by/ }).click()
  await expect(page.getByRole('menu', { name: 'Group by' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Group by' })).toHaveCount(0)
  await expect(popover).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(summary).toBeFocused()

  await summary.click()
  await pick(page, 'Sort by', 'Name')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(summary).toBeFocused()
  await expect(summary).toHaveText('Name')
})

test('the filter line always shows (No filters + the summary); Revert · Save join it while unsaved; Revert drops the edit with Undo; reload keeps it unsaved', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const widget = wsListWidget(page, 't1')
  // Saved, nothing set: the line is there — No filters, + Filter and Manual — without Revert · Save.
  const saved = widget.getByTestId('list-filter-row')
  await expect(saved).toBeVisible()
  await expect(saved).toContainText('No filters')
  await expect(saved.getByRole('button', { name: /Filter/ }).first()).toBeVisible()
  await expect(saved.getByTestId('list-summary')).toHaveText('Manual')
  await expect(saved.getByTestId('save-list')).toHaveCount(0)
  await expect(saved.getByTestId('revert-list')).toHaveCount(0)
  // It takes room above the rows: the first row starts below it.
  const lineBox = await box(saved)
  expect((await box(widget.locator('[data-todo-id]').first())).y).toBeGreaterThanOrEqual(lineBox.y + lineBox.height - 1)

  await editListDraft(page, 'Team', { sort: 'priority' })
  const line = widget.getByTestId('list-filter-row')
  await expect(line).toContainText('No filters')
  await expect(line.getByTestId('list-summary')).toHaveText('Priority')
  // Order: summary · Revert · Save, at the line's right end.
  const [s, r, v] = await Promise.all([line.getByTestId('list-summary'), line.getByTestId('revert-list'), line.getByTestId('save-list')].map(box))
  expect(s!.x).toBeLessThan(r!.x)
  expect(r!.x).toBeLessThan(v!.x)
  await line.getByTestId('revert-list').hover()
  await expect(page.getByRole('tooltip')).toHaveText(/Revert to the saved list\s*Drops the unsaved changes · Undo in the snackbar/)

  // Reload: still unsaved, the line still there.
  await page.reload()
  await expect(wsListWidget(page, 't1').getByTestId('list-filter-row')).toContainText('No filters')
  await expect(wsListWidget(page, 't1').getByTestId('save-list')).toBeVisible()

  // Revert: Revert · Save gone in every widget (the line stays); Undo brings them back.
  await wsListWidget(page, 't1').getByTestId('revert-list').click()
  for (const tabId of ['t1', 't2']) {
    await expect(wsListWidget(page, tabId).getByTestId('save-list')).toHaveCount(0)
    await expect(wsListWidget(page, tabId).getByTestId('list-summary')).toHaveText('Manual')
  }
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(wsListWidget(page, 't2').getByTestId('save-list')).toBeVisible()
  await expect(wsListWidget(page, 't2').getByTestId('list-summary')).toHaveText('Priority')

  // Revert then reload: nothing unsaved comes back.
  await wsListWidget(page, 't2').getByTestId('revert-list').click()
  await page.reload()
  await expect(wsListWidget(page, 't1')).toBeVisible()
  await expect(wsListWidget(page, 't1').getByTestId('list-summary')).toHaveText('Manual')
  await expect(wsListWidget(page, 't1').getByTestId('save-list')).toHaveCount(0)
})

test('a narrow widget: Revert · Save become icon buttons, never hidden', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await seedWorkspace(page, {
    ...shared,
    listDefinitions: [{ name: 'Team', people: ['Alice', 'Bob'], predicate: { searchText: 'a long filter text' } }, { name: 'Other' }],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'wide', weight: 3, cells: [{ id: 'kw', tabs: [{ id: 'tw', kind: 'lens', listDefIdx: 1 }] }] },
        { id: 'narrow', weight: 1, cells: [{ id: 'kn', tabs: [{ id: 'tn', kind: 'lens', listDefIdx: 0 }] }] },
      ],
    }],
  })
  const narrow = wsListWidget(page, 'tn')
  expect((await box(narrow)).width).toBeLessThan(360)
  await editListDraft(page, 'Team', { sort: 'name' })
  const line = narrow.getByTestId('list-filter-row')
  for (const id of ['revert-list', 'save-list']) {
    const b = await box(line.getByTestId(id))
    expect([Math.round(b.width), Math.round(b.height)]).toEqual([24, 22])
    expect(b.x + b.width).toBeLessThanOrEqual((await box(line)).x + (await box(line)).width)
  }
  await expect(line.getByTestId('list-summary')).toBeHidden()
})
