import { expect, test, type Page } from '@playwright/test'
import { filterChip, filterMenu, filterMenuRow, filterTray, openFilterPicker } from './fixtures/filters'
import { ADD_FILTER, openListFilterEditor, openSettings, readListDefinitions, seedWorkspace, withSpareLayouts, wsListWidget, wsTab, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'
import { readStore } from './fixtures/db'

/**
 * The Priority filter reads as a Status filter: Is / Is not, several values
 * (OR), `No priority` — in the top bar, a list's own filter (Edit list), the
 * folded Filters menu and the phone's Filters sheet. AND is a second Priority
 * chip. Urgent is effective urgent, so `is not Urgent` also leaves out a task
 * urgent only by its due date.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Flagged urgent', urgent: true },
    { title: 'Due tomorrow', dueInDays: 1 },
    { title: 'Important only', important: true },
    { title: 'Both', urgent: true, important: true },
    { title: 'Plain' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

const ALL = ['Flagged urgent', 'Due tomorrow', 'Important only', 'Both', 'Plain']
const titles = (page: Page) => rowTitles(wsListWidget(page, 't1'))
const sorted = async (page: Page) => (await titles(page)).toSorted()
const row = (page: Page, name: string) => page.getByRole('option', { name })

test.describe('desktop', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('top bar: is Urgent or Important; is not; No priority; Clear', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect.poll(() => sorted(page)).toEqual(ALL.toSorted())

    await openFilterPicker(page, 'Priority')
    await expect(page.getByRole('radio', { name: 'Is', exact: true })).toHaveAttribute('aria-checked', 'true')
    await row(page, 'Urgent').click()
    await expect.poll(() => sorted(page)).toEqual(['Both', 'Due tomorrow', 'Flagged urgent'])
    // The picker stays open: any of them.
    await row(page, 'Important').click()
    await expect.poll(() => sorted(page)).toEqual(['Both', 'Due tomorrow', 'Flagged urgent', 'Important only'])
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(filterMenu(page)).toHaveCount(0)
    const both = filterChip(page, 'Priority')
    await expect(both).toHaveAccessibleName('Priority filter: Urgent or Important')

    // Is not turns the same ticks round.
    await both.click()
    await page.getByRole('radio', { name: 'Is not', exact: true }).click()
    await expect.poll(() => titles(page)).toEqual(['Plain'])
    await row(page, 'Important').click()
    await expect.poll(() => sorted(page)).toEqual(['Important only', 'Plain'])
    await page.keyboard.press('Escape')
    const not = filterChip(page, 'Priority')
    await expect(not).toHaveAccessibleName('Priority filter: not Urgent')
    await not.hover()
    await expect(page.getByRole('tooltip')).toHaveText(/Priority: not Urgent\s*Hides tasks that are Urgent \(flagged or due soon\)/)
    // The list's line doesn't repeat it (J13); its count says it narrows the list.
    await expect(wsListWidget(page, 't1').getByText('not Urgent')).toHaveCount(0)
    await expect(wsListWidget(page, 't1').getByTestId('list-count')).toBeVisible()

    // No priority: no marker, effective Urgent counted.
    await not.click()
    await page.getByRole('radio', { name: 'Is', exact: true }).click()
    await row(page, 'Urgent').click()
    // No filter now; the chip stays, as its label, while its picker is open.
    await expect(filterTray(page).getByRole('button', { name: 'Priority filter', exact: true })).toBeVisible()
    await row(page, 'No priority').click()
    await expect.poll(() => titles(page)).toEqual(['Plain'])
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Clear priority filter' }).click()
    await expect.poll(() => sorted(page)).toEqual(ALL.toSorted())
  })

  test('search tokens: /urgent /important are any of them, as other tokens', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await page.getByRole('textbox', { name: 'Filter tasks' }).click()
    await page.keyboard.type('/urgent /important ')
    await expect.poll(() => sorted(page)).toEqual(['Both', 'Due tomorrow', 'Flagged urgent', 'Important only'])
    await expect(page.getByRole('button', { name: 'Priority filter: Urgent or Important' })).toBeVisible()
  })

  test('Edit list: a second Priority chip is AND; saved, it survives a reload', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const widget = wsListWidget(page, 't1')
    await widget.getByTestId('list-summary').click()
    const editList = page.getByTestId('edit-list')
    await expect(editList).toBeVisible()
    await editList.getByRole('button', { name: ADD_FILTER }).click()
    await page.getByRole('menuitem', { name: 'Priority' }).click()
    const picker = page.getByTestId('list-filter-picker')
    await picker.getByRole('radio', { name: 'Is not', exact: true }).click()
    await picker.getByRole('option', { name: 'Important' }).click()
    await expect.poll(() => sorted(page)).toEqual(['Due tomorrow', 'Flagged urgent', 'Plain'])
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()

    await editList.getByRole('button', { name: 'Another filter (AND)', exact: true }).click()
    await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Priority' }).click()
    await picker.getByRole('option', { name: 'Urgent' }).click()
    await expect.poll(() => sorted(page)).toEqual(['Due tomorrow', 'Flagged urgent'])
    await expect(editList.getByTestId('list-filter-chip')).toHaveText([/Priority\s*not Important/, /Priority\s*Urgent/])
    await page.keyboard.press('Escape')
    await editList.getByRole('button', { name: 'Save list' }).click()
    await expect(editList).toHaveCount(0)
    await expect.poll(async () => ((await readListDefinitions(page))[0]?.membership as { predicate: unknown }).predicate)
      .toMatchObject({ markers: [{ values: ['important'], not: true }, { values: ['urgent'] }] })

    await page.reload()
    await expect.poll(() => sorted(page)).toEqual(['Due tomorrow', 'Flagged urgent'])
    // Reopened from the line's words: each chip opens on its own condition; × takes only that one.
    const reopened = await openListFilterEditor(page, wsListWidget(page, 't1'))
    const chips = reopened.getByTestId('list-filter-chip')
    await expect(chips).toHaveText([/Priority\s*not Important/, /Priority\s*Urgent/])
    await chips.nth(1).getByRole('button', { name: /Priority/ }).click()
    await expect(picker.getByRole('radio', { name: 'Is', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(picker.getByRole('option', { name: 'Urgent' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
    await chips.nth(0).getByRole('button', { name: 'Remove filter' }).click()
    await expect(chips).toHaveText([/Priority\s*Urgent/])
    await expect.poll(() => sorted(page)).toEqual(['Both', 'Due tomorrow', 'Flagged urgent'])
  })

  test('the Eisenhower\'s default panes sort as before; a lens holds the AND the top bar can\'t', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      lenses: [{ id: 'both', name: 'Both', predicate: { markers: [{ values: ['urgent'] }, { values: ['important'] }] } }],
      layouts: [{ name: 'Main', columns: [
        { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] },
        { id: 'c2', weight: 2, rows: [wsRow({ id: 'k2', tabs: [{ id: 'eis', kind: 'eisenhower' }] })] },
      ] }],
    })
    const pane = (q: string) => page.locator('[data-eisenhower="eis"]').locator(`[data-eis-quadrant="${q}"]`).locator('[data-todo-id]')
    await expect(pane('do')).toHaveCount(1)
    await expect(pane('do')).toContainText('Both')
    await expect(pane('schedule')).toContainText('Important only')
    await expect(pane('delegate')).toHaveCount(2)
    await expect(pane('drop')).toContainText('Plain')

    await page.locator('header').getByRole('button', { name: /^Lens:/ }).click()
    await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: /^Both/ }).click()
    await expect.poll(() => titles(page)).toEqual(['Both'])
    await wsTab(page, 't1').click({ button: 'right' })
    await page.keyboard.press('Escape')
    const settings = await openSettings(page, 'Tasks')
    await expect(settings.getByTestId('lens-list').getByRole('button', { name: /^Both/ })).toBeVisible()
    expect((await readStore(page, 'settings')).length).toBeGreaterThan(0)
  })
})

test.describe('narrow window', () => {
  test.use({ viewport: { width: 1100, height: 800 } })

  test('the Filter menu with other layouts taking the room: Priority › Important', async ({ page }) => {
    await seedWorkspace(page, withSpareLayouts(SEED))
    await openFilterPicker(page, 'Priority')
    await row(page, 'Important').click()
    await expect.poll(() => sorted(page)).toEqual(['Both', 'Important only'])
    await expect(filterMenuRow(page, 'Priority')).toHaveAccessibleName('Priority filter: Important')
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the Filters sheet: unticking narrows, as Status; Is not spells it out', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const rows = page.locator('[data-todo-id]')
    await expect(rows).toHaveCount(5)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Filters', exact: true }).click()
    const section = page.getByText('Priority', { exact: true })
    await section.click()
    const urgent = page.getByRole('checkbox', { name: 'Urgent' })
    await expect(urgent).toBeChecked()
    // Every row ticked is no filter; unticking Urgent keeps the rest.
    await urgent.click({ force: true })
    await expect(urgent).not.toBeChecked()
    await expect(rows).toHaveCount(3)
    await page.getByRole('radio', { name: 'Is not', exact: true }).click()
    await expect(section.locator('..')).toContainText('not')
    await expect(rows).toHaveCount(2)
  })
})
