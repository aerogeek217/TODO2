import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADD_FILTER, seedWorkspace, wsCell, wsListWidget, wsTab, readListDefinitions, editListNow, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import { box, type Box } from './fixtures/geometry'
import { readStore } from './fixtures/db'
import { rowTitles } from './fixtures/seed'

/**
 * Edit list: one non-modal popover beside the list's panel that edits a
 * draft of the list, drawn live by every widget showing it; its Save writes
 * it for good (one undo step), Discard drops it, and closing it with
 * changes asks Save / Discard / Keep editing. The filter line always shows,
 * and never has Revert · Save.
 */

const editList = (page: Page) => page.getByTestId('edit-list')
const saveButton = (popover: Locator) => popover.getByRole('button', { name: 'Save', exact: true })

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
      { id: 'c0', rows: [wsRow({ id: 'k0', tabs: [{ id: 't0', kind: 'lens', listDefIdx: 1 }] })] },
      { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] },
      { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 0 }] })] },
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
    // 400 wide; 340 where only that fits beside the panel.
    expect(Math.round(p.width)).toBe(width === 1440 ? 400 : 340)
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
    layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
  })
  const popover = await openFromTabMenu(page, 't1')
  await expect(popover).toHaveAttribute('data-placement', 'below')
  const cell = await box(wsCell(page, 'k1'))
  const line = await box(wsListWidget(page, 't1').getByTestId('list-filter-row'))
  const p = await box(popover)
  expect(Math.round(p.y)).toBeGreaterThanOrEqual(Math.round(line.y + line.height))
  expect(Math.round(p.x + p.width)).toBe(Math.round(cell.x + cell.width - 6))
})

test('edits show live in every widget showing the list; the popover stays open; Save writes and closes it, one undo step', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  // Opened from the filter line's summary.
  const summary = wsListWidget(page, 't1').getByTestId('list-summary')
  await expect(summary).toHaveText('Manual')
  await summary.click()
  const popover = editList(page)
  await expect(popover).toBeVisible()
  await expect(popover.getByRole('textbox', { name: 'Name' })).toBeFocused()
  await expect(saveButton(popover)).toBeDisabled()
  await expect(popover.getByRole('button', { name: 'Discard' })).toBeEnabled()
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
    // No unsaved marks anywhere: the draft is Edit list's.
    await expect(wsTab(page, tabId).getByRole('img', { name: 'unsaved list changes' })).toHaveCount(0)
    await expect(wsListWidget(page, tabId).getByTestId('save-list')).toHaveCount(0)
  }
  await pick(page, 'Sort by', 'Name')
  await expect.poll(() => rowTitles(wsListWidget(page, 't2'))).toEqual(['Alpha', 'Charlie', 'Bravo'])
  await expect(summary).toHaveText('People · Name')
  // Changed rows are marked.
  await expect(popover.locator('[data-changed]')).toHaveText(['Group by', 'Sort by'])
  // Nothing stored yet.
  expect((await readListDefinitions(page)).find((d) => d.name === 'Team')).toMatchObject({ grouping: 'none', sort: 'manual' })

  // The name is part of the draft: the tab titles follow it live.
  await popover.getByRole('textbox', { name: 'Name' }).fill('Team A')
  await expect(wsTab(page, 't2')).toContainText('Team A')

  await saveButton(popover).click()
  await expect(popover).toHaveCount(0)
  await expect(summary).toBeFocused()
  await expect.poll(async () => (await readListDefinitions(page)).find((d) => d.name === 'Team A')).toMatchObject({ grouping: 'people', sort: 'name' })
  // One undo step, named in words: Undo puts the list back.
  await expect(page.getByText('Edited list “Team A”')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await readListDefinitions(page)).find((d) => d.name === 'Team')).toMatchObject({ grouping: 'none', sort: 'manual' })
  await expect(wsTab(page, 't2')).toContainText('Team')
})

/** The close question, asked while Edit list has changes. */
const unsavedPrompt = (page: Page) => page.getByRole('dialog', { name: /^Save changes to list/ })

/** Answers the close question. */
async function answer(page: Page, label: 'Save' | 'Discard' | 'Keep editing'): Promise<void> {
  await unsavedPrompt(page).getByRole('button', { name: label, exact: true }).click()
  await expect(unsavedPrompt(page)).toHaveCount(0)
}

test('no changes: a press in its own panel closes Edit list, and the press goes through', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const popover = await openFromTabMenu(page, 't1')
  const widget = wsListWidget(page, 't1')
  const row = widget.locator('[data-row-key]', { hasText: 'Charlie' })
  await row.locator('[data-title-text]').click()
  await expect(popover).toHaveCount(0)
  await expect(unsavedPrompt(page)).toHaveCount(0)
  await expect(row).toHaveAttribute('data-selected', 'true')

  // In another panel too: its checkbox completes the task (which then leaves the list).
  await openFromTabMenu(page, 't1')
  await wsListWidget(page, 't0').locator('[data-row-key]', { hasText: 'Alpha' }).getByRole('checkbox', { name: 'Mark complete' }).click()
  await expect(popover).toHaveCount(0)
  await expect.poll(async () => (await readStore<{ title: string; isCompleted: boolean }>(page, 'todos')).find((t) => t.title === 'Alpha')?.isCompleted).toBe(true)
})

test('with changes: a press elsewhere asks Save / Discard / Keep editing and goes no further', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const popover = await openFromTabMenu(page, 't1')
  await pick(page, 'Sort by', 'Name')
  const widget = wsListWidget(page, 't1')
  await expect.poll(() => rowTitles(widget)).toEqual(['Alpha', 'Bravo', 'Charlie'])

  // A press on a row in another panel: the question; the row isn't selected.
  const other = wsListWidget(page, 't0').locator('[data-row-key]', { hasText: 'Alpha' })
  await other.locator('[data-title-text]').click()
  await expect(unsavedPrompt(page)).toBeVisible()
  await expect(other).not.toHaveAttribute('data-selected', 'true')
  await answer(page, 'Keep editing')
  await expect(popover).toBeVisible()
  await expect.poll(() => rowTitles(widget)).toEqual(['Alpha', 'Bravo', 'Charlie'])

  // Again, Discard: closed, the list as stored, nothing written.
  await other.locator('[data-title-text]').click()
  await answer(page, 'Discard')
  await expect(popover).toHaveCount(0)
  await expect.poll(() => rowTitles(widget)).toEqual(['Bravo', 'Alpha', 'Charlie'])
  expect((await readListDefinitions(page)).find((d) => d.name === 'Team')?.sort).toBe('manual')
})

test('with changes: the gear asks first; Save writes the list (Settings opens with the next press)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const popover = await openFromTabMenu(page, 't1')
  await pick(page, 'Sort by', 'Name')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(unsavedPrompt(page)).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0)
  await answer(page, 'Save')
  await expect(popover).toHaveCount(0)
  await expect.poll(async () => (await readListDefinitions(page)).find((d) => d.name === 'Team')).toMatchObject({ sort: 'name' })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
})

test('with changes, Esc and × ask; with none they close at once', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const popover = await openFromTabMenu(page, 't1')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(unsavedPrompt(page)).toHaveCount(0)

  await openFromTabMenu(page, 't1')
  await pick(page, 'Sort by', 'Name')
  await popover.getByRole('textbox', { name: 'Name' }).focus()
  await page.keyboard.press('Escape')
  await answer(page, 'Keep editing')
  await expect(popover).toBeVisible()
  await popover.getByRole('button', { name: 'Close Edit list' }).click()
  await answer(page, 'Save')
  await expect(popover).toHaveCount(0)
  await expect.poll(async () => (await readListDefinitions(page)).find((d) => d.name === 'Team')).toMatchObject({ sort: 'name' })
  for (const tabId of ['t1', 't2']) await expect(wsListWidget(page, tabId).getByTestId('list-summary')).toHaveText('Name')
})

test('the summary toggles Edit list; with changes the second press asks', async ({ page }) => {
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
  await answer(page, 'Discard')
  await expect(popover).toHaveCount(0)
  await expect(summary).toHaveText('Manual')
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

test('Discard drops the edit and closes it, writing nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const popover = await openFromTabMenu(page, 't1')
  await pick(page, 'Group by', 'People')
  await expect(wsListWidget(page, 't1').getByTestId('list-group-name')).toHaveText(['Alice', 'Bob'])
  await popover.getByRole('button', { name: 'Discard' }).click()
  await expect(popover).toHaveCount(0)
  await expect(wsListWidget(page, 't1').getByTestId('list-group-name')).toHaveCount(0)
  expect((await readListDefinitions(page)).find((d) => d.name === 'Team')?.grouping).toBe('none')
})

test('Esc closes it (after a menu inside) and returns focus to the summary', async ({ page }) => {
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
})

test('the filter line always shows (Every open task + the summary), never Revert · Save; a saved edit survives a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, shared)
  const widget = wsListWidget(page, 't1')
  // Nothing set: the line is there — `Every open task` in words (no + Filter, 2A) and Manual.
  const line = widget.getByTestId('list-filter-row')
  await expect(line).toBeVisible()
  await expect(line).toContainText('Every open task')
  await expect(line.getByRole('button', { name: ADD_FILTER })).toHaveCount(0)
  await expect(line.getByTestId('list-summary')).toHaveText('Manual')
  // It takes room above the rows: the first row starts below it.
  const lineBox = await box(line)
  expect((await box(widget.locator('[data-todo-id]').first())).y).toBeGreaterThanOrEqual(lineBox.y + lineBox.height - 1)

  await editListNow(page, 'Team', { sort: 'priority' })
  await expect(line.getByTestId('list-summary')).toHaveText('Priority')
  await expect(line.getByTestId('save-list')).toHaveCount(0)
  await expect(line.getByTestId('revert-list')).toHaveCount(0)
  await page.reload()
  for (const tabId of ['t1', 't2']) await expect(wsListWidget(page, tabId).getByTestId('list-summary')).toHaveText('Priority')
})

test('the filter line reads the list’s filter in words; a click on them opens Edit list, a second closes it (2A)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, { ...shared, listDefinitions: [{ name: 'Team', people: ['Alice'] }, { name: 'Other' }] })
  const line = wsListWidget(page, 't1').getByTestId('list-filter-row')
  // Words, muted, one line: no chips, no ×, no + Filter.
  const words = line.getByTestId('list-filter-expression')
  await expect(words).toContainText('Alice')
  await expect(line.getByTestId('list-filter-chip')).toHaveCount(0)
  await expect(line.getByRole('button', { name: 'Remove filter' })).toHaveCount(0)
  await expect(line.getByRole('button', { name: ADD_FILTER })).toHaveCount(0)
  const b = await box(words)
  expect(b.height).toBeLessThanOrEqual(22.5)
  await words.click()
  await expect(editList(page)).toBeVisible()
  await expect(editList(page).getByTestId('list-filter-chip')).toHaveText(/People\s*Alice/)
  await words.click()
  await expect(editList(page)).toHaveCount(0)
  // An empty filter reads Every open task, and opens Edit list the same way.
  await wsListWidget(page, 't0').getByRole('button', { name: 'Every open task' }).click()
  await expect(editList(page)).toBeVisible()
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the filter line reads in words; a tap opens Edit list (its sheet)', async ({ page }) => {
    await seedWorkspace(page, {
      ...shared,
      listDefinitions: [{ name: 'Team', people: ['Alice'] }],
      layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
    })
    const line = wsCell(page, 'k1').getByTestId('list-filter-row')
    await expect(line.getByTestId('list-filter-chip')).toHaveCount(0)
    await line.getByTestId('list-filter-expression').tap()
    await expect(editList(page)).toBeVisible()
    await expect(editList(page).getByTestId('list-filter-chip')).toHaveText(/People\s*Alice/)
  })
})