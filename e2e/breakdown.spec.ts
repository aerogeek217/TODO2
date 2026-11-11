import { expect, test, type Locator, type Page } from '@playwright/test'
import { openCellMenu, seedWorkspace, wsRow, type WorkspaceSeed, expectLayoutStep, expectLayoutStored } from './fixtures/workspace'
import { expectDeckAt } from './fixtures/review'

/**
 * The Breakdown (D26 P8, boards Z1 / Z3 and review mode's board F): a row,
 * a bar or a segment drills into the task dialog; the headings sort (view
 * state, kept across a reload, the layout still saved); the filter row
 * narrows the rows; the row's Review button and a count column's count
 * open the review deck on just those tasks; the editor's count columns
 * (board BC); the lens switch (G3).
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
  chart(page, tabId).locator('[data-breakdown-row] > [role="cell"]:first-child > button:first-child')
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
  await expectLayoutStep(page)
  await chart(page).locator('[data-segment^="person-"]').first().click()
  await expect(dialog(page).getByRole('heading')).toHaveText(/^People · /)
})

test('the headings sort (saved at once, per split); the filter row narrows the rows', async ({ page }) => {
  await seedWorkspace(page, SEED)
  // The default: most counted across the count columns first; no sort words in the header.
  await expect.poll(() => rowNames(page)).toEqual(['Aisha Rahman', 'Ben Ortiz', 'Cy Young', 'Unassigned'])
  await expect(chart(page).getByTestId('chart-sub')).toHaveCount(0)
  const open = chart(page).getByRole('button', { name: /^Open/ })
  await open.click()
  await expect.poll(() => rowNames(page)).toEqual(['Ben Ortiz', 'Aisha Rahman', 'Cy Young', 'Unassigned'])
  await expect(chart(page).getByRole('columnheader', { name: /Open/ })).toHaveAttribute('aria-sort', 'descending')
  await expect(open).toContainText('▼')
  await open.click()
  await expect(open).toContainText('▲')
  await expect.poll(() => rowNames(page)).toEqual(['Cy Young', 'Aisha Rahman', 'Ben Ortiz', 'Unassigned'])
  // View state: the layout stays saved, and the sort comes back after a reload.
  await expectLayoutStored(page)
  await page.reload()
  await expect.poll(() => rowNames(page)).toEqual(['Cy Young', 'Aisha Rahman', 'Ben Ortiz', 'Unassigned'])
  // A third click: back to the default.
  await chart(page).getByRole('button', { name: /^Open/ }).click()
  await expect.poll(() => rowNames(page)).toEqual(['Aisha Rahman', 'Ben Ortiz', 'Cy Young', 'Unassigned'])

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

/** The opacity of a row's actions (Review, the envelope), which show on the row's hover or focus. */
const actionsOpacity = (l: Locator) => l.evaluate((el) => Number(getComputedStyle(el.parentElement!).opacity))

test('Review and the envelope sit right after the name, shown on the row’s hover or focus; a count column’s count reviews just its tasks', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await page.mouse.move(0, 0)
  const aisha = row(page, 'Aisha Rahman')
  const review = aisha.getByTestId('breakdown-review')
  await expect(review).toHaveAccessibleName('Review Aisha Rahman: 3 tasks')
  // Hidden at rest (opacity only: it keeps its place), shown on the row's hover, hidden again off it.
  await expect.poll(() => actionsOpacity(review)).toBe(0)
  const before = (await review.boundingBox())!
  await aisha.hover()
  await expect.poll(() => actionsOpacity(review)).toBe(1)
  const rb = (await review.boundingBox())!
  expect(rb).toEqual(before)
  expect(Math.round(rb.width)).toBe(24)
  expect(Math.round(rb.height)).toBe(24)
  // Right after the name, in the name column (no actions column at the row's end).
  const name = (await aisha.getByText('Aisha Rahman', { exact: true }).boundingBox())!
  expect(rb.x).toBeGreaterThan(name.x + name.width)
  expect(rb.x - (name.x + name.width)).toBeLessThan(12)
  const head = (await chart(page).getByRole('columnheader', { name: 'Open' }).boundingBox())!
  expect(rb.x + rb.width).toBeLessThan(head.x)
  await page.mouse.move(0, 0)
  await expect.poll(() => actionsOpacity(review)).toBe(0)
  // Keyboard focus in the row shows it too.
  await aisha.getByRole('button', { name: /^Aisha Rahman:/ }).focus()
  await expect.poll(() => actionsOpacity(review)).toBe(1)
  await expect(chart(page)).not.toContainText('Review ▸')
  await review.click()
  await expect(deck(page)).toBeVisible()
  await expectDeckAt(deck(page), 1, 3)
  await page.keyboard.press('Escape')
  await expect(deck(page)).toHaveCount(0)

  // The derived count columns (Settings' ranges), no Priority column: Due (overdue and the next 3 days) lit above 0.
  await expect(chart(page).locator('[data-sort-key]')).toHaveText(['Person', 'Open', 'Due', 'Follow-up'])
  const due = aisha.locator('[data-column="due"]')
  await expect(due).toHaveText('2')
  await expect(due).toHaveAttribute('data-solid', '')
  await expect(due).toHaveCSS('background-color', 'rgb(232, 107, 240)')
  await due.click()
  await expectDeckAt(deck(page), 1, 2)
  await expect(deck(page).getByRole('navigation', { name: 'Review queue' }).locator('[data-review-row]')).toHaveText([/Aisha late/, /Aisha soon/])
  await page.keyboard.press('Escape')
  // None: a dim dash.
  await expect(aisha.getByLabel('No tasks in Follow-up')).toHaveText('–')
})

test('a count column is its number’s room: the heading is cut short (its name in the tooltip), the names keep their room', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const heads = chart(page).locator('[role="columnheader"]')
  const followup = chart(page).locator('[data-sort-key="followup"]')
  await expect(followup).toHaveAttribute('title', 'Follow-up')
  const fb = (await chart(page).getByRole('columnheader', { name: 'Follow-up' }).boundingBox())!
  expect(Math.round(fb.width)).toBe(40)
  // Its label overflows into an ellipsis rather than widening the column.
  expect(await followup.locator('span').first().evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  // The name column takes the rest: wider than every other heading together.
  const widths = await heads.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
  expect(widths[0]).toBeGreaterThan(widths.slice(1).reduce((a, b) => a + b, 0))
  await expect(row(page, 'Aisha Rahman').getByText('Aisha Rahman', { exact: true })).toBeVisible()
})

test('with check-ins, a person row’s envelope sits beside Review and opens Email check-in · Paste reply', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await chart(page).locator('[data-chart-head]').click({ button: 'right' })
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Edit breakdown…' }).click()
  const editor = page.locator('[data-chart-editor]')
  await editor.getByRole('checkbox', { name: 'Check-in envelope on each person' }).check()
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor).toHaveCount(0)
  const ben = row(page, 'Ben Ortiz')
  const envelope = ben.getByRole('button', { name: 'Email check-in options for Ben Ortiz' })
  await ben.hover()
  await expect.poll(() => actionsOpacity(envelope)).toBe(1)
  const eb = (await envelope.boundingBox())!
  const rb = (await ben.getByTestId('breakdown-review').boundingBox())!
  expect(Math.round(eb.width)).toBe(24)
  expect(Math.abs(eb.y - rb.y)).toBeLessThan(1)
  expect(eb.x).toBeGreaterThan(rb.x)
  await envelope.click()
  await expect(page.getByRole('menu', { name: 'Check-in for Ben Ortiz' }).getByRole('menuitem')).toHaveText(['Email check-in to Ben Ortiz', 'Paste reply from Ben Ortiz…'])
  // Shown while its menu is open, the pointer gone.
  await page.mouse.move(0, 0)
  await expect.poll(() => actionsOpacity(envelope)).toBe(1)
})

test('a person row’s right-click opens the person menu', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await row(page, 'Ben Ortiz').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '@Ben Ortiz' })
  await expect(menu.getByRole('menuitem')).toHaveText(['Review with Ben Ortiz…', 'Email check-in to Ben Ortiz', 'Paste reply from Ben Ortiz…', 'Show tasks', 'Edit…', 'Delete…'])
  await menu.getByRole('menuitem', { name: 'Review with Ben Ortiz…' }).click()
  await expectDeckAt(deck(page), 1, 5)
})

test('the editor’s count columns: a column with its own filter, name and rule; the table follows', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await chart(page).locator('[data-chart-head]').click({ button: 'right' })
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Edit breakdown…' }).click()
  const editor = page.locator('[data-chart-editor]')
  const columns = editor.getByTestId('chart-editor-columns')
  // Due and Follow-up (derived, ordinary columns); add a third.
  await expect(columns.getByRole('textbox', { name: /^Column \d name$/ })).toHaveCount(2)
  await columns.getByRole('button', { name: 'Add column' }).click()
  await columns.getByRole('textbox', { name: 'Column 3 name' }).fill('Waiting')
  const added = columns.locator('[data-column-editor]').last()
  await added.getByRole('radiogroup', { name: 'Filter mode' }).getByRole('radio', { name: 'Expression' }).click()
  const field = added.getByRole('textbox', { name: 'Filter expression' })
  await field.fill('!Waiting')
  // A blur writes it once it reads.
  await columns.getByRole('textbox', { name: 'Column 3 name' }).click()
  await expect(added.getByTestId('expression-reads-as')).toBeVisible()
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expectLayoutStep(page)
  await expect(chart(page).locator('[data-sort-key]')).toHaveText(['Person', 'Open', 'Due', 'Follow-up', 'Waiting'])
  // Ben has two Waiting tasks: lit above 0, solid in its colour; a click reviews those two.
  const waiting = row(page, 'Ben Ortiz').locator('[data-column]').last()
  await expect(waiting).toHaveText('2')
  await expect(waiting).toHaveAttribute('data-solid', '')
  await waiting.click()
  await expectDeckAt(deck(page), 1, 2)
  await page.keyboard.press('Escape')
  // Its heading sorts by it.
  await chart(page).getByRole('button', { name: /^Waiting/ }).click()
  await expect.poll(() => rowNames(page)).toEqual(['Ben Ortiz', 'Cy Young', 'Aisha Rahman', 'Unassigned'])
})

test('the presets: People · Tags · Status · Custom (no Waiting on)', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await openCellMenu(page, 'k2')
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Add widget…' }).click()
  await page.getByRole('menuitem', { name: 'Insights' }).click()
  await page.getByRole('menuitem', { name: 'Breakdown' }).click()
  await expect(page.getByRole('menu', { name: 'Breakdown' }).getByRole('menuitem')).toHaveText(['People', 'Tags', 'Status', 'Custom'])
})

test('the lens switch at the header’s end, quiet while it follows the lens (2A); a click ignores it here (saved at once)', async ({ page }) => {
  await seedWorkspace(page, { ...SEED, lenses: [{ id: 'lens-aisha', name: 'Aisha', predicate: { personIds: [1] } }] })
  await expect(chart(page).getByTestId('lens-switch')).toHaveCount(0)
  const control = page.locator('header').getByRole('button', { name: /^Lens:/ })
  await control.click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: /^Aisha/ }).click()
  const sw = chart(page).getByTestId('lens-switch')
  await expect(sw).toHaveAttribute('data-lens-hides', '7')
  await expect(chart(page).getByTestId('glance-section-count')).toHaveText('3 open')
  // At the header's right end, before the ⋯ (shown on hover).
  await chart(page).locator('[data-chart-head]').hover()
  const more = (await chart(page).getByRole('button', { name: 'Cell options' }).boundingBox())!
  const sb = (await sw.boundingBox())!
  expect(sb.x + sb.width).toBeLessThanOrEqual(more.x + 0.5)
  expect(more.x - (sb.x + sb.width)).toBeLessThan(40)
  await sw.click()
  await expect(sw).toHaveAttribute('aria-pressed', 'false')
  await expect(chart(page).getByTestId('glance-section-count')).toHaveText('10 open')
  await expectLayoutStored(page)
  await page.reload()
  await expect(chart(page).getByTestId('lens-switch')).toHaveAttribute('aria-pressed', 'false')
  await expect(chart(page).getByTestId('glance-section-count')).toHaveText('10 open')
})
