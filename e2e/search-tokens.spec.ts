import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { seedWorkspace, wsListWidget, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * The search box's forms in the top bar's typed filter (D16, feedback P2):
 * `@person`, `#tag`, `!status`, `/urgent`…, `overdue`, `due fri`, `done`
 * read in the field as they did in the search box — side by side they
 * `and`, names of one kind `or` — and the words left are the text search,
 * whose matches the results dropdown lists among the tasks the rest of the
 * filter keeps. `@` and `!` open the popup under the field; a name that
 * matches nobody is an error (never applied). The rest of the typed filter
 * (`or`, pills, the funnel): `top-bar-expression.spec.ts`.
 */

const SEED: WorkspaceSeed = {
  people: ['Aisha Rahman'],
  tags: ['northwind'],
  listDefinitions: [{ name: 'Everything', layoutIdx: 0 }],
  tasks: [
    { title: 'Approve the budget revision', tags: ['northwind'], dueInDays: -2 },
    { title: 'Northwind budget call', tags: ['northwind'], dueInDays: 3 },
    { title: 'Budget memo', dueInDays: -1 },
    { title: 'Northwind kickoff', tags: ['northwind'], dueInDays: -4 },
  ],
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] },
  ],
}

const tray = (page: Page) => page.locator('header').getByRole('group', { name: 'Screen filters — apply to every widget' })
const search = (page: Page) => tray(page).getByRole('textbox', { name: 'Filter tasks' })
const results = (page: Page) => page.getByRole('listbox', { name: 'Search results' })
const counter = (page: Page) => tray(page).getByRole('button', { name: /tasks shown(, .+)?\. Show them$/ })
const listTitles = (page: Page) => rowTitles(wsListWidget(page, 't1'))

test.use({ viewport: { width: 1440, height: 900 } })

test('overdue #northwind budget: the filter as typed, the dropdown narrowed by the rest of it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => listTitles(page)).toHaveLength(4)

  await search(page).click()
  await page.keyboard.type('overdue #northwind', { delay: 20 })
  // The `#` popup closes on the next word.
  await page.keyboard.type(' budget', { delay: 20 })

  // The text stays as typed; the widgets and the counter follow it once it rests.
  await expect(search(page)).toHaveValue('overdue #northwind budget')
  await expect.poll(() => listTitles(page)).toEqual(['Approve the budget revision'])
  await expect(counter(page)).toHaveAccessibleName('1 of 4 open tasks shown, 1 due: overdue. Show them')

  // The dropdown: "budget" among the overdue #northwind tasks only.
  const options = results(page).getByRole('option')
  await expect(options).toHaveCount(1)
  await expect(options.first()).toContainText('Approve the budget revision')

  // Settled: the canonical text; at rest, a pill per term.
  await page.keyboard.press('Enter')
  await expect(search(page)).toHaveValue('overdue and #northwind and "budget"')
  await search(page).blur()
  await expect(tray(page).getByTestId('top-bar-pills').locator('[data-top-bar-pill]')).toHaveText([/overdue/, /#northwind/, /"budget"/])
})

test('@ opens the people popup under the field; ⏎ picks; a name matching nobody is an error, never applied', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => listTitles(page)).toHaveLength(4)

  await search(page).click()
  await page.keyboard.type('@ai', { delay: 20 })
  const popup = page.getByRole('listbox', { name: 'People' })
  await expect(popup.getByRole('option', { name: 'Aisha Rahman' })).toBeVisible()
  await expect(popup.getByText(/Create/)).toHaveCount(0)
  // Under the field.
  const box = await search(page).boundingBox()
  const list = await popup.boundingBox()
  expect(list && box && list.y >= box.y + box.height - 1).toBe(true)

  await page.keyboard.press('Enter')
  await expect(popup).toHaveCount(0)
  await expect(search(page)).toHaveValue(/^@"Aisha Rahman" ?$/)

  await page.keyboard.press('Control+A')
  await page.keyboard.type('@nobody report', { delay: 20 })
  await expect(page.getByTestId('top-bar-filter-error')).toContainText('No person named nobody')
  await expect.poll(() => listTitles(page)).toHaveLength(4)
})

test('! opens the statuses under the field; side by side, two statuses or', async ({ page }) => {
  await seedWorkspace(page, {
    ...SEED,
    statuses: ['Waiting', 'On Hold'],
    tasks: [
      { title: 'Chase the invoice', status: 'Waiting' },
      { title: 'Paused rollout', status: 'On Hold' },
      { title: 'Plain task' },
    ],
  })
  await expect.poll(() => listTitles(page)).toHaveLength(3)

  await search(page).click()
  await page.keyboard.type('!wa', { delay: 20 })
  const popup = page.getByRole('listbox', { name: 'Statuses' })
  await expect(popup.getByRole('option')).toHaveText(['Waiting'])
  const box = await search(page).boundingBox()
  const list = await popup.boundingBox()
  expect(list && box && list.y >= box.y + box.height - 1).toBe(true)

  await page.keyboard.press('Enter')
  await expect(popup).toHaveCount(0)
  await expect.poll(() => listTitles(page)).toEqual(['Chase the invoice'])

  // A second status side by side ORs with the first.
  await page.keyboard.type(' !"On Hold"', { delay: 20 })
  await expect.poll(() => listTitles(page)).toEqual(['Chase the invoice', 'Paused rollout'])
  await search(page).blur()
  await expect(tray(page).getByTestId('top-bar-pills')).toHaveText('!Waiting or !"On Hold"')
})
