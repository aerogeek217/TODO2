import { expect, test, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A Pivot's headings sort its rows (item 8), as a Breakdown's: a click on a
 * column, on Total or on the name heading sorts largest first (names A–Z),
 * a second reverses, a third puts the natural order back. View state:
 * saved at once, kept over a reload; the columns never move.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const SEED: WorkspaceSeed = {
  people: ['Aisha Rahman', 'Ben Ortiz', 'Cleo Park'],
  statuses: ['Doing', 'Waiting'],
  tasks: [
    // Aisha: 3 open (Doing 2, Waiting 1); Ben: 2 (Waiting 2); Cleo: 1 (Doing 1); one unassigned.
    { title: 'A1', people: ['Aisha Rahman'], status: 'Doing' },
    { title: 'A2', people: ['Aisha Rahman'], status: 'Doing' },
    { title: 'A3', people: ['Aisha Rahman'], status: 'Waiting' },
    { title: 'B1', people: ['Ben Ortiz'], status: 'Waiting' },
    { title: 'B2', people: ['Ben Ortiz'], status: 'Waiting' },
    { title: 'C1', people: ['Cleo Park'], status: 'Doing' },
    { title: 'Loose end' },
  ],
  layouts: [{ name: 'Pivot', table: { areas: ['p'], cells: [{ id: 'p', tabs: [{ id: 'pivot', kind: 'pivot' }] }] } }],
}

const pivot = (page: Page) => page.locator('[data-chart="pivot"]')
const rowHeads = (page: Page) => pivot(page).locator('[data-pivot-row] [role="rowheader"]')
const heading = (page: Page, name: string) => pivot(page).locator('[role="columnheader"]').filter({ has: page.getByRole('button', { name, exact: true }) })
const sortButton = (page: Page, name: string) => pivot(page).getByRole('button', { name, exact: true })

async function storedSort(page: Page): Promise<unknown> {
  const [layout] = await readStore<{ cells: Array<{ tabs: Array<{ id: string; viewState?: { sort?: unknown } }> }> }>(page, 'layouts')
  return layout?.cells.flatMap((c) => c.tabs).find((t) => t.id === 'pivot')?.viewState?.sort
}

test('a column heading sorts the rows, a second click reverses, a third restores; kept over a reload', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const natural = ['Aisha Rahman', 'Ben Ortiz', 'Cleo Park', 'Unassigned']
  await expect(rowHeads(page)).toHaveText(natural)
  const columns = await pivot(page).locator('[role="columnheader"]').allTextContents()
  expect(columns).toEqual(['Person', 'Doing', 'Waiting', 'No status', 'Total'])

  await sortButton(page, 'Waiting').click()
  await expect(rowHeads(page)).toHaveText(['Ben Ortiz', 'Aisha Rahman', 'Cleo Park', 'Unassigned'])
  await expect(heading(page, 'Waiting')).toHaveAttribute('aria-sort', 'descending')
  await expect(heading(page, 'Waiting')).toContainText('▼')
  await expect.poll(() => storedSort(page)).toEqual({ by: expect.stringMatching(/^status-/) })

  await page.reload()
  await expect(rowHeads(page)).toHaveText(['Ben Ortiz', 'Aisha Rahman', 'Cleo Park', 'Unassigned'])

  await sortButton(page, 'Waiting').click()
  // Fewest first; the none row stays last.
  await expect(rowHeads(page)).toHaveText(['Cleo Park', 'Aisha Rahman', 'Ben Ortiz', 'Unassigned'])
  await expect(heading(page, 'Waiting')).toHaveAttribute('aria-sort', 'ascending')
  await expect(heading(page, 'Waiting')).toContainText('▲')

  await sortButton(page, 'Waiting').click()
  await expect(rowHeads(page)).toHaveText(natural)
  await expect(heading(page, 'Waiting')).toHaveAttribute('aria-sort', 'none')
  await expect.poll(() => storedSort(page)).toBeUndefined()
  // The columns never moved.
  expect(await pivot(page).locator('[role="columnheader"]').allTextContents()).toEqual(columns)
})

test('Total and the name heading sort too, from the keyboard as well', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await sortButton(page, 'Total').click()
  await expect(rowHeads(page)).toHaveText(['Aisha Rahman', 'Ben Ortiz', 'Cleo Park', 'Unassigned'])
  await sortButton(page, 'Total').click()
  await expect(rowHeads(page)).toHaveText(['Cleo Park', 'Ben Ortiz', 'Aisha Rahman', 'Unassigned'])

  await sortButton(page, 'Person').focus()
  await page.keyboard.press('Enter')
  await expect(heading(page, 'Person')).toHaveAttribute('aria-sort', 'ascending')
  await expect(rowHeads(page)).toHaveText(['Aisha Rahman', 'Ben Ortiz', 'Cleo Park', 'Unassigned'])
  await page.keyboard.press('Enter')
  await expect(heading(page, 'Person')).toHaveAttribute('aria-sort', 'descending')
  await expect(rowHeads(page)).toHaveText(['Cleo Park', 'Ben Ortiz', 'Aisha Rahman', 'Unassigned'])
})
