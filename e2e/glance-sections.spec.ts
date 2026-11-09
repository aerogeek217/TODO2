import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * Tags and Status — Breakdowns since D26 P8 (the Dashboard's sections
 * before v77) — in a real browser: they render their counts, narrowed by
 * the top-bar filter; their rows open the task dialog; a tab menu's
 * setting changes its widget (a layout change); a phone stacks them.
 */

test.use({ viewport: { width: 1440, height: 900 } })

function seedWith(): WorkspaceSeed {
  return {
    people: ['Alice Chen'],
    tags: ['q4', 'home'],
    tasks: [
      { title: 'Fix checkout outage', urgent: true, important: true, dueInDays: 0, tags: ['q4'], people: ['Alice Chen'] },
      { title: 'Plan the offsite', important: true, tags: ['q4'], modifiedInDays: -20 },
      { title: 'Call the plumber', dueInDays: -2, tags: ['home'], modifiedInDays: -40 },
      { title: 'Clean the garage', modifiedInDays: -10 },
      { title: 'Ship release notes', tags: ['q4'], completedInDays: -1 },
      { title: 'Old report', completedInDays: -10 },
      { title: 'Done today', completedInDays: 0 },
    ],
    layouts: [{
      name: 'Dash',
      columns: [
        // Tags over Status.
        { id: 'c1', rows: [
          { id: 'r1', cells: [{ id: 'k-tags', tabs: [{ id: 'tags', kind: 'breakdown', glance: { name: 'Tags', splitBy: 'tags' } }] }] },
          { id: 'r2', cells: [{ id: 'k-status', tabs: [{ id: 'status', kind: 'breakdown', glance: { name: 'Status', splitBy: 'status', style: 'stacked' } }] }] },
        ] },
      ],
    }],
  }
}

const chart = (page: Page, id: string) => page.locator(`[data-chart="${id}"]`)
const chartCount = (page: Page, id: string) => chart(page, id).getByTestId('glance-section-count')
const tagRows = (page: Page) => chart(page, 'tags').locator('[data-breakdown-row]')
const dialog = (page: Page) => page.locator('[data-task-dialog]')
const dialogTitles = (page: Page) => dialog(page).locator('[data-todo-id]').evaluateAll((rows) =>
  rows.map((r) => r.querySelector('[data-task-title]')?.textContent ?? ''))
const saveButton = (page: Page) => page.getByTestId('layout-save')

test('the widgets render their counts; the top-bar filter narrows them', async ({ page }) => {
  await seedWorkspace(page, seedWith())

  // Tags: open tasks per tag, then No tags.
  await expect(chartCount(page, 'tags')).toHaveText('4 open')
  await expect(tagRows(page)).toHaveCount(3)
  await expect(tagRows(page).last()).toContainText('No tags')
  await expect(tagRows(page).filter({ hasText: '#q4' }).getByTestId('breakdown-figure')).toHaveText('2')
  await expect(chartCount(page, 'status')).toHaveText('4 open')

  await page.getByRole('button', { name: 'Tags filter' }).click()
  await page.getByRole('option', { name: 'q4' }).click()
  await page.keyboard.press('Escape')

  // The # pick narrows the Tags rows to q4 (as a list grouped by Tag); Status counts what the top bar shows.
  await expect(chartCount(page, 'tags')).toHaveText('2 open')
  await expect(tagRows(page)).toHaveCount(1)
  await expect(chartCount(page, 'status')).toHaveText('2 open')
})

test('a tag row opens the task dialog with the tasks it counts', async ({ page }) => {
  await seedWorkspace(page, seedWith())

  // The tag assignments load after the tasks: until they do, every task is untagged.
  const q4 = tagRows(page).filter({ hasText: '#q4' })
  await expect(q4).toHaveCount(1)
  await q4.click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Tags · #q4')
  await expect(dialog(page)).toContainText('Tags: the tasks tagged #q4.')
  expect((await dialogTitles(page)).sort()).toEqual(['Fix checkout outage', 'Plan the offsite'])
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
})

test('a tab menu’s setting changes its widget, as a layout change', async ({ page }) => {
  await seedWorkspace(page, seedWith())
  await expect(chart(page, 'tags').locator('[data-breakdown-row="none"]')).toBeVisible()
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')

  await wsCell(page, 'k-tags').hover()
  await wsTab(page, 'tags').click({ button: 'right' })
  const item = page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: /^No tags/ })
  await expect(item).toContainText('Shown')
  await item.click()
  await page.getByRole('menuitemradio', { name: 'Hidden', exact: true }).click()
  await expect(chart(page, 'tags').locator('[data-breakdown-row="none"]')).toHaveCount(0)
  await expect(tagRows(page)).toHaveCount(2)
  await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the widgets stack in one column', async ({ page }) => {
    await seedWorkspace(page, seedWith())
    await expect(chartCount(page, 'tags')).toHaveText('4 open')
    // A narrow table: the bar and Priority give way, so a tag's name fits beside its counts.
    await expect(tagRows(page)).toHaveCount(3)
    await expect(chart(page, 'tags').locator('[data-col="bar"]').first()).toBeHidden()
    const names = chart(page, 'tags').locator('[data-breakdown-row] [role="cell"]:first-child button:first-child')
    expect(await names.evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length)).toBe(0)
    // One column: each widget as wide as the page.
    const tags = await box(chart(page, 'tags'))
    const status = await box(chart(page, 'status'))
    expect(Math.abs(tags.width - status.width)).toBeLessThan(1)
    expect(status.y).toBeGreaterThan(tags.y)
  })
})
