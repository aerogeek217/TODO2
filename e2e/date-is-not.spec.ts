import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { openSettings, seedWorkspace, wsListWidget } from './fixtures/workspace'

/**
 * "Is not" on a date range (cr25 P4, schema v71), as the user asked for it:
 * a lens that hides the tasks followed up lately that also have a next
 * follow-up soon. Built in Settings › Lenses as one or group — Last
 * follow-up is not 1 week ago – Today, or Next follow-up is not Today – In
 * 2 weeks — and saved (a lens's filter edits wait for Save, cr25 P3) before
 * the top bar uses it. A task without the date passes an "is not" range.
 */

const SEED = {
  listDefinitions: [{ name: 'Everything' }],
  tasks: [
    { title: 'Lately, next soon', lastFollowupInDays: -2, followupInDays: 5 },
    { title: 'Lately, next overdue', lastFollowupInDays: -2, followupInDays: -1 },
    { title: 'Long ago, next soon', lastFollowupInDays: -20, followupInDays: 5 },
    { title: 'Never followed up' },
  ],
  lenses: [{ id: 'lens-chase', name: 'Chase', predicate: {} }],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens' as const, listDefIdx: 0 }] }] }] }],
}

const ALL = ['Lately, next soon', 'Lately, next overdue', 'Long ago, next soon', 'Never followed up']
const KEPT = ['Lately, next overdue', 'Long ago, next soon', 'Never followed up']

const header = (page: Page) => page.locator('header')
const tray = (page: Page) => header(page).getByRole('group', { name: 'Screen filters — apply to every widget' })
const counter = (page: Page) => tray(page).getByRole('button', { name: /tasks shown(, .+)?\. Show them$/ })
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

test('the user\'s lens: hides only the tasks followed up lately with a next follow-up soon, once saved', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await header(page).getByRole('button', { name: /^Lens:/ }).click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: /^Chase/ }).click()
  await expect.poll(() => titles(page)).toEqual(ALL)

  const settings = await openSettings(page, 'Tasks')
  const lenses = settings.getByTestId('lens-list')
  await lenses.getByRole('button', { name: /^Chase/ }).click()
  const editor = settings.getByTestId('lens-filter')

  // + Filter › Dates: Last follow-up is not 1 week ago – Today.
  await editor.getByRole('button', { name: 'Filter', exact: true }).click()
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

  // The group is made from the chip's Another filter (OR), which offers
  // Dates while a date type is free (cr25 P4b): it opens on the first free
  // type (Due — never the chip's own), and the Next follow-up tab takes the
  // second range. The chip and the new range become the group at once.
  await chip.click()
  await datePanel(page).getByRole('button', { name: /Another filter \(OR\)/ }).click()
  await page.getByTestId('or-group-panel').getByRole('button', { name: 'Dates' }).click()
  await expect(datePanel(page).getByRole('tab', { name: 'Due', exact: true })).toHaveAttribute('aria-selected', 'true')
  await setNotRange(page, 'Next follow-up', 'today', 'In 2 weeks')
  await page.keyboard.press('Escape')
  const group = editor.getByTestId('or-group')
  await expect(group.getByTestId('list-filter-chip')).toHaveCount(2)
  await expect(group).toHaveText(/Next follow-up\s*not within the next 14 days\s*or\s*Last follow-up\s*not within the last 7 days/)
  await expect(settings.getByTestId('lens-keeps')).toContainText('Keeps 3 of 4 open tasks')
  await expect(lenses.getByRole('button', { name: /^Chase/ })).toContainText('Next follow-up not within the next 14 days or Last follow-up not within the last 7 days')

  // Unsaved: the top bar keeps the saved lens (every task).
  await expect.poll(() => titles(page)).toEqual(ALL)
  await settings.getByRole('button', { name: 'Save lens Chase' }).click()
  await expect(settings.getByTestId('save-lens')).toHaveCount(0)
  await settings.getByRole('button', { name: 'Close settings' }).click()

  await expect.poll(() => titles(page)).toEqual(KEPT)
  await expect(counter(page)).toHaveAccessibleName('3 of 4 open tasks shown, 1 follow-up: overdue. Show them')

  // Kept across a reload.
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await expect.poll(() => titles(page)).toEqual(KEPT)
  await expect(counter(page)).toHaveAccessibleName('3 of 4 open tasks shown, 1 follow-up: overdue. Show them')
})
