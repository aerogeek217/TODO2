import { expect, test, type Page } from '@playwright/test'
import { expectOpenLayout, layoutTab, reviewField, seedWorkspace, wsCell, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The command palette's second steps (UX cleanup 3B), in the real browser:
 * a step opens in place under a breadcrumb with the focus kept in the
 * field; Backspace in the empty field and Esc go back a step; the focus
 * returns to what opened the palette only when it closes or a leaf runs;
 * and each leaf does its job — Go to Layout ›, Add Widget › (the
 * Where picker on the cell last used), Review With › (a jump to the Review
 * widget), Theme ›.
 */

const SEED: WorkspaceSeed = {
  people: ['Aisha Rahman', 'Ben Ortiz'],
  tasks: [
    { title: 'Answer Northwind on the SLA', people: ['Aisha Rahman'] },
    { title: 'Shared rollout plan', people: ['Ben Ortiz', 'Aisha Rahman'] },
    { title: 'Ben’s own task', people: ['Ben Ortiz'] },
  ],
  layouts: [
    {
      name: 'Main',
      table: {
        areas: ['a b'],
        cells: [
          { id: 'a', tabs: [{ id: 'aTab', kind: 'notes' }] },
          { id: 'b', tabs: [{ id: 'bTab', kind: 'calendar' }] },
        ],
      },
    },
    // Its Review widget: where Review With › jumps.
    { name: 'Planning', columns: [{ id: 'p1', rows: [wsRow({ id: 'pk', tabs: [{ id: 'pTab', kind: 'review' }] })] }] },
  ],
}

test.use({ viewport: { width: 1440, height: 900 } })

const field = (page: Page) => page.getByPlaceholder(/Find tasks, commands|Type to filter/)
const crumb = (page: Page) => page.getByTestId('command-palette-crumb')
const options = (page: Page) => page.getByRole('listbox').getByRole('option')
const optionNames = (page: Page) => options(page).evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent ?? ''))

async function open(page: Page): Promise<void> {
  await seedWorkspace(page, SEED)
  await wsCell(page, 'a').waitFor({ state: 'visible' })
}

/** Opens the palette from what has the focus. */
async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k')
  await expect(field(page)).toBeFocused()
}

test('a step opens in place; Backspace and Esc go back; the focus returns to the opener only on close', async ({ page }) => {
  await open(page)
  const opener = layoutTab(page, 'Main')
  await opener.focus()
  await openPalette(page)

  // At rest: the step commands, not their leaves.
  const rest = await optionNames(page)
  expect(rest).toEqual(expect.arrayContaining(['Theme', 'Go to Layout', 'Add Widget', 'Review With']))
  // The check-ins live on the Review widget's field (widget feedback 2B).
  expect(rest).not.toContain('Email Check-in')
  expect(rest.filter((n) => n.includes('›'))).toEqual([])

  await field(page).pressSequentially('go to lay')
  await expect(options(page).first()).toHaveText(/^Go to Layout/)
  await page.keyboard.press('Enter')
  await expect(crumb(page)).toHaveText(/Go to Layout\s*›/)
  await expect(field(page)).toBeFocused()
  await expect(field(page)).toHaveValue('')
  expect(await optionNames(page)).toEqual(['Main', 'Planning'])
  await expect(options(page).filter({ hasText: 'Main' })).toContainText('Current')
  // The active row is the listbox's active descendant.
  await page.keyboard.press('ArrowDown')
  const active = await field(page).getAttribute('aria-activedescendant')
  await expect(page.locator(`[id="${active}"]`)).toContainText('Planning')

  // Backspace in the empty field: back, the query and the step row as they were.
  await page.keyboard.press('Backspace')
  await expect(crumb(page)).toHaveCount(0)
  await expect(field(page)).toHaveValue('go to lay')
  await expect(field(page)).toBeFocused()

  // A click on a step keeps the focus in the field; Esc goes back once, then closes.
  await field(page).fill('')
  await options(page).filter({ hasText: /^Theme/ }).click()
  await expect(crumb(page)).toHaveText(/Theme\s*›/)
  await expect(field(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(crumb(page)).toHaveCount(0)
  await expect(field(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(field(page)).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('a query reaches into the steps; Enter on a leaf there switches the layout as its tab does', async ({ page }) => {
  await open(page)
  await openPalette(page)
  await field(page).pressSequentially('planning')
  await expect(options(page).first()).toHaveText('Go to Layout › Planning')
  await page.keyboard.press('Enter')
  await expect(field(page)).toHaveCount(0)
  await expectOpenLayout(page, 'Planning')
  // And back, from inside the step.
  await openPalette(page)
  await page.getByRole('option', { name: 'Go to Layout', exact: true }).click()
  await page.getByRole('option', { name: 'Main', exact: true }).click()
  await expectOpenLayout(page, 'Main')
  await expect(wsCell(page, 'a')).toBeVisible()
})

test('Add Widget › kind adds it as a tab of the cell last used — no Where step, the cells as they were', async ({ page }) => {
  await open(page)
  // The cell last used: the one holding the focus when the palette opens.
  await wsCell(page, 'b').locator('button').first().focus()
  await openPalette(page)
  await field(page).pressSequentially('add widget notes')
  await expect(options(page).first()).toHaveText('Add Widget › Notes')
  await page.keyboard.press('Enter')
  await expect(field(page)).toHaveCount(0)
  // No Where picker: added at once, a tab of cell b, made its active one (layout edit mode E4).
  await expect(page.getByRole('menu', { name: 'Add widget' })).toHaveCount(0)
  await expect(page.locator('[data-ws-cell]')).toHaveCount(2)
  await expect(wsCell(page, 'b').getByRole('tab')).toHaveCount(2)
  await expect(wsCell(page, 'b').getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
})

test('Review With › person opens the popup review with @<name> (the Review widget on the other layout left alone)', async ({ page }) => {
  await open(page)
  await openPalette(page)
  await page.getByRole('option', { name: 'Review With', exact: true }).click()
  await expect(options(page).filter({ hasText: 'Aisha Rahman' })).toContainText('2 open tasks')
  await expect(options(page).filter({ hasText: 'Ben Ortiz' })).toContainText('2 open tasks')
  await field(page).pressSequentially('aisha')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('widget-popup')).toBeVisible()
  await expect(reviewField(page, 'review-popup')).toHaveValue('@"Aisha Rahman"')
  await expect(page.locator('[data-review-widget="review-popup"] [data-review-row]')).toHaveCount(2)
  await expect(reviewField(page, 'pTab')).toHaveCount(0)
})

test('Theme › switches the theme, the current one marked', async ({ page }) => {
  await open(page)
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await openPalette(page)
  await field(page).pressSequentially('theme light')
  await expect(options(page).first()).toHaveText('Theme › Light')
  await page.keyboard.press('Enter')
  await expect(html).toHaveAttribute('data-theme', 'light')
  await openPalette(page)
  await page.getByRole('option', { name: 'Theme', exact: true }).click()
  await expect(options(page).filter({ hasText: 'Light' })).toContainText('Current')
  await page.getByRole('option', { name: /^Dark/ }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
})

test('New Layout… and Duplicate Layout… open their name dialogs', async ({ page }) => {
  await open(page)
  await openPalette(page)
  await field(page).pressSequentially('new layout')
  await page.getByRole('option', { name: 'New Layout…' }).click()
  const created = page.getByRole('dialog', { name: 'New layout' })
  await expect(created).toBeVisible()
  await created.getByLabel('Name').fill('Fresh')
  await created.getByRole('button', { name: 'Create layout' }).click()
  await expectOpenLayout(page, 'Fresh')
  await openPalette(page)
  await field(page).pressSequentially('duplicate layout')
  await page.getByRole('option', { name: 'Duplicate Layout…' }).click()
  await expect(page.getByRole('dialog', { name: 'Duplicate layout' }).getByLabel('Name')).toHaveValue('Fresh copy')
})
