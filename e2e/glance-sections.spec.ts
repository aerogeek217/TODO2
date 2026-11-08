import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * The Tags and Status widgets (the Dashboard's sections, before v77) in a
 * real browser: they render with `shown of total` counts under the top-bar
 * filter; their numbers open the task dialog; a tab menu's setting changes
 * its widget (a layout change); a phone stacks them.
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
          { id: 'r1', cells: [{ id: 'k-tags', tabs: [{ id: 'tags', kind: 'tags' }] }] },
          { id: 'r2', cells: [{ id: 'k-status', tabs: [{ id: 'status', kind: 'status' }] }] },
        ] },
      ],
    }],
  }
}

const section = (page: Page, id: string) => page.locator(`[data-glance-section="${id}"]`)
const sectionCount = (page: Page, id: string) => section(page, id).getByTestId('glance-section-count')
const tagRow = (page: Page, key: string) => section(page, 'tags').locator(`[data-tag-row="${key}"]`)
const dialog = (page: Page) => page.locator('[data-task-dialog]')
const dialogTitles = (page: Page) => dialog(page).locator('[data-todo-id]').evaluateAll((rows) =>
  rows.map((r) => r.querySelector('[data-task-title]')?.textContent ?? ''))
const saveButton = (page: Page) => page.getByTestId('layout-save')

test('the widgets render their counts; the top-bar filter makes them shown of total', async ({ page }) => {
  await seedWorkspace(page, seedWith())

  // Tags: open tasks per tag, then No tag.
  await expect(sectionCount(page, 'tags')).toHaveText('3 tagged')
  await expect(section(page, 'tags').locator('[data-tag-row]')).toHaveCount(3)
  await expect(tagRow(page, 'none')).toContainText('No tag')
  await expect(section(page, 'tags').locator('[data-tag-row]').first()).toContainText('#q4')
  await expect(section(page, 'tags').locator('[data-tag-row]').first().getByTestId('glance-tag-open')).toHaveText('2')
  await expect(sectionCount(page, 'status')).toHaveText('4 open')

  await page.getByRole('button', { name: 'Tags filter' }).click()
  await page.getByRole('option', { name: 'q4' }).click()
  await page.keyboard.press('Escape')

  await expect(sectionCount(page, 'tags')).toHaveText('2 of 3 tagged')
  await expect(section(page, 'tags').locator('[data-tag-row]')).toHaveCount(1)
  await expect(sectionCount(page, 'status')).toHaveText('2 of 4 open')
})

test('a tag row opens the task dialog with the tasks it counts', async ({ page }) => {
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
})

test('a tab menu’s setting changes its widget, as a layout change', async ({ page }) => {
  await seedWorkspace(page, seedWith())
  await expect(tagRow(page, 'none')).toBeVisible()
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')

  await wsCell(page, 'k-tags').hover()
  await wsTab(page, 'tags').click({ button: 'right' })
  const item = page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitem', { name: /^No tag/ })
  await expect(item).toContainText('Shown')
  await item.click()
  await page.getByRole('menuitemradio', { name: 'Hidden', exact: true }).click()
  await expect(tagRow(page, 'none')).toHaveCount(0)
  await expect(section(page, 'tags').locator('[data-tag-row]')).toHaveCount(2)
  await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the widgets stack in one column', async ({ page }) => {
    await seedWorkspace(page, seedWith())
    await expect(sectionCount(page, 'tags')).toHaveText('3 tagged')
    // The bar gives way, so a tag's name fits beside its counts.
    const names = section(page, 'tags').locator('[data-tag-row] [class*="tagName"]')
    await expect(names).toHaveCount(3)
    expect(await names.evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).length)).toBe(0)
    // One column: each widget as wide as the page.
    const tags = await box(section(page, 'tags'))
    const status = await box(section(page, 'status'))
    expect(Math.abs(tags.width - status.width)).toBeLessThan(1)
    expect(status.y).toBeGreaterThan(tags.y)
  })
})
