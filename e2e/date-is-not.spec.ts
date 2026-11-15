import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { ADD_FILTER, closeListFilterEditor, openListFilterEditor, seedWorkspace, wsListWidget, wsRow } from './fixtures/workspace'

/**
 * "Is not" on a date range (cr25 P4, schema v71), as the user asked for it:
 * a filter that hides the tasks followed up lately that also have a next
 * follow-up soon. Built in Edit list — Last follow-up is not 1 week ago –
 * Today as a chip, then in Expression mode `or` Next follow-up is not
 * Today – In 2 weeks — and saved. A task without the date passes an "is
 * not" range.
 */

const SEED = {
  listDefinitions: [{ name: 'Everything' }],
  tasks: [
    { title: 'Lately, next soon', lastFollowupInDays: -2, followupInDays: 5 },
    { title: 'Lately, next overdue', lastFollowupInDays: -2, followupInDays: -1 },
    { title: 'Long ago, next soon', lastFollowupInDays: -20, followupInDays: 5 },
    { title: 'Never followed up' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens' as const, listDefIdx: 0 }] })] }] }],
}

const ALL = ['Lately, next soon', 'Lately, next overdue', 'Long ago, next soon', 'Never followed up']
const KEPT = ['Lately, next overdue', 'Long ago, next soon', 'Never followed up']

const titles = (page: Page) => rowTitles(wsListWidget(page, 't1'))
const datePanel = (page: Page) => page.getByTestId('list-filter-picker')

/** Picks `item` (its label) from an end's Relative dropdown in the open date panel. */
async function pickRelative(page: Page, end: 'From' | 'To', item: string) {
  await datePanel(page).getByRole('button', { name: new RegExp(`^${end}: (?!Set to)`) }).click()
  await page.getByRole('menu', { name: end }).locator(`[data-menu-label="${item}"]`).click()
}

/** In the open date panel: `type`'s tab, Is not, then From / To by their Relative dropdown items (a new range is Relative, cr25 P8). */
async function setNotRange(page: Page, type: string, from: string, to: string) {
  const panel = datePanel(page)
  await panel.getByRole('tab', { name: new RegExp(`^${type}`) }).click()
  await expect(panel.getByRole('radio', { name: 'Relative' })).toHaveAttribute('aria-checked', 'true')
  await panel.getByRole('radiogroup', { name: `${type}: is or is not` }).getByRole('radio', { name: 'Is not' }).click()
  await pickRelative(page, 'From', from)
  await pickRelative(page, 'To', to)
}

test.use({ viewport: { width: 1440, height: 900 } })

test('the user\'s filter: hides only the tasks followed up lately with a next follow-up soon, once saved', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => titles(page)).toEqual(ALL)

  const editor = await openListFilterEditor(page, wsListWidget(page, 't1'))

  // + Filter › Dates: Last follow-up is not 1 week ago – Today.
  await editor.getByRole('button', { name: ADD_FILTER }).click()
  await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Dates' }).click()
  await setNotRange(page, 'Last follow-up', '1 week ago', 'today')
  await expect(datePanel(page).getByLabel('From: number of days')).toHaveValue('7')
  await expect(datePanel(page).getByRole('button', { name: 'From: days ago' })).toBeVisible()
  await expect(datePanel(page).getByRole('button', { name: 'To: today' })).toBeVisible()
  await expect(datePanel(page).getByRole('tabpanel')).toContainText('not within the last 7 days')
  await expect(datePanel(page).getByText('Tasks never followed up are kept.')).toBeVisible()
  await expect(datePanel(page).getByRole('checkbox')).toHaveCount(0)
  await page.keyboard.press('Escape')
  const chip = editor.getByTestId('list-filter-chip')
  await expect(chip).toHaveText(/Last follow-up\s*not within the last 7 days/)
  await expect(chip).toHaveAttribute('data-negated', '')

  // The OR goes in an expression (schema v75): Expression mode reads the
  // chip as its text, and the second range is typed after it.
  await editor.getByRole('radiogroup', { name: 'Filter mode' }).getByRole('radio', { name: 'Expression' }).click()
  const field = editor.getByRole('textbox', { name: 'Filter expression' })
  await expect(field).toHaveValue(/^not followed /)
  await field.press('End')
  await field.pressSequentially(' or not followup within next 14 days')
  await field.blur()
  await closeListFilterEditor(page)

  await expect.poll(() => titles(page)).toEqual(KEPT)

  // Kept across a reload.
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await expect.poll(() => titles(page)).toEqual(KEPT)
})
