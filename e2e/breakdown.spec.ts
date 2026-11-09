import { expect, test, type Locator, type Page } from '@playwright/test'
import { openCellMenu, seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The Breakdown (D26 P8, boards Z1 / Z3 and review mode's board F): a row,
 * a bar or a segment drills into the task dialog; the headings sort (view
 * state, kept across a reload, the layout still saved); the filter row
 * narrows the rows; Review ▸ and a Due / Follow-up count open the review
 * deck on just those tasks; Waiting on is a preset with the check-in
 * envelope.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const SEED: WorkspaceSeed = {
  people: [
    { name: 'Aisha Rahman', email: 'aisha@example.com' },
    { name: 'Ben Ortiz', email: 'ben@example.com' },
    'Cy Young',
  ],
  statuses: ['Waiting'],
  tags: ['Project: Atlas'],
  tasks: [
    { title: 'Aisha late', people: ['Aisha Rahman'], dueInDays: -2 },
    { title: 'Aisha soon', people: ['Aisha Rahman'], dueInDays: 1 },
    { title: 'Aisha later', people: ['Aisha Rahman'], dueInDays: 20, focus: true },
    { title: 'Ben chase', people: ['Ben Ortiz'], followupInDays: -1, status: 'Waiting', lastFollowupInDays: -12 },
    { title: 'Ben waits', people: ['Ben Ortiz'], status: 'Waiting', lastFollowupInDays: -3 },
    { title: 'Ben open one', people: ['Ben Ortiz'] },
    { title: 'Ben open two', people: ['Ben Ortiz'] },
    { title: 'Ben open three', people: ['Ben Ortiz'] },
    { title: 'Cy waits', people: ['Cy Young'], status: 'Waiting', lastFollowupInDays: -5 },
    { title: 'Nobody’s', tags: ['Project: Atlas'] },
    { title: 'Done already', people: ['Aisha Rahman'], isCompleted: true },
  ],
  listDefinitions: [{ name: 'Everything' }],
  layouts: [{
    name: 'Charts',
    columns: [
      { id: 'c1', weight: 3, rows: [wsRow({ id: 'k1', tabs: [{ id: 'people', kind: 'breakdown', glance: { name: 'People', splitBy: 'people' } }] })] },
      { id: 'c2', weight: 2, rows: [wsRow({ id: 'k2', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] },
    ],
  }],
}

const chart = (page: Page, tabId = 'people') => page.locator(`[data-chart="${tabId}"]`)
const row = (page: Page, name: string, tabId = 'people'): Locator =>
  chart(page, tabId).locator('[data-breakdown-row]').filter({ has: page.getByRole('button', { name: new RegExp(`^${name}:`) }) })
const rowNames = (page: Page, tabId = 'people') =>
  chart(page, tabId).locator('[data-breakdown-row] > [role="cell"]:first-child button:first-child')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')?.split(':')[0]))
const dialog = (page: Page) => page.locator('[data-task-dialog]')
const deck = (page: Page) => page.locator('[data-review-deck]')

test('a row and a stacked segment open their tasks in the task dialog', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(chart(page).locator('[data-breakdown-row]')).toHaveCount(4)
  // Open tasks only, by person; Unassigned last.
  await expect(chart(page).getByTestId('glance-section-count')).toHaveText('10 open')
  await row(page, 'Aisha Rahman').click()
  await expect(dialog(page).getByRole('heading')).toHaveText('People · Aisha Rahman')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  // As a stacked bar: a segment per row.
  await chart(page).locator('[data-chart-head]').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Cell options' })
  await menu.getByRole('menuitem', { name: /^Style/ }).click()
  await page.getByRole('menuitemradio', { name: 'Stacked bar' }).click()
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')
  await chart(page).locator('[data-segment^="person-"]').first().click()
  await expect(dialog(page).getByRole('heading')).toHaveText(/^People · /)
})

test('the headings sort (saved at once, per split); the filter row narrows the rows', async ({ page }) => {
  await seedWorkspace(page, SEED)
  // The default: most due + follow-up first.
  await expect.poll(() => rowNames(page)).toEqual(['Aisha Rahman', 'Ben Ortiz', 'Cy Young', 'Unassigned'])
  await expect(chart(page).getByTestId('chart-sub')).toHaveText('Most due first')
  const open = chart(page).getByRole('button', { name: /^Open/ })
  await open.click()
  await expect.poll(() => rowNames(page)).toEqual(['Ben Ortiz', 'Aisha Rahman', 'Cy Young', 'Unassigned'])
  await expect(chart(page).getByRole('columnheader', { name: /Open/ })).toHaveAttribute('aria-sort', 'descending')
  await expect(open).toContainText('▼')
  await expect(chart(page).getByTestId('chart-sub')).toHaveText('Most open first')
  await open.click()
  await expect(chart(page).getByTestId('chart-sub')).toHaveText('Fewest open first')
  await expect.poll(() => rowNames(page)).toEqual(['Cy Young', 'Aisha Rahman', 'Ben Ortiz', 'Unassigned'])
  // View state: the layout stays saved, and the sort comes back after a reload.
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
  await page.reload()
  await expect(chart(page).getByTestId('chart-sub')).toHaveText('Fewest open first')
  // A third click: back to the default.
  await chart(page).getByRole('button', { name: /^Open/ }).click()
  await expect(chart(page).getByTestId('chart-sub')).toHaveText('Most due first')

  // The filter row: typing narrows by name; Enter picks the first match; picks OR.
  const field = chart(page).getByRole('textbox', { name: 'Filter by person' })
  await field.fill('ben')
  await expect.poll(() => rowNames(page)).toEqual(['Ben Ortiz'])
  await field.press('Enter')
  await expect(chart(page).getByTestId('breakdown-filter-chip')).toHaveText(['Ben Ortiz×'])
  await field.fill('cy')
  await field.press('Enter')
  await expect.poll(() => rowNames(page)).toEqual(['Ben Ortiz', 'Cy Young'])
  // Backspace in the empty field takes the last chip back; Esc clears the text; × clears it all.
  await field.press('Backspace')
  await expect.poll(() => rowNames(page)).toEqual(['Ben Ortiz'])
  await field.fill('ai')
  await field.press('Escape')
  await expect(field).toHaveValue('')
  await chart(page).getByRole('button', { name: 'Clear the person filter' }).click()
  await expect.poll(() => rowNames(page)).toHaveLength(4)
})

test('Review ▸ on a row’s hover opens the deck on its tasks; a Due count reviews just those', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const aisha = row(page, 'Aisha Rahman')
  const review = aisha.getByTestId('breakdown-review')
  await expect(review).toBeHidden()
  await aisha.hover()
  await expect(review).toBeVisible()
  await expect(review).toHaveText('Review ▸')
  await review.click()
  await expect(deck(page)).toBeVisible()
  await expect(deck(page).getByTestId('review-position')).toHaveText('1 of 3')
  await page.keyboard.press('Escape')
  await expect(deck(page)).toHaveCount(0)

  // Its Due count (overdue and the next 3 days): solid, since one is overdue; a click reviews those two.
  const due = aisha.locator('[data-badge-part="due"]')
  await expect(due).toHaveText('2')
  await expect(due).toHaveAttribute('data-solid', '')
  await due.click()
  await expect(deck(page).getByTestId('review-position')).toHaveText('1 of 2')
  await expect(deck(page).getByRole('navigation', { name: 'Review queue' }).getByRole('button')).toHaveText([/Aisha late/, /Aisha soon/])
  await page.keyboard.press('Escape')
  // Keyboard: the name's focus shows Review ▸ too.
  await row(page, 'Ben Ortiz').getByRole('button', { name: /^Ben Ortiz:/ }).focus()
  await expect(row(page, 'Ben Ortiz').getByTestId('breakdown-review')).toBeVisible()
})

test('a person row’s right-click opens the person menu', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await row(page, 'Ben Ortiz').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '@Ben Ortiz' })
  await expect(menu.getByRole('menuitem')).toHaveText(['Review with Ben Ortiz…', 'Email check-in to Ben Ortiz', 'Paste reply from Ben Ortiz…', 'Show tasks', 'Edit…', 'Delete…'])
  await menu.getByRole('menuitem', { name: 'Review with Ben Ortiz…' }).click()
  await expect(deck(page).getByTestId('review-position')).toHaveText('1 of 5')
})

test('Waiting on: added from its preset, the Waiting tasks by person, oldest follow-up first, with the envelope', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    const w = window as unknown as { __mailto: string[] }
    w.__mailto = []
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.href.startsWith('mailto:')) {
        w.__mailto.push(this.href)
        return
      }
      return click.call(this)
    }
  })
  await seedWorkspace(page, SEED)
  await openCellMenu(page, 'k2')
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Add widget…' }).click()
  await page.getByRole('menuitem', { name: 'Numbers & charts' }).click()
  await page.getByRole('menuitem', { name: 'Breakdown' }).click()
  await page.getByRole('menuitem', { name: 'Waiting on' }).click()

  const editor = page.locator('[data-chart-editor]')
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Waiting on')
  await expect(editor.getByTestId('chart-editor-filter')).toContainText('Waiting')
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)

  const waiting = page.locator('[data-chart]').filter({ hasText: 'Waiting on' })
  const names = () => waiting.locator('[data-breakdown-row] > [role="cell"]:first-child button:first-child')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')?.split(':')[0]))
  // Oldest last follow-up first: Ben's 12 days, Cy's 5.
  await expect.poll(names).toEqual(['Ben Ortiz', 'Cy Young'])
  // The oldest's age, in the follow-up colour while a follow-up is late; its title under the name.
  const ben = waiting.locator('[data-breakdown-row="person-2"]')
  await expect(ben.getByTestId('breakdown-figure')).toHaveText('12 d')
  await expect(ben.getByTestId('breakdown-figure')).toHaveCSS('color', 'rgb(245, 200, 66)')
  await expect(ben).toContainText('2 tasks · Ben chase')

  // The envelope: Email check-in to Ben sends their open tasks.
  await ben.getByRole('button', { name: 'Email check-in options for Ben Ortiz' }).click()
  const menu = page.getByRole('menu', { name: 'Check-in for Ben Ortiz' })
  await menu.getByRole('menuitem', { name: 'Email check-in to Ben Ortiz' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __mailto: string[] }).__mailto)).toHaveLength(1)
  await expect(page.getByText(/Check-in for Ben Ortiz opened/)).toBeVisible()
})

test('Waiting on with no status named Waiting opens its filter on the Status picker', async ({ page }) => {
  // No status named Waiting: the tasks without one.
  const tasks = SEED.tasks?.map((t) => ({ ...t, status: undefined }))
  await seedWorkspace(page, { ...SEED, statuses: ['On hold'], tasks })
  await openCellMenu(page, 'k2')
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Add widget…' }).click()
  await page.getByRole('menuitem', { name: 'Numbers & charts' }).click()
  await page.getByRole('menuitem', { name: 'Breakdown' }).click()
  await page.getByRole('menuitem', { name: 'Waiting on' }).click()
  const editor = page.locator('[data-chart-editor]')
  await expect(editor.getByTestId('chart-editor-pick-hint')).toBeVisible()
  // The Status picker is open: pick On hold.
  await page.getByRole('option', { name: 'On hold' }).click()
  await expect(editor.getByTestId('chart-editor-filter')).toContainText('On hold')
})

