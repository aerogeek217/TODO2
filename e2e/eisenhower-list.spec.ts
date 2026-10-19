import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, readListDefinitions, seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * An Eisenhower tab on a saved list, in a real browser: the tab menu's
 * Show › picks the list (the tab takes its name); the list's filter line
 * above the quadrants edits the list — every widget showing it gets the
 * unsaved dot, and Save writes it; drags between quadrants still set the
 * flags; a list tab switched to Eisenhower keeps its list; closing the last
 * widget on an unsaved list asks first; on a phone the tab's sheet has
 * Edit list….
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

/** `SEED` with the Eisenhower tab already on the Team list. */
const ON_TEAM: WorkspaceSeed = {
  ...SEED,
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'eisTab', kind: 'eisenhower', listDefIdx: 0 }, { id: 'notesTab', kind: 'notes' }] }] },
    ],
  }],
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

test.describe('desktop', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('Show › a list; Status is not Waiting from the widget’s filter line; both tabs unsaved; Save', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect(row(quadrant(page, 'do'), 'Waiting on legal')).toBeVisible()
    await expect(wsTab(page, 'eisTab')).toContainText('Eisenhower')
    await expect(filterLine(page)).toHaveCount(0)

    const menu = await openTabMenu(page, 'eisTab')
    const show = menu.getByRole('menuitem', { name: /^Show/ })
    await expect(show).toContainText('All tasks')
    await show.hover()
    const sub = page.getByRole('menu', { name: 'Show' })
    await expect(sub.getByRole('menuitemradio', { name: 'All tasks' })).toHaveAttribute('aria-checked', 'true')
    await sub.getByRole('menuitemradio', { name: 'Team' }).click()
    await expect(menu).toHaveCount(0)

    // The tab is titled by its list, the kind in its tooltip; the layout is unsaved.
    const tab = wsTab(page, 'eisTab')
    await expect(tab).toContainText('Team')
    await expect(tab).toHaveAttribute('title', 'Eisenhower · Team')
    await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')
    // The list's filter line, without the group · sort summary.
    await expect(filterLine(page)).toContainText('No filters')
    await expect(filterLine(page).getByTestId('list-summary')).toHaveCount(0)

    // + Filter › Status › Is not › Waiting: the Waiting task leaves the quadrants (and the list tab).
    await filterLine(page).getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Status' }).click()
    const picker = page.getByTestId('list-filter-picker')
    await picker.getByRole('radio', { name: 'Is not' }).click()
    await picker.locator('label', { hasText: 'Waiting' }).click()
    await expect(row(quadrant(page, 'do'), 'Waiting on legal')).toHaveCount(0)
    await expect(row(quadrant(page, 'do'), 'Fix checkout outage')).toBeVisible()
    await expect(wsCell(page, 'a1').locator('[data-row-key]').filter({ hasText: 'Waiting on legal' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(tab).toContainText('3')

    // Both widgets showing the list say it is unsaved.
    await expect(unsavedDot(tab)).toBeVisible()
    await expect(unsavedDot(wsTab(page, 'lensTab'))).toBeVisible()
    const save = filterLine(page).getByTestId('save-list')
    await save.click()
    await expect(save).toHaveCount(0)
    await expect(unsavedDot(tab)).toHaveCount(0)
    await expect(unsavedDot(wsTab(page, 'lensTab'))).toHaveCount(0)
    const statuses = await readStore<{ id: number; name: string }>(page, 'statuses')
    const waiting = statuses.find((s) => s.name === 'Waiting')!.id
    await expect.poll(async () => ((await readListDefinitions(page)).find((d) => d.name === 'Team')?.membership as { predicate: unknown }).predicate)
      .toMatchObject({ statusIds: [waiting], negate: { statusIds: true } })

    // Show › All tasks: every task again, no filter line.
    await (await openTabMenu(page, 'eisTab')).getByRole('menuitem', { name: /^Show/ }).hover()
    await page.getByRole('menu', { name: 'Show' }).getByRole('menuitemradio', { name: 'All tasks' }).click()
    await expect(row(quadrant(page, 'do'), 'Waiting on legal')).toBeVisible()
    await expect(tab).toContainText('Eisenhower')
    await expect(filterLine(page)).toHaveCount(0)
  })

  test('on a list: drags between quadrants set the flags; "+" adds to the list', async ({ page }) => {
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

    await quadrant(page, 'drop').hover()
    await quadrant(page, 'drop').getByRole('button', { name: 'Add task to Drop' }).click()
    await expect(page.getByRole('group', { name: 'What the task gets' })).toContainText('Adding to Drop · Team')
    await page.keyboard.type('Tidy the backlog')
    await page.keyboard.press('Enter')
    await expect(row(quadrant(page, 'drop'), 'Tidy the backlog')).toBeVisible()
  })

  test('Edit list… from the tab menu opens Edit list beside the panel', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'lensTab', kind: 'lens', listDefIdx: 1 }] }] },
          { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'eisTab', kind: 'eisenhower', listDefIdx: 0 }] }] },
        ],
      }],
    })
    await (await openTabMenu(page, 'eisTab')).getByRole('menuitem', { name: 'Edit list…' }).click()
    const editList = page.getByTestId('edit-list')
    await expect(editList).toBeVisible()
    const panel = await box(wsCell(page, 'b1'))
    const popover = await box(editList)
    // Beside the panel, not over it.
    expect(popover.x >= panel.x + panel.width - 1 || popover.x + popover.width <= panel.x + 1).toBe(true)
  })

  test('a list tab switched to Eisenhower keeps its list, and back', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await (await openTabMenu(page, 'lensTab')).getByRole('menuitemradio', { name: 'Eisenhower' }).click()
    await expect(wsTab(page, 'lensTab')).toHaveAttribute('title', 'Eisenhower · Team')
    await expect(wsCell(page, 'a1').getByTestId('list-filter-row')).toBeVisible()
    await expect(wsCell(page, 'a1').locator('[data-eisenhower="lensTab"]')).toBeVisible()
    // Back to List: no list picker, the same list.
    await (await openTabMenu(page, 'lensTab')).getByRole('menuitemradio', { name: 'List' }).click()
    await expect(page.getByText('Show list', { exact: true })).toHaveCount(0)
    await expect(wsTab(page, 'lensTab')).toHaveAttribute('title', 'Team')
    await expect(wsCell(page, 'a1').locator('[data-list-widget="lensTab"]')).toBeVisible()
  })

  test('closing the last widget on an unsaved list asks first', async ({ page }) => {
    await seedWorkspace(page, ON_TEAM)
    await filterLine(page).getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Status' }).click()
    await page.getByTestId('list-filter-picker').locator('label', { hasText: 'Waiting' }).click()
    await page.keyboard.press('Escape')
    await expect(unsavedDot(wsTab(page, 'eisTab'))).toBeVisible()

    await wsTab(page, 'eisTab').hover()
    await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Team' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save changes to list “Team”?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(wsTab(page, 'eisTab')).toBeVisible()
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the tab’s sheet: Edit list…, what it shows, the urgent range; Edit list is the half sheet', async ({ page }) => {
    await seedWorkspace(page, ON_TEAM)
    await expect(widget(page)).toHaveAttribute('data-layout', 'stacked')
    await expect(filterLine(page)).toContainText('No filters')
    // Mobile browsers turn a long press into `contextmenu`.
    await wsTab(page, 'eisTab').dispatchEvent('contextmenu')
    const sheet = page.getByRole('menu', { name: 'Eisenhower' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByTestId('eisenhower-sheet-source')).toHaveText(/Show\s*Team/)
    await expect(sheet.getByRole('menuitemradio', { name: /3 days/ })).toHaveAttribute('aria-checked', 'true')
    await sheet.getByRole('menuitem', { name: 'Edit list…' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Edit list Team' })).toBeVisible()
  })
})
