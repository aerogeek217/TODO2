import { expect, test, type Page } from '@playwright/test'
import { drag, seedWorkspace, wsCell, wsTab, type WorkspaceSeed, type WsTabSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'

/**
 * The Dashboard widget in a real browser: a cold load straight into a
 * dashboard-only layout renders its counts and the people / tag chips of
 * its task rows; the top-bar filter turns counts into `shown of total`; the
 * tab's config decides what shows; Hot rows drag out onto a calendar.
 */

test.use({ viewport: { width: 1440, height: 900 } })

function seedWith(tab: Partial<WsTabSeed> = {}, extraColumns: WorkspaceSeed['layouts'][number]['columns'] = []): WorkspaceSeed {
  return {
    people: [{ name: 'Alice Chen', initials: 'AC', color: '#e8a25c' }, 'Ben Ortiz'],
    tags: ['q4', 'home'],
    listDefinitions: [{ name: 'Alice’s list', people: ['Alice Chen'] }],
    tasks: [
      { title: 'Fix checkout outage', urgent: true, important: true, dueInDays: 0, people: ['Alice Chen'], tags: ['q4'] },
      { title: 'Plan the offsite', focus: true, tags: ['q4'], followupInDays: 2 },
      { title: 'Call the plumber', dueInDays: -2, tags: ['home'] },
      { title: 'Vendor contract', followupInDays: -1, people: ['Ben Ortiz'] },
      { title: 'Done already', isCompleted: true, urgent: true },
    ],
    layouts: [{
      name: 'Dash',
      columns: [
        { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'dash', kind: 'dashboard', dashboard: { listTileIdxs: [0] }, ...tab }] }] },
        ...extraColumns,
      ],
    }],
  }
}

const dash = (page: Page) => page.locator('[data-dashboard="dash"]')
const tileCount = (page: Page, id: string) => dash(page).locator(`[data-dash-tile="${id}"]`).getByTestId('dash-tile-count')
const section = (page: Page, id: string) => dash(page).locator(`[data-dash-section="${id}"]`)
const sectionIds = (page: Page) => dash(page).locator('[data-dash-section]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.dashSection))

test('a cold-loaded dashboard-only layout renders its counts and the rows’ chips', async ({ page }) => {
  await seedWorkspace(page, seedWith())
  await page.goto('about:blank')
  await page.goto('/#/')
  await expect(dash(page)).toBeVisible()
  await expect(dash(page)).toHaveAttribute('data-layout', 'grid')

  await expect(tileCount(page, 'open')).toHaveText('4')
  await expect(tileCount(page, 'hot')).toHaveText('2')
  await expect(tileCount(page, 'urgent')).toHaveText('2')
  await expect(tileCount(page, 'overdue')).toHaveText('1')
  await expect(tileCount(page, 'followupDue')).toHaveText('1')
  await expect(tileCount(page, 'focus')).toHaveText('1')
  await expect(wsTab(page, 'dash')).toContainText('Dashboard')
  await expect(wsTab(page, 'dash')).toContainText('4')
  await expect(dash(page).locator('[data-dash-list-tile]').getByTestId('dash-list-count')).toHaveText('1')

  // Hot rows are real task rows, with their tag and person chips.
  const outage = section(page, 'hot').locator('[data-row-key]').filter({ hasText: 'Fix checkout outage' })
  await expect(outage).toBeVisible()
  await expect(outage.getByText('#q4')).toBeVisible()
  await expect(outage.getByText(/Alice|AC/).first()).toBeVisible()
  await expect(section(page, 'hot').locator('[data-row-key]')).toHaveCount(2)

  // People: assignments loaded on a cold load (not everything "Unassigned").
  await expect(section(page, 'people').locator('[data-person-row]')).toHaveCount(3)
  await expect(section(page, 'people').locator('[data-person-row="none"]')).toContainText('2')
  await expect(section(page, 'status')).toContainText('4 open')
})

test('the top-bar filter turns counts into shown of total', async ({ page }) => {
  await seedWorkspace(page, seedWith())
  await page.getByRole('button', { name: 'Tags filter' }).click()
  await page.locator('label', { hasText: '#q4' }).click()
  await page.keyboard.press('Escape')

  await expect(tileCount(page, 'open')).toHaveText('2of 4')
  await expect(tileCount(page, 'hot')).toHaveText('2')
  await expect(tileCount(page, 'urgent')).toHaveText('1of 2')
  await expect(tileCount(page, 'overdue')).toHaveText('0of 1')
  await expect(tileCount(page, 'followupDue')).toHaveText('0of 1')
  await expect(wsTab(page, 'dash')).toContainText('2 of 4')
  await expect(section(page, 'status')).toContainText('2 of 4 open')
  await expect(section(page, 'people').locator('[data-person-row]')).toHaveCount(2)
  // The list tile: its own filter AND the screen filter.
  await expect(dash(page).locator('[data-dash-list-tile]').getByTestId('dash-list-count')).toHaveText('1')
})

test('the tab config decides which tiles and sections show; a dashboard is a layout change', async ({ page }) => {
  await seedWorkspace(page, seedWith({ dashboard: { tiles: ['focus', 'noFollowup'], sections: [{ id: 'people' }, { id: 'hot' }] } }))
  await expect(dash(page).locator('[data-dash-tile]')).toHaveCount(2)
  expect(await sectionIds(page)).toEqual(['people', 'hot'])
  // 4 + 5 share a row; the last one stretches to fill it.
  await expect(section(page, 'hot')).toHaveCSS('grid-column-start', 'span 8')
  // No list tiles: the strip holds only "+ Add list tile".
  await expect(dash(page).locator('[data-dash-list-tile]')).toHaveCount(0)
  await expect(dash(page).locator('[aria-label="List tiles"]').getByRole('button', { name: 'Add list tile' })).toBeVisible()
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')

  // Change widget → Dashboard on a new tab: an unsaved layout change.
  await page.getByRole('button', { name: 'Add widget as tab' }).click()
  await page.getByRole('menu', { name: 'Add widget' }).getByRole('menuitem', { name: 'Dashboard' }).click()
  await expect(wsCell(page, 'k1').getByRole('tab')).toHaveCount(2)
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')
})

test('a Hot row drags onto a calendar day to set its due date', async ({ page }) => {
  await seedWorkspace(page, seedWith({}, [
    { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 'calTab', kind: 'calendar', dateTypes: { due: true, followup: false } }] }] },
  ]))
  const row = section(page, 'hot').locator('[data-row-key]').filter({ hasText: 'Plan the offsite' })
  const day = wsCell(page, 'k2').locator('[data-day]').nth(2)
  await expect(row).toBeVisible()
  const from = await box(row)
  await drag(page, { x: from.x + 40, y: from.y + from.height / 2 }, await pointIn(day), {
    during: () => expect(day).toHaveAttribute('data-drop-target', 'true'),
  })
  await expect(day).toContainText('Plan the offsite')
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
})
