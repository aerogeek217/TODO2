import { expect, test, type Page } from '@playwright/test'
import { openSettings, readListDefinitions, seedWorkspace, wsCell, wsListWidget, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { box } from './fixtures/geometry'
import { rowTitles } from './fixtures/seed'

/**
 * A list's sort direction: Edit list's ↑ / ↓ toggle beside Sort by (none for
 * Manual) re-sorts the list live in every widget showing it, the filter
 * line's summary shows `↓`, and the direction saves, reloads and reverts
 * like the list's other edits. Lists drilled from the dashboard follow it.
 */

const ASCENDING = ['Overdue', 'Soon', 'Later', 'Undated']
const DESCENDING = ['Later', 'Soon', 'Overdue', 'Undated']

function seed(list: NonNullable<WorkspaceSeed['listDefinitions']>[number]): WorkspaceSeed {
  return {
    listDefinitions: [list],
    tasks: [
      { title: 'Soon', dueInDays: 1 },
      { title: 'Undated' },
      { title: 'Later', dueInDays: 5 },
      { title: 'Overdue', dueInDays: -2 },
    ],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] },
        { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 0 }] }] },
        { id: 'c3', cells: [{ id: 'k3', tabs: [{ id: 'dash', kind: 'dashboard', dashboard: { listTileIdxs: [0] } }] }] },
      ],
    }],
  }
}

const editList = (page: Page) => page.getByTestId('edit-list')
const toggle = (page: Page) => editList(page).getByRole('button', { name: 'Sort descending' })
const summary = (page: Page, tabId: string) => wsListWidget(page, tabId).getByTestId('list-summary')

async function pickSort(page: Page, choice: string): Promise<void> {
  await editList(page).getByRole('button', { name: /^Sort by/ }).click()
  await page.getByRole('menuitemradio', { name: new RegExp(`^${choice}`) }).click()
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('the toggle re-sorts the list live in every widget, shows ↓ in the summary, and saves through a reload', async ({ page }) => {
    await seedWorkspace(page, seed({ name: 'Team' }))
    await summary(page, 't1').click()
    await expect(editList(page)).toBeVisible()
    // Manual has no direction.
    await expect(toggle(page)).toHaveCount(0)

    await pickSort(page, 'Due date')
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => rowTitles(wsListWidget(page, 't2'))).toEqual(ASCENDING)
    // Beside Sort by, on its row.
    const [select, arrow] = await Promise.all([box(editList(page).getByRole('button', { name: /^Sort by/ })), box(toggle(page))])
    expect(arrow.x).toBeGreaterThan(select.x + select.width - 1)
    expect(Math.abs((arrow.y + arrow.height / 2) - (select.y + select.height / 2))).toBeLessThan(2)
    await toggle(page).hover()
    await expect(page.getByRole('tooltip')).toHaveText(/Soonest first\s*Click to reverse/)

    await toggle(page).click()
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
    for (const tabId of ['t1', 't2']) {
      await expect.poll(() => rowTitles(wsListWidget(page, tabId))).toEqual(DESCENDING)
      await expect(summary(page, tabId)).toHaveText('Due date ↓')
      await expect(wsListWidget(page, tabId).getByTestId('save-list')).toBeVisible()
    }
    await expect(editList(page).locator('[data-changed]')).toHaveText(['Sort by'])

    // Keyboard: Space and Enter toggle it.
    await expect(toggle(page)).toBeFocused()
    await page.keyboard.press('Space')
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(summary(page, 't1')).toHaveText('Due date')
    await expect.poll(() => rowTitles(wsListWidget(page, 't1'))).toEqual(ASCENDING)
    await page.keyboard.press('Enter')
    await expect(summary(page, 't1')).toHaveText('Due date ↓')

    await page.keyboard.press('Escape')
    await expect(editList(page)).toHaveCount(0)
    await wsListWidget(page, 't1').getByTestId('save-list').click()
    await expect(wsListWidget(page, 't1').getByTestId('save-list')).toHaveCount(0)
    const [stored] = await readListDefinitions(page)
    expect(stored).toMatchObject({ sort: 'deadline', sortDirection: 'desc' })

    await page.reload()
    await expect(summary(page, 't2')).toHaveText('Due date ↓')
    await expect.poll(() => rowTitles(wsListWidget(page, 't2'))).toEqual(DESCENDING)
    await expect(wsListWidget(page, 't2').getByTestId('save-list')).toHaveCount(0)

    // Switching to Manual drops the direction: no toggle, no arrow.
    await summary(page, 't2').click()
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
    await pickSort(page, 'Manual')
    await expect(toggle(page)).toHaveCount(0)
    await expect(summary(page, 't2')).toHaveText('Manual')
  })

  test('a saved descending list: reversing it is an unsaved edit that Revert undoes (with Undo); reversing it back is no edit', async ({ page }) => {
    await seedWorkspace(page, seed({ name: 'Team', sort: 'deadline', sortDirection: 'desc' }))
    await expect(summary(page, 't1')).toHaveText('Due date ↓')
    await expect.poll(() => rowTitles(wsListWidget(page, 't1'))).toEqual(DESCENDING)

    await summary(page, 't1').click()
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
    await toggle(page).click()
    await expect(summary(page, 't1')).toHaveText('Due date')
    await expect.poll(() => rowTitles(wsListWidget(page, 't1'))).toEqual(ASCENDING)
    await page.keyboard.press('Escape')

    await wsListWidget(page, 't1').getByTestId('revert-list').click()
    for (const tabId of ['t1', 't2']) {
      await expect(summary(page, tabId)).toHaveText('Due date ↓')
      await expect.poll(() => rowTitles(wsListWidget(page, tabId))).toEqual(DESCENDING)
      await expect(wsListWidget(page, tabId).getByTestId('save-list')).toHaveCount(0)
    }
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(summary(page, 't2')).toHaveText('Due date')
    await expect.poll(() => rowTitles(wsListWidget(page, 't2'))).toEqual(ASCENDING)

    // Back to the saved direction: nothing unsaved.
    await summary(page, 't2').click()
    await toggle(page).click()
    await expect(summary(page, 't2')).toHaveText('Due date ↓')
    await expect(wsListWidget(page, 't2').getByTestId('save-list')).toHaveCount(0)
    await expect(wsTab(page, 't2').getByRole('img', { name: 'unsaved list changes' })).toHaveCount(0)
  })

  test('the dashboard list tile’s task dialog lists the tasks in the list’s direction', async ({ page }) => {
    await seedWorkspace(page, seed({ name: 'Team', sort: 'deadline', sortDirection: 'desc' }))
    await page.locator('[data-dashboard="dash"]').locator('[data-dash-list-tile]').click()
    const dialog = page.locator('[data-task-dialog]')
    await expect(dialog).toBeVisible()
    await expect.poll(() => rowTitles(dialog)).toEqual(DESCENDING)
  })

  test('Settings › Lists: the same toggle beside Sort by; Save list writes the direction', async ({ page }) => {
    await seedWorkspace(page, seed({ name: 'Team', sort: 'name' }))
    const settings = await openSettings(page, 'People, statuses & tags')
    await settings.getByRole('button', { name: 'Manage lists…' }).click()
    await page.getByRole('dialog', { name: 'Lists', exact: true }).getByTitle('Edit list').first().click()
    const editor = page.getByRole('dialog', { name: /Edit list:/ })
    const arrow = editor.getByRole('button', { name: 'Sort descending' })
    await expect(arrow).toHaveAttribute('aria-pressed', 'false')
    await arrow.click()
    await expect(arrow).toHaveAttribute('aria-pressed', 'true')
    await expect(editor.locator('[data-changed]')).toHaveText(['Sort by'])
    await editor.getByRole('button', { name: 'Save list' }).click()
    await expect(editor).toHaveCount(0)
    await expect.poll(async () => (await readListDefinitions(page))[0]).toMatchObject({ sort: 'name', sortDirection: 'desc' })
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the Edit list sheet has the toggle at the end of the Sort by row; the list behind re-sorts', async ({ page }) => {
    await seedWorkspace(page, seed({ name: 'Team', sort: 'deadline' }))
    await wsTab(page, 't1').dispatchEvent('contextmenu')
    await page.getByRole('menu', { name: 'List' }).getByRole('menuitem', { name: 'Edit list…' }).click()
    const sheet = page.getByRole('dialog', { name: 'Edit list Team' })
    await expect(sheet).toBeVisible()
    const row = sheet.getByRole('button', { name: 'Sort by: Due date' })
    const arrow = sheet.getByRole('button', { name: 'Sort descending' })
    const [r, a] = await Promise.all([box(row), box(arrow)])
    expect(a.x).toBeGreaterThan(r.x + r.width - 1)
    expect(Math.abs((a.y + a.height / 2) - (r.y + r.height / 2))).toBeLessThan(2)
    // Phone rows: the task's title is in the row's text.
    const order = async () => (await wsCell(page, 'k1').locator('[data-todo-id]').allTextContents())
      .map((text) => ASCENDING.find((title) => text.includes(title)) ?? text)
    await expect.poll(order).toEqual(ASCENDING)
    await arrow.click()
    await expect(arrow).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(order).toEqual(DESCENDING)
  })
})
