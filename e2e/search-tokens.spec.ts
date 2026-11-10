import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { seedWorkspace, wsListWidget, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * D16 Search tokens as chips: what is typed in the top bar's search box
 * becomes the tray's own filter chips as each token completes, the box
 * keeping only the plain words — the text search — and the results
 * dropdown lists the words' matches among the tasks the chips keep.
 * Backspace in the empty box takes the last chip back as its token. `!`
 * names a status as `@` a person.
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

test('overdue #northwind budget: two chips, the word in the box, the dropdown narrowed', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => listTitles(page)).toHaveLength(4)

  await search(page).click()
  await page.keyboard.type('overdue #northwind budget', { delay: 20 })

  // The tokens left the box; the word is the text search.
  await expect(search(page)).toHaveValue('budget')
  await expect(tray(page)).toContainText('before today')
  await expect(tray(page)).toContainText('northwind')
  await expect(counter(page)).toHaveAccessibleName('1 of 4 open tasks shown, 1 due: overdue. Show them')

  // The dropdown: "budget" among the overdue #northwind tasks only.
  const options = results(page).getByRole('option')
  await expect(options).toHaveCount(1)
  await expect(options.first()).toContainText('Approve the budget revision')

  // The widgets follow the chips and the word.
  await expect.poll(() => listTitles(page)).toEqual(['Approve the budget revision'])

  // Esc clears the box only; the chips stay.
  await page.keyboard.press('Escape')
  await expect(search(page)).toHaveValue('')
  await expect.poll(() => listTitles(page)).toEqual(['Approve the budget revision', 'Northwind kickoff'])

  // Backspace in the empty box takes the last chip back as its token.
  await search(page).click()
  await page.keyboard.press('Backspace')
  await expect(search(page)).toHaveValue('#northwind')
  await expect.poll(() => listTitles(page)).toEqual(['Approve the budget revision', 'Budget memo', 'Northwind kickoff'])
})

test('@ opens the people popup under the box; ⏎ makes the chip; an unknown name gets a note', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => listTitles(page)).toHaveLength(4)

  await search(page).click()
  await page.keyboard.type('@ai', { delay: 20 })
  const popup = page.getByRole('listbox', { name: 'People' })
  await expect(popup.getByRole('option', { name: 'Aisha Rahman' })).toBeVisible()
  await expect(popup.getByText(/Create/)).toHaveCount(0)
  // Under the box.
  const box = await search(page).boundingBox()
  const list = await popup.boundingBox()
  expect(list && box && list.y >= box.y + box.height - 1).toBe(true)

  await page.keyboard.press('Enter')
  await expect(popup).toHaveCount(0)
  await expect(search(page)).toHaveValue('')
  await expect(tray(page)).toContainText('Aisha Rahman')

  await page.keyboard.type('@nobody report', { delay: 20 })
  await expect(page.getByRole('status').filter({ hasText: 'No person named nobody' })).toBeVisible()
  await expect(search(page)).toHaveValue('@nobody report')
})

test('! opens the statuses under the box; a space makes the Status chip, a second ! ORs in it', async ({ page }) => {
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

  // A space completes the token: the Status chip, the box empty.
  await page.keyboard.type(' ', { delay: 20 })
  await expect(popup).toHaveCount(0)
  await expect(search(page)).toHaveValue('')
  await expect(tray(page)).toContainText('Waiting')
  await expect.poll(() => listTitles(page)).toEqual(['Chase the invoice'])

  // A second status ORs with the first.
  await page.keyboard.type('!"On Hold" ', { delay: 20 })
  await expect(search(page)).toHaveValue('')
  await expect.poll(() => listTitles(page)).toEqual(['Chase the invoice', 'Paused rollout'])

  // `/waiting` is plain words now: the text search.
  await page.keyboard.type('/waiting', { delay: 20 })
  await expect(search(page)).toHaveValue('/waiting')
})
