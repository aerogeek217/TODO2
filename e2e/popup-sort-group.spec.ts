import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'

/**
 * Group · sort in the popup task lists (feedback 2026-11-15, decision 3):
 * the filtered-tasks panel and every task dialog open on Settings'
 * new-list grouping and sort; a pick in one is every popup list's until a
 * reload.
 */

const SEED: WorkspaceSeed = {
  tags: ['q4'],
  // Settings › Tasks › New lists: grouped by Tag, Manual sort.
  settings: { newListGroup: 'tag' },
  listDefinitions: [{ name: 'All' }],
  tasks: [
    { title: 'Alpha', tags: ['q4'], urgent: true, dueInDays: 20 },
    { title: 'Bravo', important: true, dueInDays: 15 },
    { title: 'Charlie', tags: ['q4'], dueInDays: 30 },
    { title: 'Delta', urgent: true, dueInDays: 10 },
  ],
  layouts: [{
    name: 'Main',
    columns: [{
      id: 'c1',
      rows: [
        wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }),
        wsRow({ id: 'k2', tabs: [{ id: 'n1', kind: 'number', glance: { metric: 'open', name: 'Open' } }] }),
      ],
    }],
  }],
}

const panel = (page: Page) => page.locator('[data-filter-panel]')
const dialog = (page: Page) => page.locator('[data-task-dialog]')
const control = (scope: Locator) => scope.getByTestId('popup-group-sort')
const popover = (page: Page) => page.getByRole('dialog', { name: 'Group and sort' })

/** Each heading with its rows' titles, in order. */
async function grouped(scope: Locator): Promise<Array<[string, string[]]>> {
  const groups = scope.locator('[data-task-dialog-group]')
  const out: Array<[string, string[]]> = []
  for (const g of await groups.all()) out.push([(await g.getAttribute('aria-label')) ?? '', await rowTitles(g)])
  return out
}

/** The palette's Show Tasks Matching the Filter: the filtered-tasks panel. */
async function openPanel(page: Page) {
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('combobox').fill('matching the filter')
  await page.getByRole('option', { name: /Show Tasks Matching the Filter/ }).click()
  await expect(panel(page)).toBeVisible()
}

/** The Number's click: its tasks in the task dialog. */
async function openNumberDrill(page: Page) {
  await page.locator('[data-glance-tab="n1"] [data-number]').click()
  await expect(dialog(page)).toBeVisible()
}

/** Picks `option` in the popover's `row` (Group by / Sort by). */
async function pick(page: Page, row: 'Group by' | 'Sort by', option: string) {
  await popover(page).getByRole('button', { name: new RegExp(`^${row}`) }).click()
  await page.getByRole('menu', { name: row }).getByRole('menuitemradio', { name: new RegExp(`^${option}`) }).click()
}

test.use({ viewport: { width: 1280, height: 800 } })

test('the popup lists open on Settings’ grouping; a pick is every popup list’s until a reload', async ({ page }) => {
  await seedWorkspace(page, SEED)

  // The X of Y panel: Settings' grouping (Tag) and sort (Manual).
  await openPanel(page)
  await expect(control(panel(page))).toHaveText('Tag · Manual')
  await expect.poll(() => grouped(panel(page))).toEqual([['#q4', ['Alpha', 'Charlie']], ['No Tag', ['Bravo', 'Delta']]])

  // Group by Priority, sort by Due date.
  await control(panel(page)).click()
  await expect(popover(page)).toBeVisible()
  await pick(page, 'Group by', 'Priority')
  await pick(page, 'Sort by', 'Due date')
  await expect(control(panel(page))).toHaveText('Priority · Due date')
  const byPriority: Array<[string, string[]]> = [['Urgent', ['Delta', 'Alpha']], ['Important', ['Bravo']], ['No priority', ['Charlie']]]
  await expect.poll(() => grouped(panel(page))).toEqual(byPriority)
  if (process.env.P4_SHOT) await page.screenshot({ path: process.env.P4_SHOT })
  // Esc closes the popover, then the panel.
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
  await expect(panel(page)).toBeVisible()
  await expect(control(panel(page))).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)

  // A Number's tasks: the same pick.
  await openNumberDrill(page)
  await expect(control(dialog(page))).toHaveText('Priority · Due date')
  await expect.poll(() => grouped(dialog(page))).toEqual(byPriority)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  // A reload: back to Settings' defaults.
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await openNumberDrill(page)
  await expect(control(dialog(page))).toHaveText('Tag · Manual')
  await expect.poll(() => grouped(dialog(page))).toEqual([['#q4', ['Alpha', 'Charlie']], ['No Tag', ['Bravo', 'Delta']]])
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })

  test('the task dialog’s control works there too', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await openNumberDrill(page)
    await expect(control(dialog(page))).toHaveText('Tag · Manual')
    await control(dialog(page)).click()
    await pick(page, 'Group by', 'No grouping')
    await expect(control(dialog(page))).toHaveText('Manual')
    await expect(dialog(page).locator('[data-task-dialog-group]')).toHaveCount(0)
    // The phone's rows: each title a button carrying it.
    const titles = () => dialog(page).locator('[data-task-title]').evaluateAll((els) => els.map((el) => el.getAttribute('data-task-title')))
    await expect.poll(titles).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  })
})
