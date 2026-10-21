import { expect, test, type Page } from '@playwright/test'
import { expectOpenLayout, openSettings, readListDefinitions, seedWorkspace, switchLayout, wsCell, wsListWidget, wsTab, type WorkspaceSeed, editListDraft } from './fixtures/workspace'

/**
 * List widgets in the workspace: the top-bar (screen) filter narrows them,
 * their own definition is edited in place (filter row, Edit list) and
 * stays unsaved — dot on the tab, Revert · Save on the filter line, a prompt
 * before the edits would be lost — until saved.
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
        { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] },
        { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 1 }] }] },
      ],
    },
    { name: 'Second', columns: [{ id: 'z', cells: [{ id: 'z1', tabs: [{ id: 'zt', kind: 'notes' }] }] }] },
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

  // Top bar → Show completed: it is back, and the widget shows the screen filter.
  await page.getByRole('button', { name: 'Show completed' }).click()
  await expect(row).toBeVisible()
  await expect(row.getByRole('checkbox')).toBeChecked()
  await expect(widget.getByTestId('screen-filter-chip')).toHaveText(/Completed shown/)
})

test('a screen filter narrows every list widget and shows the count as shown of total', async ({ page }) => {
  await seedWorkspace(page, team)
  await page.getByRole('button', { name: 'People filter' }).click()
  await page.locator('label', { hasText: '@Alice' }).click()
  await page.keyboard.press('Escape')
  for (const tabId of ['t1', 't2']) {
    await expect(rows(page, tabId)).toHaveCount(1)
    await expect(rows(page, tabId)).toContainText('Alice task')
  }
  await expect(wsTab(page, 't1')).toContainText('1 of 2')
})

test('adding a filter from the filter row makes the list unsaved; saving keeps it across a reload', async ({ page }) => {
  await seedWorkspace(page, team)
  // A screen filter shows the filter row (with its + Filter).
  await page.getByRole('button', { name: 'Show completed' }).click()
  const widget = wsListWidget(page, 't1')
  await widget.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'People' }).click()
  const picker = page.getByTestId('list-filter-picker')
  await picker.locator('label', { hasText: '@Bob' }).click()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()

  await expect(widget.getByTestId('list-filter-chip')).toHaveText(/People\s*Bob/)
  await expect(rows(page, 't1')).toHaveCount(1)
  await expect(wsTab(page, 't1').getByRole('img', { name: 'unsaved list changes' })).toBeVisible()
  const save = wsCell(page, 'k1').getByTestId('save-list')
  await expect(save).toBeVisible()

  await save.click()
  await expect(save).toBeHidden()
  await expect(wsTab(page, 't1').getByRole('img', { name: 'unsaved list changes' })).toHaveCount(0)
  await page.reload()
  await expect(rows(page, 't1')).toHaveCount(1)
  await expect(wsListWidget(page, 't1').getByTestId('list-filter-chip')).toHaveText(/People\s*Bob/)
})

test('a list’s date filters: a due-date range and Follow-up Has a date both narrow it, saved as one clause per date type', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Dated' }],
    tasks: [
      { title: 'Soon with follow-up', dueInDays: 2, followupInDays: 3 },
      { title: 'Soon', dueInDays: 2 },
      { title: 'Later', dueInDays: 20 },
      { title: 'Undated' },
    ],
    layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
  })
  await page.getByRole('button', { name: 'Show completed' }).click()
  const widget = wsListWidget(page, 't1')
  await expect(rows(page, 't1')).toHaveCount(4)

  // + Filter › Dates opens the panel on Due; due by today + 5 days.
  const inFive = new Date()
  inFive.setDate(inFive.getDate() + 5)
  const ymd = `${inFive.getFullYear()}-${String(inFive.getMonth() + 1).padStart(2, '0')}-${String(inFive.getDate()).padStart(2, '0')}`
  await widget.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Dates' }).click()
  const picker = page.getByTestId('list-filter-picker')
  await expect(picker.getByRole('tab', { name: 'Due' })).toHaveAttribute('aria-selected', 'true')
  await picker.getByLabel('To', { exact: true }).fill(ymd)
  await expect(rows(page, 't1')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()

  // + Filter › Dates opens on Due again (it filters); the Follow-up tab writes nothing until Has a date.
  await widget.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Dates' }).click()
  await expect(picker.getByRole('tab', { name: 'Due, filtering' })).toHaveAttribute('aria-selected', 'true')
  await picker.getByRole('tab', { name: 'Follow-up' }).click()
  await expect(picker.getByRole('tab', { name: 'Follow-up' })).toHaveAttribute('aria-selected', 'true')
  await expect(picker.getByLabel('To', { exact: true })).toHaveValue('')
  await expect(rows(page, 't1')).toHaveCount(2)
  await picker.getByRole('radio', { name: 'Has a date' }).click()
  await expect(rows(page, 't1')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(widget.getByTestId('list-filter-chip')).toHaveText([/Due\s*by .+/, /Follow-up\s*has a date/])

  await wsCell(page, 'k1').getByTestId('save-list').click()
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
        { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] },
        { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 0 }] }] },
      ],
    }],
  })
  await openEditList(page, 't1')
  await pickChoice(page, 'Group by', 'People')
  await expect(page.getByTestId('edit-list')).toContainText('Shared · 2 widgets')

  for (const tabId of ['t1', 't2']) {
    await expect(wsListWidget(page, tabId).getByTestId('list-group-name')).toHaveText(['Alice', 'Bob'])
    await expect(wsTab(page, tabId).getByRole('img', { name: 'unsaved list changes' })).toBeVisible()
  }
  // Hovering isn't a press: Edit list stays open.
  await wsCell(page, 'k1').getByTestId('save-list').hover()
  await expect(page.getByRole('tooltip')).toHaveText(/Save list “Team”\s*Shared · shown in 2 widgets/)
})

test('switching layouts with an unsaved list asks first; Discard drops the edit', async ({ page }) => {
  await seedWorkspace(page, team)
  await editListDraft(page, 'Team', { sort: 'name' })

  await switchLayout(page, 'Second')
  const dialog = page.getByRole('dialog', { name: 'Save changes to list “Team”?' })
  await expect(dialog).toContainText('Your changes will be lost if you don’t save.')
  await dialog.getByRole('button', { name: /Cancel/ }).click()
  await expectOpenLayout(page, 'Main')

  // Also make the layout unsaved: one combined prompt with a row each.
  await wsTab(page, 't2').getByRole('button', { name: 'Close Other' }).click()
  await switchLayout(page, 'Second')
  const combined = page.getByRole('dialog', { name: 'Save your changes?' })
  await expect(combined).toContainText('You’re switching to layout “Second”.')
  await expect(combined.getByRole('checkbox')).toHaveCount(2)
  await combined.getByRole('button', { name: 'Discard all' }).click()
  await expectOpenLayout(page, 'Second')

  await switchLayout(page, 'Main')
  await expect(wsTab(page, 't2')).toBeVisible()
  await openEditList(page, 't1')
  await expect(page.getByTestId('edit-list').getByRole('button', { name: /^Sort by/ })).toHaveText('Manual')
})

test('closing the last widget of an unsaved list asks first; leaving the workspace too', async ({ page }) => {
  await seedWorkspace(page, team)
  await editListDraft(page, 'Team', { grouping: 'people' })

  // Opening Settings (Edit list closed) never asks; leaving the workspace (the phone's Settings tab) does.
  await openSettings(page)
  await page.keyboard.press('Escape')
  const dialog = page.getByRole('dialog', { name: 'Save changes to list “Team”?' })
  await expect(dialog).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Cancel/ }).click()
  await expect(page).toHaveURL(/#\/$/)
  await page.setViewportSize({ width: 1280, height: 800 })

  // Closing its only widget: Save writes the list, then closes the tab.
  await wsTab(page, 't1').getByRole('button', { name: 'Close Team' }).click()
  await dialog.getByRole('button', { name: 'Save list' }).click()
  await expect(wsTab(page, 't1')).toHaveCount(0)
  await expect.poll(async () => (await readListDefinitions(page)).find((d) => d.name === 'Team')?.grouping).toBe('people')
})

test('prompt picks are temporary: empty again after a reload', async ({ page }) => {
  await seedWorkspace(page, {
    ...team,
    listDefinitions: [{ name: 'Team', runtimeFilter: { field: 'person' } }, { name: 'Other' }],
  })
  const widget = wsListWidget(page, 't1')
  await expect(widget).toContainText('Pick a person to show this list')
  await expect(wsTab(page, 't1')).toContainText('—')
  await widget.getByLabel('Filter tasks by person').click()
  await page.getByRole('button', { name: 'Bob', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(rows(page, 't1')).toHaveCount(1)
  // Picking is not a list edit.
  await expect(wsCell(page, 'k1').getByTestId('save-list')).toHaveCount(0)

  await page.reload()
  await expect(wsListWidget(page, 't1')).toContainText('Pick a person to show this list')
})

test('narrow widgets: the dates show as icons, the tags column gives way, the summary hides, titles keep room', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await seedWorkspace(page, {
    tags: ['home', 'work'],
    listDefinitions: [{ name: 'Mixed', predicate: { dates: { deadline: { match: 'set' } } } }],
    tasks: [{ title: 'A fairly long task title that must stay readable', tags: ['home', 'work'], dueInDays: 2, followupInDays: 5 }],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'wide', weight: 3, cells: [{ id: 'kw', tabs: [{ id: 'tw', kind: 'lens', listDefIdx: 0 }] }] },
        { id: 'narrow', weight: 1, cells: [{ id: 'kn', tabs: [{ id: 'tn', kind: 'lens', listDefIdx: 0 }] }] },
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
  expect(Math.round((await wide.locator('[data-row-cell="due"]').boundingBox())!.width)).toBe(55)
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
