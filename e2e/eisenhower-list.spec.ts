import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADD_FILTER, drag, readListDefinitions, seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * The Eisenhower's own list, in a real browser: every Eisenhower shows its
 * filter line (`No filters` = every task); editing it makes the list
 * unsaved — the tab's dot, Revert · Save — and Save writes it, still the
 * Eisenhower's; Edit list… from the tab menu
 * opens beside the panel and its Save is what the dashboard's Eisenhower
 * section counts; drags between quadrants still set the flags and "+" adds
 * with the list's defaults; an Eisenhower switched to List picks a list —
 * never the Eisenhower's; closing the last widget on its unsaved list asks
 * first; on a phone the tab's sheet has Edit list….
 */

const SEED: WorkspaceSeed = {
  statuses: ['Waiting'],
  listDefinitions: [{ name: 'Team' }, { name: 'Other' }],
  tasks: [
    { title: 'Waiting on legal', status: 'Waiting', urgent: true, important: true },
    { title: 'Fix checkout outage', urgent: true, important: true },
    { title: 'Draft OKRs', important: true },
    { title: 'Migrate blog' },
  ],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'lensTab', kind: 'lens', listDefIdx: 0 }] }] },
      { id: 'colB', weight: 2, cells: [{ id: 'b1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }, { id: 'notesTab', kind: 'notes' }] }] },
    ],
  }],
}

/** The Eisenhower's list is "Team" (made the Eisenhower's), no list tab on it. */
const ON_TEAM: WorkspaceSeed = {
  ...SEED,
  eisenhower: { listDefIdx: 0 },
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }, { id: 'notesTab', kind: 'notes' }] }] },
    ],
  }],
}

/** The stored Eisenhower list setting (`list:<id>`). */
async function storedSource(page: Page): Promise<string | undefined> {
  return (await readStore<{ key: string; value: string }>(page, 'settings')).find((r) => r.key === 'eisenhowerSource')?.value
}

/** The Eisenhower's own list as stored. */
async function eisenhowerList(page: Page) {
  const source = await storedSource(page)
  return (await readListDefinitions(page)).find((d) => `list:${d.id}` === source)
}

const widget = (page: Page) => page.locator('[data-eisenhower="eisTab"]')
const quadrant = (page: Page, q: string) => widget(page).locator(`[data-eis-quadrant="${q}"]`)
const row = (scope: Locator, title: string) => scope.locator('[data-row-key]').filter({ hasText: title })
const filterLine = (page: Page) => wsCell(page, 'b1').getByTestId('list-filter-row')
const unsavedDot = (tab: Locator) => tab.getByRole('img', { name: 'unsaved list changes' })

async function openTabMenu(page: Page, tabId: string): Promise<Locator> {
  await wsTab(page, tabId).click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Change widget' })
  await expect(menu).toBeVisible()
  return menu
}

/** + Filter › Status › (Is not) › Waiting on the Eisenhower's filter line. */
async function filterWaiting(page: Page, isNot: boolean): Promise<void> {
  await filterLine(page).getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Status' }).click()
  const picker = page.getByTestId('list-filter-picker')
  if (isNot) await picker.getByRole('radio', { name: 'Is not' }).click()
  await picker.getByRole('option', { name: 'Waiting' }).click()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('its own list’s filter line: Status is not Waiting; the tab unsaved; Save writes it, still the Eisenhower’s', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect(row(quadrant(page, 'do'), 'Waiting on legal')).toBeVisible()
    // Always there: no filter = every task; no group · sort summary.
    await expect(filterLine(page)).toContainText('No filters')
    await expect(filterLine(page).getByTestId('list-summary')).toHaveCount(0)
    const tab = wsTab(page, 'eisTab')
    await expect(tab).toHaveAttribute('title', 'Eisenhower')
    const menu = await openTabMenu(page, 'eisTab')
    await expect(menu).not.toContainText('Shows')
    await page.keyboard.press('Escape')

    await filterWaiting(page, true)
    await expect(row(quadrant(page, 'do'), 'Waiting on legal')).toHaveCount(0)
    await expect(row(quadrant(page, 'do'), 'Fix checkout outage')).toBeVisible()
    // The list tab shows another list: untouched.
    await expect(wsCell(page, 'a1').locator('[data-row-key]').filter({ hasText: 'Waiting on legal' })).toBeVisible()
    await expect(unsavedDot(tab)).toBeVisible()
    await expect(unsavedDot(wsTab(page, 'lensTab'))).toHaveCount(0)
    // An edit to a list, not to the layout.
    await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')

    const save = filterLine(page).getByTestId('save-list')
    await save.click()
    await expect(save).toHaveCount(0)
    await expect(unsavedDot(tab)).toHaveCount(0)
    const statuses = await readStore<{ id: number; name: string }>(page, 'statuses')
    const waiting = statuses.find((s) => s.name === 'Waiting')!.id
    await expect.poll(async () => ((await eisenhowerList(page))?.membership as { predicate: unknown } | undefined)?.predicate)
      .toMatchObject({ statusIds: [waiting], negate: { statusIds: true } })
    expect((await eisenhowerList(page))?.owner).toEqual({ eisenhower: true })

    // Kept across a reload.
    await page.reload()
    await expect(row(quadrant(page, 'do'), 'Fix checkout outage')).toBeVisible()
    await expect(row(quadrant(page, 'do'), 'Waiting on legal')).toHaveCount(0)
    await expect(filterLine(page)).toContainText('not Waiting')
  })

  test('Edit list… → a filter → Save list: the dashboard’s Eisenhower section counts what the widget shows', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] }] },
          { id: 'colC', cells: [{ id: 'c1', tabs: [{ id: 'dash', kind: 'dashboard', dashboard: { tiles: ['open'], sections: [{ id: 'eisenhower' }] } }] }] },
        ],
      }],
    })
    const dashDo = page.locator('[data-dashboard="dash"] [data-dash-section="eisenhower"] [data-eis-cell="do"]').getByTestId('dash-eis-count')
    await expect(dashDo).toHaveText('2')
    await (await openTabMenu(page, 'eisTab')).getByRole('menuitem', { name: 'Edit list…' }).click()
    const editList = page.getByTestId('edit-list')
    await expect(editList).toBeVisible()
    // Beside the panel, not over it.
    const panel = await box(wsCell(page, 'b1'))
    const popover = await box(editList)
    expect(popover.x >= panel.x + panel.width - 1 || popover.x + popover.width <= panel.x + 1).toBe(true)
    // Its filter, in Edit list's form: Status is Waiting.
    await editList.getByRole('button', { name: ADD_FILTER }).click()
    await page.getByRole('menuitem', { name: 'Status' }).click()
    await page.getByTestId('list-filter-picker').getByRole('option', { name: 'Waiting' }).click()
    // A click in Edit list closes the picker (it stays open).
    await editList.getByRole('textbox', { name: 'Name' }).click()
    await expect(page.getByTestId('list-filter-picker')).toHaveCount(0)
    // The draft counts already, in both.
    await expect(row(quadrant(page, 'do'), 'Fix checkout outage')).toHaveCount(0)
    await expect(dashDo).toHaveText('1')
    await editList.getByRole('button', { name: 'Save list' }).click()
    await expect(editList).toHaveCount(0)
    await expect(unsavedDot(wsTab(page, 'eisTab'))).toHaveCount(0)
    await expect(dashDo).toHaveText('1')
    await expect(row(quadrant(page, 'do'), 'Waiting on legal')).toBeVisible()
    await expect.poll(async () => ((await eisenhowerList(page))?.membership as { predicate: { statusIds: unknown } } | undefined)?.predicate.statusIds)
      .toHaveLength(1)
  })

  test('on its list: drags between quadrants set the flags', async ({ page }) => {
    await seedWorkspace(page, ON_TEAM)
    await expect(row(quadrant(page, 'schedule'), 'Draft OKRs')).toBeVisible()
    const from = await box(row(quadrant(page, 'schedule'), 'Draft OKRs'))
    await drag(page, { x: from.x + 12, y: from.y + from.height / 2 }, await pointIn(quadrant(page, 'do'), 0.5, 0.6), {
      during: async () => {
        await expect(quadrant(page, 'do').getByTestId('eisenhower-drop-preview')).toHaveText('+ Urgent')
      },
    })
    await expect(row(quadrant(page, 'do'), 'Draft OKRs')).toBeVisible()
    const okrs = (await readStore<{ title: string; urgent?: boolean; important?: boolean }>(page, 'todos')).find((t) => t.title === 'Draft OKRs')
    expect(okrs).toMatchObject({ urgent: true, important: true })
  })

  test('"+" on a list with no filter seeds the screen filter, from the pane alone', async ({ page }) => {
    await seedWorkspace(page, ON_TEAM)
    await quadrant(page, 'drop').hover()
    await quadrant(page, 'drop').getByRole('button', { name: 'Add task to Drop' }).click()
    await expect(page.getByRole('group', { name: 'What the task gets' })).toContainText('Adding to Drop')
    await expect(page.getByRole('group', { name: 'What the task gets' })).not.toContainText('Team')
    await page.keyboard.type('Tidy the backlog')
    await page.keyboard.press('Enter')
    await expect(row(quadrant(page, 'drop'), 'Tidy the backlog')).toBeVisible()
  })

  test('an Eisenhower switched to List shows a new list of the layout — never the Eisenhower’s —, its Edit list open; switched back it shows its list', async ({ page }) => {
    // "Other" is the layout's list: a tab of it shows it.
    await seedWorkspace(page, {
      ...ON_TEAM,
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }, { id: 'notesTab', kind: 'notes' }] }] },
          { id: 'colC', cells: [{ id: 'c1', tabs: [{ id: 'otherTab', kind: 'lens', listDefIdx: 1 }] }] },
        ],
      }],
    })
    await (await openTabMenu(page, 'eisTab')).getByRole('menuitemradio', { name: 'List' }).click()
    // No picker: a new blank list, its Edit list open beside the tab.
    await expect(page.getByText('Show list', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Edit list New list' })).toBeVisible()
    await expect(wsTab(page, 'eisTab')).toHaveAttribute('title', 'New list')
    await expect(wsCell(page, 'b1').locator('[data-list-widget="eisTab"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: /^Edit list/ })).toHaveCount(0)
    // Back to Eisenhower: its own list's filter line.
    await (await openTabMenu(page, 'eisTab')).getByRole('menuitemradio', { name: 'Eisenhower' }).click()
    await expect(widget(page)).toBeVisible()
    await expect(filterLine(page)).toContainText('No filters')
  })

  test('closing the last widget on its unsaved list asks first', async ({ page }) => {
    await seedWorkspace(page, ON_TEAM)
    await filterWaiting(page, false)
    await expect(unsavedDot(wsTab(page, 'eisTab'))).toBeVisible()

    await wsTab(page, 'eisTab').hover()
    await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Eisenhower' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save changes to list “Team”?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(wsTab(page, 'eisTab')).toBeVisible()
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the tab’s sheet: Edit list… and the urgent range; Edit list is the half sheet', async ({ page }) => {
    await seedWorkspace(page, ON_TEAM)
    await expect(widget(page)).toHaveAttribute('data-layout', 'stacked')
    await expect(filterLine(page)).toContainText('No filters')
    // Mobile browsers turn a long press into `contextmenu`.
    await wsTab(page, 'eisTab').dispatchEvent('contextmenu')
    const sheet = page.getByRole('menu', { name: 'Eisenhower' })
    await expect(sheet).toBeVisible()
    await expect(sheet).not.toContainText('Show')
    await expect(sheet.getByRole('menuitemradio', { name: /3 days/ })).toHaveAttribute('aria-checked', 'true')
    await sheet.getByRole('menuitem', { name: 'Edit list…' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Edit list Team' })).toBeVisible()
  })
})
