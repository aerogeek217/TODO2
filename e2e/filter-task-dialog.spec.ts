import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'

/**
 * The screen filter's tasks in the task dialog: the top bar's Show N tasks
 * (while a filter is on) and the palette open them; the dialog's filter
 * bar is the screen filter itself — a change there changes the rows and
 * the workspace behind; its pickers open above the dialog and take the
 * first Esc. The tray's measured fold still keeps the bar on one line with
 * the button. On a phone the Filters sheet ends with the button.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob'],
  tags: ['q4'],
  statuses: ['Waiting'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Ann plan', people: ['Ann'], tags: ['q4'] },
    { title: 'Ann call', people: ['Ann'] },
    { title: 'Bob task', people: ['Bob'], tags: ['q4'] },
    { title: 'Nobody task' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

const ALL = ['Ann plan', 'Ann call', 'Bob task', 'Nobody task']
const workspaceTitles = (page: Page) => rowTitles(wsListWidget(page, 't1'))
const dialog = (page: Page) => page.locator('[data-task-dialog]')
const dialogTitles = (page: Page) => rowTitles(dialog(page))
const dialogBar = (page: Page) => dialog(page).getByRole('group', { name: 'Screen filters — apply to every widget' })

/** Whether the element on top at `locator`'s centre is inside it (nothing covers it). */
async function onTop(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit != null && el.contains(hit)
  })
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Show N tasks opens them; a chip edited in the dialog changes its rows and the workspace; Esc closes the picker, then the dialog', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect.poll(() => workspaceTitles(page)).toEqual(ALL)
    const tray = page.locator('header').getByRole('group', { name: 'Screen filters — apply to every widget' })
    await expect(tray.getByRole('button', { name: /^Show \d+ tasks?$/ })).toHaveCount(0)

    await tray.getByRole('button', { name: 'People filter' }).click()
    await page.getByRole('option', { name: '@Ann' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => workspaceTitles(page)).toEqual(['Ann plan', 'Ann call'])
    const show = tray.getByRole('button', { name: 'Show 2 tasks' })
    await expect(show).toBeVisible()
    await show.hover()
    await expect(page.getByRole('tooltip')).toHaveText('Show the tasks matching the filter')

    await show.click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByRole('heading')).toHaveText('Filtered tasks')
    await expect(dialog(page).getByTestId('task-dialog-count')).toHaveText('2')
    await expect.poll(() => dialogTitles(page)).toEqual(['Ann plan', 'Ann call'])
    await expect(dialogBar(page).getByRole('button', { name: 'People filter: Ann' })).toBeVisible()

    // A chip in the dialog: its picker opens above the dialog.
    await dialogBar(page).getByRole('button', { name: 'Tags filter' }).click()
    const q4 = page.getByRole('option', { name: '#q4' })
    await expect(q4).toBeVisible()
    expect(await onTop(q4)).toBe(true)
    await q4.click()
    await expect.poll(() => dialogTitles(page)).toEqual(['Ann plan'])
    await expect(dialog(page).getByTestId('task-dialog-count')).toHaveText('1')
    // The workspace behind follows (one filter).
    await expect.poll(() => workspaceTitles(page)).toEqual(['Ann plan'])
    await expect(tray.getByRole('button', { name: 'Tags filter: q4' })).toBeAttached()

    // Esc: the picker first, the dialog stays; then the dialog.
    await page.keyboard.press('Escape')
    await expect(q4).toBeHidden()
    await expect(dialog(page)).toBeVisible()
    await expect(dialogBar(page).getByRole('button', { name: 'Tags filter: q4' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(tray.getByRole('button', { name: 'Show 1 task' })).toBeVisible()
  })

  test('the Dates and Priority pickers open above the dialog and take the first Esc too', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await page.locator('header').getByRole('button', { name: 'Show completed' }).click()
    await page.locator('header').getByRole('button', { name: 'Show 4 tasks' }).click()
    await expect(dialog(page)).toBeVisible()
    for (const name of ['Dates filter', 'Priority filter']) {
      const button = dialogBar(page).getByRole('button', { name, exact: true })
      await button.click()
      await expect(button).toHaveAttribute('aria-expanded', 'true')
      const panel = name === 'Dates filter'
        ? page.getByRole('dialog', { name: 'Date filters' })
        : page.getByRole('group', { name: 'Priority', exact: true })
      await expect(panel).toBeVisible()
      expect(await onTop(panel)).toBe(true)
      await page.keyboard.press('Escape')
      await expect(button).toHaveAttribute('aria-expanded', 'false')
      await expect(dialog(page)).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
  })

  test('Clear all in the dialog clears the screen filter and keeps it open on every open task; rows stay fixed between filter changes', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await page.locator('header').getByRole('textbox', { name: 'Search tasks' }).fill('ann')
    const tray = page.locator('header').getByRole('group', { name: 'Screen filters — apply to every widget' })
    await tray.getByRole('button', { name: 'Show 2 tasks' }).click()
    await expect.poll(() => dialogTitles(page)).toEqual(['Ann plan', 'Ann call'])
    await expect(dialogBar(page).getByRole('textbox', { name: 'Search tasks' })).toHaveValue('ann')

    // Completed here: the row stays, struck through.
    const call = dialog(page).locator('[data-todo-id]').filter({ hasText: 'Ann call' })
    await call.getByRole('checkbox', { name: 'Mark complete' }).click()
    await expect(call.getByRole('checkbox', { name: 'Mark incomplete' })).toBeChecked()
    await expect.poll(() => dialogTitles(page)).toEqual(['Ann plan', 'Ann call'])
    await expect.poll(() => workspaceTitles(page)).toEqual(['Ann plan'])

    await dialogBar(page).getByRole('button', { name: 'Clear all filters' }).click()
    await expect(dialog(page)).toBeVisible()
    await expect.poll(() => dialogTitles(page)).toEqual(['Ann plan', 'Bob task', 'Nobody task'])
    await expect(dialogBar(page).getByRole('textbox', { name: 'Search tasks' })).toHaveValue('')
    await expect(dialog(page)).toContainText('Every open task: no screen filter is on.')
    await expect.poll(() => workspaceTitles(page)).toEqual(['Ann plan', 'Bob task', 'Nobody task'])
    await expect(page.locator('header').getByRole('textbox', { name: 'Search tasks' })).toHaveValue('')
  })

  test('the palette’s Show Tasks Matching the Filter opens them (with no filter, every open task)', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('matching the filter')
    const option = page.getByRole('option', { name: /Show Tasks Matching the Filter/ })
    await expect(option).toContainText('4 tasks')
    await option.click()
    await expect(dialog(page)).toBeVisible()
    await expect.poll(() => dialogTitles(page)).toEqual(ALL)
  })

  test('the measured fold keeps the bar on one line with Show N tasks', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await seedWorkspace(page, SEED)
    const header = page.locator('header')
    await expect(header.getByRole('button', { name: 'Status filter', exact: true })).toBeVisible()
    const fit = () => header.evaluate((bar) => {
      const box = bar.getBoundingClientRect()
      const parts = [...bar.querySelectorAll('button, input')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0)
      return {
        height: box.height,
        overflow: bar.scrollWidth - bar.clientWidth,
        outside: parts.filter((r) => r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5).length,
      }
    })
    await header.getByRole('button', { name: 'Show completed' }).click()
    await expect(header.getByRole('button', { name: 'Show 4 tasks' })).toBeVisible()
    await expect.poll(fit).toEqual({ height: 40, overflow: 0, outside: 0 })
    // Narrower: the filters fold into the menu; the button stays.
    await page.setViewportSize({ width: 1000, height: 800 })
    await expect(header.getByRole('button', { name: 'Filters', exact: true })).toBeVisible()
    await expect(header.getByRole('button', { name: 'Show 4 tasks' })).toBeVisible()
    await expect.poll(fit).toEqual({ height: 40, overflow: 0, outside: 0 })
    // The filter off: the button goes, the room comes back.
    await page.setViewportSize({ width: 1280, height: 800 })
    await header.getByRole('button', { name: 'Clear all filters' }).click()
    await expect(header.getByRole('button', { name: /^Show \d+ tasks?$/ })).toHaveCount(0)
    await expect(header.getByRole('button', { name: 'Status filter', exact: true })).toBeVisible()
    await expect.poll(fit).toEqual({ height: 40, overflow: 0, outside: 0 })
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the Filters sheet ends with Show N tasks; the dialog’s Filters edit the screen filter', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const rows = page.locator('[data-ws-area] [data-todo-id]')
    await expect(rows).toHaveCount(4)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('tab', { name: 'Filters', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Show \d+ tasks?$/ })).toHaveCount(0)
    await page.getByPlaceholder('Search tasks...').fill('ann')
    await page.getByRole('button', { name: 'Show 2 tasks' }).click()
    await expect(page.getByPlaceholder('Search tasks...')).toHaveCount(0)
    await expect(dialog(page)).toBeVisible()
    // Phone rows: their text (no title attribute on a phone row).
    const dialogRows = dialog(page).locator('[data-todo-id]')
    await expect(dialogRows).toHaveCount(2)
    await expect(dialogRows.nth(0)).toContainText('Ann plan')
    await expect(dialogRows.nth(1)).toContainText('Ann call')

    const filters = dialog(page).getByRole('button', { name: 'Filters', exact: true })
    await expect(filters).toHaveAttribute('aria-expanded', 'false')
    await filters.click()
    await dialog(page).getByText('Show / hide', { exact: true }).click()
    await dialog(page).getByRole('switch', { name: 'Show completed' }).click()
    await expect(dialog(page).getByRole('button', { name: 'Filters, 1 active' })).toBeVisible()
    await dialog(page).getByRole('textbox', { name: 'Search tasks' }).fill('')
    await expect(dialogRows).toHaveCount(4)
    await expect(rows).toHaveCount(4)
  })
})
