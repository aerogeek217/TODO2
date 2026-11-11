import { expect, test, type Page } from '@playwright/test'
import { openFilterPicker, setShowCompleted } from './fixtures/filters'
import { closeListFilterEditor, editListSave, expectOpenLayout, layoutTab, openListFilterEditor, ADD_FILTER, readListDefinitions, seedWorkspace, switchLayout, wsCell, wsListWidget, wsTab, type WorkspaceSeed, wsRow, expectLayoutStep } from './fixtures/workspace'

/**
 * List widgets in the workspace: the top-bar (screen) filter narrows them,
 * their own definition is edited in Edit list (opened from the filter line, which reads it in words),
 * drawn live while it is open and written for good by its Save (one undo
 * step); closing it with changes asks Save / Discard / Keep editing.
 * Nothing else ever asks: no unsaved marks, no prompt on a layout switch.
 */

const team: WorkspaceSeed = {
  people: ['Alice', 'Bob'],
  listDefinitions: [{ name: 'Team' }, { name: 'Other' }],
  tasks: [
    { title: 'Alice task', people: ['Alice'] },
    { title: 'Bob task', people: ['Bob'] },
  ],
  layouts: [
    {
      name: 'Main',
      columns: [
        { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] },
        { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 1 }] })] },
      ],
    },
    { name: 'Second', columns: [{ id: 'z', rows: [wsRow({ id: 'z1', tabs: [{ id: 'zt', kind: 'notes' }] })] }] },
  ],
}

function rows(page: Page, tabId: string) {
  return wsListWidget(page, tabId).locator('[data-todo-id]')
}

async function openEditList(page: Page, tabId: string): Promise<void> {
  await wsTab(page, tabId).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit list…' }).click()
  await expect(page.getByTestId('edit-list')).toBeVisible()
}

/** Picks `choice` in Edit list's `row` (Group by / Sort by / Prompt for). */
async function pickChoice(page: Page, row: string, choice: string): Promise<void> {
  await page.getByTestId('edit-list').getByRole('button', { name: new RegExp(`^${row}`) }).click()
  await page.getByRole('menuitemradio', { name: new RegExp(`^${choice}`) }).click()
}

test('a completed task comes back in a list widget when the top bar shows completed tasks', async ({ page }) => {
  await seedWorkspace(page, team)
  const widget = wsListWidget(page, 't1')
  await expect(rows(page, 't1')).toHaveCount(2)

  // Create a task: it shows in the widget.
  await page.keyboard.press('Control+Space')
  const quickAdd = page.getByRole('dialog', { name: 'Quick add task' })
  await quickAdd.getByPlaceholder('New task…').fill('Brand new task')
  await page.keyboard.press('Enter')
  await expect(quickAdd).toBeHidden()
  const row = widget.locator('[data-todo-id]', { hasText: 'Brand new task' })
  await expect(row).toBeVisible()

  // Complete it: it leaves the widget.
  await row.getByRole('checkbox').click()
  await expect(row).toHaveCount(0)

  // Top bar → Show completed: it is back; the list's line doesn't repeat the top bar's filter (J13).
  await setShowCompleted(page, true)
  await expect(row).toBeVisible()
  await expect(row.getByRole('checkbox')).toBeChecked()
  await expect(widget.getByTestId('list-filter-row')).toContainText('Every open task')
  await expect(widget.getByTestId('list-filter-row')).not.toContainText('Completed')
})

test('a screen filter narrows every list widget and shows the count as shown of total', async ({ page }) => {
  await seedWorkspace(page, team)
  await openFilterPicker(page, 'People')
  await page.getByRole('option', { name: 'Alice' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  for (const tabId of ['t1', 't2']) {
    await expect(rows(page, tabId)).toHaveCount(1)
    await expect(rows(page, tabId)).toContainText('Alice task')
  }
  await expect(wsListWidget(page, 't1').getByTestId('list-count')).toHaveText('1 of 2')
})

test('adding a filter in Edit list (opened from the line’s words) shows at once; its Save keeps it across a reload', async ({ page }) => {
  await seedWorkspace(page, team)
  const widget = wsListWidget(page, 't1')
  const editor = await openListFilterEditor(page, widget)
  await editor.getByRole('button', { name: ADD_FILTER }).click()
  await page.getByRole('menuitem', { name: 'People' }).click()
  const picker = page.getByTestId('list-filter-picker')
  await picker.getByRole('option', { name: 'Bob' }).click()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()

  await expect(editor.getByTestId('list-filter-chip')).toHaveText(/People\s*Bob/)
  // The list draws the draft live; nothing stored, nothing marked unsaved.
  await expect(rows(page, 't1')).toHaveCount(1)
  await expect(wsTab(page, 't1').getByRole('img', { name: 'unsaved list changes' })).toHaveCount(0)
  await expect(wsCell(page, 'k1').getByTestId('save-list')).toHaveCount(0)
  expect(((await readListDefinitions(page))[0]!.membership as { predicate: { personIds: unknown } }).predicate.personIds).toBeNull()
  await closeListFilterEditor(page)
  // The line reads it in words, with no chip to edit there.
  await expect(widget.getByTestId('list-filter-expression')).toHaveText(/Bob/)
  await expect(widget.getByTestId('list-filter-chip')).toHaveCount(0)
  await expect(page.getByText('Edited list “Team”')).toBeVisible()
  await expect.poll(async () => ((await readListDefinitions(page))[0]!.membership as { predicate: { personIds: unknown } }).predicate.personIds).not.toBeNull()
  await page.reload()
  await expect(rows(page, 't1')).toHaveCount(1)
  await expect(wsListWidget(page, 't1').getByTestId('list-filter-expression')).toHaveText(/Bob/)
})

test('a list’s date filters: a due-date range and Next follow-up Any both narrow it, saved as one clause per date type', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Dated' }],
    tasks: [
      { title: 'Soon with follow-up', dueInDays: 2, followupInDays: 3 },
      { title: 'Soon', dueInDays: 2 },
      { title: 'Later', dueInDays: 20 },
      { title: 'Undated' },
    ],
    layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
  })
  await setShowCompleted(page, true)
  const widget = wsListWidget(page, 't1')
  await expect(rows(page, 't1')).toHaveCount(4)

  // + Filter › Dates opens the panel on Due; due by today + 5 days, typed as a Calendar date.
  const inFive = new Date()
  inFive.setDate(inFive.getDate() + 5)
  const ymd = `${inFive.getFullYear()}-${String(inFive.getMonth() + 1).padStart(2, '0')}-${String(inFive.getDate()).padStart(2, '0')}`
  const editor = await openListFilterEditor(page, widget)
  await editor.getByRole('button', { name: ADD_FILTER }).click()
  await page.getByRole('menuitem', { name: 'Dates' }).click()
  const picker = page.getByTestId('list-filter-picker')
  await expect(picker.getByRole('tab', { name: 'Due' })).toHaveAttribute('aria-selected', 'true')
  await picker.getByRole('radio', { name: 'Calendar' }).click()
  await picker.getByLabel('To', { exact: true }).fill(ymd)
  await expect(rows(page, 't1')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()

  // + Filter › Dates opens on the first date type not filtering yet (Due filters): Next follow-up,
  // which writes nothing until Any.
  await editor.getByRole('button', { name: ADD_FILTER }).click()
  await page.getByRole('menuitem', { name: 'Dates' }).click()
  await expect(picker.getByRole('tab', { name: 'Next follow-up' })).toHaveAttribute('aria-selected', 'true')
  await expect(picker.getByRole('tab', { name: 'Due, filtering' })).toHaveAttribute('aria-selected', 'false')
  await expect(picker.getByRole('button', { name: 'To: No end' })).toBeVisible()
  await expect(rows(page, 't1')).toHaveCount(2)
  await picker.getByRole('radio', { name: 'Any' }).click()
  await expect(rows(page, 't1')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(editor.getByTestId('list-filter-chip')).toHaveText([/Due\s*on or before .+/, /Next follow-up\s*any date/])
  await closeListFilterEditor(page)

  await expect.poll(async () => ((await readListDefinitions(page))[0]!.membership as { predicate: { dates?: unknown } }).predicate.dates).toBeDefined()
  await page.reload()
  await expect(rows(page, 't1')).toHaveCount(1)
  const [stored] = await readListDefinitions(page)
  const predicate = (stored!.membership as { predicate: Record<string, unknown> }).predicate
  expect(predicate.dates).toEqual({
    deadline: { match: 'range', start: null, end: { kind: 'fixed', iso: expect.any(String) } },
    followup: { match: 'set' },
  })
  expect('dateField' in predicate).toBe(false)
})

test('Edit list from the tab menu groups the list; the edit is shared by every widget showing it', async ({ page }) => {
  await seedWorkspace(page, {
    ...team,
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] },
        { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 0 }] })] },
      ],
    }],
  })
  await openEditList(page, 't1')
  await pickChoice(page, 'Group by', 'People')
  await expect(page.getByTestId('edit-list')).toContainText('Shared · 2 widgets')

  for (const tabId of ['t1', 't2']) {
    await expect(wsListWidget(page, tabId).getByTestId('list-group-name')).toHaveText(['Alice', 'Bob'])
  }
  // Hovering isn't a press: Edit list stays open — and no tooltip opens beside it (UX cleanup 1A).
  await wsCell(page, 'k2').getByTestId('list-summary').hover()
  await page.waitForTimeout(700)
  await expect(page.getByTestId('edit-list')).toBeVisible()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  // Saved for both.
  await editListSave(page).click()
  await expect(page.getByTestId('edit-list')).toHaveCount(0)
  await expect.poll(async () => (await readListDefinitions(page)).find((d) => d.name === 'Team')?.grouping).toBe('people')
  for (const tabId of ['t1', 't2']) {
    await expect(wsListWidget(page, tabId).getByTestId('list-group-name')).toHaveText(['Alice', 'Bob'])
  }
})

test('an open Edit list with changes asks before a layout switch; with none, or once closed, nothing asks', async ({ page }) => {
  await seedWorkspace(page, team)
  await openEditList(page, 't1')
  await pickChoice(page, 'Sort by', 'Name')

  // A press on another layout's tab is a press elsewhere: the question, and the switch waits.
  await layoutTab(page, 'Second').click()
  const dialog = page.getByRole('dialog', { name: 'Save changes to list “Team”?' })
  await expect(dialog).toContainText('Your changes will be lost if you don’t save.')
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await expectOpenLayout(page, 'Main')
  await expect(page.getByTestId('edit-list')).toBeVisible()
  await layoutTab(page, 'Second').click()
  await dialog.getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByTestId('edit-list')).toHaveCount(0)
  await expectOpenLayout(page, 'Main')
  expect((await readListDefinitions(page)).find((d) => d.name === 'Team')?.sort).toBe('manual')

  // Edit list closed: switching asks nothing.
  await switchLayout(page, 'Second')
  await expectOpenLayout(page, 'Second')
  await expect(page.getByRole('dialog', { name: /^Save changes/ })).toHaveCount(0)
  await switchLayout(page, 'Main')
  await openEditList(page, 't1')
  await expect(page.getByTestId('edit-list').getByRole('button', { name: /^Sort by/ })).toHaveText('Manual')
})

test('closing a list’s last widget asks nothing: the list goes, Undo brings it back as saved', async ({ page }) => {
  await seedWorkspace(page, team)
  await openEditList(page, 't1')
  await pickChoice(page, 'Group by', 'People')
  await editListSave(page).click()
  await expect.poll(async () => (await readListDefinitions(page)).find((d) => d.name === 'Team')?.grouping).toBe('people')

  // Closing its only widget (alone in its cell: its grip › Close cell): no question.
  await wsTab(page, 't1').hover()
  await wsTab(page, 't1').getByRole('button', { name: 'Cell layout' }).click()
  await page.getByRole('menuitem', { name: 'Close cell', exact: true }).click()
  await expect(page.getByRole('dialog', { name: /^Save changes/ })).toHaveCount(0)
  await expect(wsTab(page, 't1')).toHaveCount(0)
  // Its last tab gone, the list goes at once; Undo brings it back, as saved.
  await expectLayoutStep(page, 'Closed cell “Team”')
  await expect.poll(async () => (await readListDefinitions(page)).some((d) => d.name === 'Team')).toBe(false)
  await page.locator('[data-snackbar-live]').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(wsTab(page, 't1')).toBeVisible()
  await expect.poll(async () => (await readListDefinitions(page)).find((d) => d.name === 'Team')?.grouping).toBe('people')

  // Leaving the workspace (the phone's Settings tab) asks nothing either.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/#\/settings$/)
})

test('prompt picks are temporary: empty again after a reload', async ({ page }) => {
  await seedWorkspace(page, {
    ...team,
    listDefinitions: [{ name: 'Team', runtimeFilter: { field: 'person' } }, { name: 'Other' }],
  })
  const widget = wsListWidget(page, 't1')
  await expect(widget).toContainText('Pick a person to show this list')
  // One number per list (2A): nothing picked is no count, not `—`.
  await expect(widget.getByTestId('list-count')).toHaveCount(0)
  await widget.getByLabel('Filter tasks by person').click()
  await page.getByRole('option', { name: 'Bob', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(rows(page, 't1')).toHaveCount(1)
  // Picking is not a list edit.
  expect((await readListDefinitions(page)).find((d) => d.name === 'Team')).not.toHaveProperty('picks')

  await page.reload()
  await expect(wsListWidget(page, 't1')).toContainText('Pick a person to show this list')
})

test('narrow widgets: the dates show as icons, the tags column gives way, the summary hides, titles keep room', async ({ page }) => {
  // The narrow column a quarter of the table: 281px (a whole px: the row's fit reads whole widths).
  await page.setViewportSize({ width: 1142, height: 800 })
  await seedWorkspace(page, {
    tags: ['home', 'work'],
    listDefinitions: [{ name: 'Mixed', predicate: { dates: { deadline: { match: 'set' } } } }],
    tasks: [{ title: 'A fairly long task title that must stay readable', tags: ['home', 'work'], dueInDays: 2, followupInDays: 5 }],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'wide', weight: 3, rows: [wsRow({ id: 'kw', tabs: [{ id: 'tw', kind: 'lens', listDefIdx: 0 }] })] },
        { id: 'narrow', weight: 1, rows: [wsRow({ id: 'kn', tabs: [{ id: 'tn', kind: 'lens', listDefIdx: 0 }] })] },
      ],
    }],
  })
  const narrow = wsListWidget(page, 'tn')
  const wide = wsListWidget(page, 'tw')
  expect((await narrow.boundingBox())!.width).toBeLessThan(360)
  expect((await wide.boundingBox())!.width).toBeGreaterThan(360)

  // Every row keeps its due and follow-up parts; the narrow one shows them as icons (the dates in the tooltips).
  for (const w of [wide, narrow]) await expect(w.locator('[data-row-cell="followup"]')).toHaveAttribute('data-followup', 'upcoming')
  await expect(wide.locator('[data-row-cell="dates"]')).toHaveAttribute('data-dates-tier', 'both')
  await expect(narrow.locator('[data-row-cell="dates"]')).toHaveAttribute('data-dates-tier', 'icons')
  expect(Math.round((await wide.locator('[data-row-cell="due"]').boundingBox())!.width)).toBe(45)
  expect(Math.round((await narrow.locator('[data-row-cell="due"]').boundingBox())!.width)).toBe(18)
  await expect(narrow.locator('[data-row-cell="due"]')).toHaveText('')
  await expect(narrow.locator('[data-row-cell="followup"]')).toHaveText('')
  await expect(wide.getByTestId('list-summary')).toBeVisible()
  await expect(narrow.getByTestId('list-summary')).toBeHidden()
  // The tags column gives way in the narrow widget; the title keeps 80px.
  await expect(wide.getByRole('button', { name: 'Tags: home, work', exact: true })).toBeVisible()
  await expect(narrow.locator('[data-row-cell="tags"]')).toHaveCount(0)
  const title = narrow.locator('[data-todo-id] [data-task-title^="A fairly long"]')
  expect((await title.boundingBox())!.width).toBeGreaterThanOrEqual(80)
})
