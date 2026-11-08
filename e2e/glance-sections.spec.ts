import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'

/**
 * The Tags, Stale tasks, Recently completed and Eisenhower summary widgets
 * (the Dashboard's sections, before v77) in a real browser: they render with
 * `shown of total` counts under the top-bar filter; their numbers open the
 * task dialog; a tab menu's setting changes its widget (a layout change);
 * the Stale / Recently completed rows are real task rows (selection, drag
 * out, complete / reopen); a phone stacks them.
 */

test.use({ viewport: { width: 1440, height: 900 } })

function seedWith(extraColumns: WorkspaceSeed['layouts'][number]['columns'] = []): WorkspaceSeed {
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
        // Tags beside the Eisenhower summary, Stale tasks beside Recently completed.
        { id: 'c1', rows: [
          { id: 'r1', cells: [{ id: 'k-tags', tabs: [{ id: 'tags', kind: 'tags' }] }, { id: 'k-eis', tabs: [{ id: 'eis', kind: 'eisenhowerSummary' }] }] },
          { id: 'r2', cells: [{ id: 'k-stale', tabs: [{ id: 'stale', kind: 'stale' }] }, { id: 'k-recent', tabs: [{ id: 'recent', kind: 'recent' }] }] },
        ] },
        ...extraColumns,
      ],
    }],
  }
}

const section = (page: Page, id: string) => page.locator(`[data-glance-section="${id}"]`)
const sectionCount = (page: Page, id: string) => section(page, id).getByTestId('glance-section-count')
const tagRow = (page: Page, key: string) => section(page, 'tags').locator(`[data-tag-row="${key}"]`)
const quadrant = (page: Page, q: string) => section(page, 'eisenhower').locator(`[data-eis-cell="${q}"]`)
const quadrantCount = (page: Page, q: string) => quadrant(page, q).getByTestId('glance-eis-count')
const rowTitles = (root: Locator) => root.locator('[data-row-todo]').evaluateAll((rows) =>
  rows.map((r) => r.querySelector('[data-task-title]')?.textContent ?? ''))
const dialog = (page: Page) => page.locator('[data-task-dialog]')
const dialogTitles = (page: Page) => dialog(page).locator('[data-todo-id]').evaluateAll((rows) =>
  rows.map((r) => r.querySelector('[data-task-title]')?.textContent ?? ''))
const saveButton = (page: Page) => page.getByTestId('layout-save')

test('the four widgets render their counts and rows; the top-bar filter makes them shown of total', async ({ page }) => {
  await seedWorkspace(page, seedWith())

  // Tags: open tasks per tag, then No tag.
  await expect(sectionCount(page, 'tags')).toHaveText('3 tagged')
  await expect(section(page, 'tags').locator('[data-tag-row]')).toHaveCount(3)
  await expect(tagRow(page, 'none')).toContainText('No tag')
  await expect(section(page, 'tags').locator('[data-tag-row]').first()).toContainText('#q4')
  await expect(section(page, 'tags').locator('[data-tag-row]').first().getByTestId('glance-tag-open')).toHaveText('2')

  // Stale tasks: oldest first, real task rows.
  await expect(sectionCount(page, 'stale')).toHaveText('2')
  await expect(section(page, 'stale')).toContainText('Not changed in 14 days or more · oldest 40 days')
  await expect(section(page, 'stale').locator('[data-row-todo]')).toHaveCount(2)
  expect(await rowTitles(section(page, 'stale'))).toEqual(['Call the plumber', 'Plan the offsite'])
  await expect(section(page, 'stale').locator('[data-row-todo]').first().getByText('#home')).toBeVisible()

  // Recently completed: the last 7 days, newest first.
  await expect(sectionCount(page, 'recent')).toHaveText('2')
  expect(await rowTitles(section(page, 'recent'))).toEqual(['Done today', 'Ship release notes'])

  // Eisenhower: one open task per quadrant; the plumber is urgent by its date.
  for (const q of ['do', 'schedule', 'delegate', 'drop']) await expect(quadrantCount(page, q)).toHaveText('1')
  await expect(quadrant(page, 'delegate')).toContainText('1 by due date')
  await expect(sectionCount(page, 'eisenhower')).toHaveText('4 open')

  await page.getByRole('button', { name: 'Tags filter' }).click()
  await page.getByRole('option', { name: 'q4' }).click()
  await page.keyboard.press('Escape')

  await expect(sectionCount(page, 'tags')).toHaveText('2 of 3 tagged')
  await expect(section(page, 'tags').locator('[data-tag-row]')).toHaveCount(1)
  await expect(sectionCount(page, 'stale')).toHaveText('1 of 2')
  expect(await rowTitles(section(page, 'stale'))).toEqual(['Plan the offsite'])
  await expect(sectionCount(page, 'recent')).toHaveText('1 of 2')
  await expect(quadrantCount(page, 'do')).toHaveText('1')
  await expect(quadrantCount(page, 'delegate')).toHaveText('0of 1')
  await expect(sectionCount(page, 'eisenhower')).toHaveText('2 of 4 open')
})

test('their numbers open the task dialog with the tasks they count', async ({ page }) => {
  await seedWorkspace(page, seedWith())

  // The tag assignments load after the tasks: until they do, every task is
  // untagged and No tag is the first row.
  await expect(section(page, 'tags').locator('[data-tag-row]').first()).toContainText('#q4')
  await section(page, 'tags').locator('[data-tag-row]').first().click()
  await expect(dialog(page).getByRole('heading')).toHaveText('#q4')
  await expect(dialog(page)).toContainText('Open tasks tagged #q4.')
  expect(await dialogTitles(page)).toEqual(['Fix checkout outage', 'Plan the offsite'])
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  await quadrant(page, 'delegate').click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Delegate')
  await expect(dialog(page)).toContainText('Open tasks that are urgent, not important. Urgent includes tasks due within 3 days.')
  expect(await dialogTitles(page)).toEqual(['Call the plumber'])
  await page.keyboard.press('Escape')

  await sectionCount(page, 'stale').click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Stale tasks')
  expect(await dialogTitles(page)).toEqual(['Call the plumber', 'Plan the offsite'])
  await page.keyboard.press('Escape')

  await sectionCount(page, 'recent').click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Recently completed')
  await expect(dialog(page).getByTestId('task-dialog-count')).toHaveText('2')
  expect(await dialogTitles(page)).toEqual(['Done today', 'Ship release notes'])
})

test('a tab menu’s setting changes its widget, as a layout change', async ({ page }) => {
  await seedWorkspace(page, seedWith())
  await expect(section(page, 'stale')).toContainText('Not changed in 14 days or more')
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  expect(await rowTitles(section(page, 'stale'))).toEqual(['Call the plumber', 'Plan the offsite'])

  const pick = async (from: string, to: string) => {
    await wsCell(page, 'k-stale').hover()
    await wsTab(page, 'stale').click({ button: 'right' })
    const item = page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitem', { name: /^Older than/ })
    await expect(item).toContainText(from)
    await item.click()
    await page.getByRole('menuitemradio', { name: to, exact: true }).click()
  }
  await pick('14 days', '30 days')
  await expect(section(page, 'stale')).toContainText('Not changed in 30 days or more')
  await expect(section(page, 'stale').locator('[data-row-todo]')).toHaveCount(1)
  await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
  await pick('30 days', '7 days')
  await expect(section(page, 'stale').locator('[data-row-todo]')).toHaveCount(3)
})

test('Stale and Recently completed rows are task rows: select, drag out, reopen', async ({ page }) => {
  await seedWorkspace(page, seedWith([
    { id: 'c2', rows: [{ cells: [{ id: 'k2', tabs: [{ id: 'calTab', kind: 'calendar', dateTypes: { due: true, followup: false }, titles: true }] }] }] },
  ]))
  const stale = section(page, 'stale')
  const title = (root: Locator, t: string) => root.locator('[data-row-todo]').filter({ hasText: t }).locator(`span[data-task-title="${t}"]`)

  // Selection: click + Ctrl-click → the bulk bar.
  await title(stale, 'Call the plumber').click()
  await title(stale, 'Plan the offsite').click({ modifiers: ['Control'] })
  await expect(stale.locator('[data-selected="true"]')).toHaveCount(2)
  await expect(page.getByTestId('list-bulk-bar')).toContainText('2 selected')
  await page.keyboard.press('Escape')
  await expect(stale.locator('[data-selected="true"]')).toHaveCount(0)

  // Drag a stale row onto a calendar day: it gets that due date.
  const row = stale.locator('[data-row-todo]').filter({ hasText: 'Plan the offsite' })
  const day = wsCell(page, 'k2').locator('[data-day]').nth(2)
  const from = await box(row)
  await drag(page, { x: from.x + 40, y: from.y + from.height / 2 }, await pointIn(day), {
    during: () => expect(day).toHaveAttribute('data-drop-target', 'true'),
  })
  await expect(day).toContainText('Plan the offsite')
  // Changed just now, so it is no longer stale.
  await expect(stale.locator('[data-row-todo]').filter({ hasText: 'Plan the offsite' })).toHaveCount(0)

  // A recently completed row shows as completed; reopening it takes it out of the section.
  const recent = section(page, 'recent')
  const done = recent.locator('[data-row-todo]').filter({ hasText: 'Ship release notes' })
  // Struck through: the strike (D19) fills the title's text.
  await expect(done.locator('span[data-task-title="Ship release notes"] [data-title-text]')).toHaveCSS('background-size', '100% 1.5px')
  await done.getByRole('checkbox', { name: 'Mark incomplete' }).click()
  await expect(sectionCount(page, 'recent')).toHaveText('1')
  await expect(recent.locator('[data-row-todo]').filter({ hasText: 'Ship release notes' })).toHaveCount(0)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the widgets stack in one column with touch rows', async ({ page }) => {
    await seedWorkspace(page, seedWith())
    await expect(sectionCount(page, 'tags')).toHaveText('3 tagged')
    // The bar gives way, so a tag's name fits beside its counts.
    const names = section(page, 'tags').locator('[data-tag-row] [class*="tagName"]')
    await expect(names).toHaveCount(3)
    expect(await names.evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).length)).toBe(0)
    await expect(section(page, 'stale').getByText('Call the plumber')).toBeVisible()
    await expect(quadrantCount(page, 'drop')).toHaveText('1')
    // One column: each widget as wide as the page.
    const tags = await box(section(page, 'tags'))
    const eis = await box(section(page, 'eisenhower'))
    expect(Math.abs(tags.width - eis.width)).toBeLessThan(1)
    expect(eis.y).toBeGreaterThan(tags.y)
  })
})
