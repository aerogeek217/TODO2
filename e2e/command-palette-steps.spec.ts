import { expect, test, type Page } from '@playwright/test'
import { edges, expectOpenLayout, layoutTab, seedWorkspace, wsCell, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The command palette's second steps (UX cleanup 3B), in the real browser:
 * a step opens in place under a breadcrumb with the focus kept in the
 * field; Backspace in the empty field and Esc go back a step; the focus
 * returns to what opened the palette only when it closes or a leaf runs;
 * and each leaf does its job — Go to Layout ›, Lens ›, Add Widget › (the
 * Where picker on the cell last used), Review With ›, Theme ›.
 */

const SEED: WorkspaceSeed = {
  people: ['Aisha Rahman', 'Ben Ortiz'],
  tasks: [
    { title: 'Answer Northwind on the SLA', people: ['Aisha Rahman'] },
    { title: 'Shared rollout plan', people: ['Ben Ortiz', 'Aisha Rahman'] },
    { title: 'Ben’s own task', people: ['Ben Ortiz'] },
  ],
  lenses: [{ id: 'lens-ben', name: 'Ben only', predicate: { personIds: [2] } }],
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
    { name: 'Planning', columns: [{ id: 'p1', rows: [wsRow({ id: 'pk', tabs: [{ id: 'pTab', kind: 'notes' }] })] }] },
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
  expect(rest).toEqual(expect.arrayContaining(['Theme', 'Go to Layout', 'Add Widget', 'Lens', 'Review With', 'Email Check-in']))
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

test('Lens › picks the top bar’s lens; No lens takes it off', async ({ page }) => {
  await open(page)
  const lens = page.getByTestId('lens-control')
  await expect(lens).toHaveAttribute('data-state', 'none')
  await openPalette(page)
  await page.getByRole('option', { name: 'Lens', exact: true }).click()
  expect(await optionNames(page)).toEqual(['No lens', 'Ben only'])
  await expect(options(page).filter({ hasText: 'No lens' })).toContainText('Current')
  await field(page).pressSequentially('ben')
  await page.keyboard.press('Enter')
  await expect(field(page)).toHaveCount(0)
  await expect(lens).toHaveAttribute('data-state', 'on')
  await expect(lens).toContainText('Ben only')
  await openPalette(page)
  await field(page).pressSequentially('no lens')
  await expect(options(page).first()).toHaveText('Lens › No lens')
  await page.keyboard.press('Enter')
  await expect(lens).toHaveAttribute('data-state', 'none')
})

test('Add Widget › kind opens the Where picker on the cell last used, the kind chosen', async ({ page }) => {
  await open(page)
  const b = await edges(wsCell(page, 'b'))
  // The cell last used: the one holding the focus when the palette opens.
  await wsCell(page, 'b').locator('button').first().focus()
  await openPalette(page)
  await field(page).pressSequentially('add widget notes')
  await expect(options(page).first()).toHaveText('Add Widget › Notes')
  await page.keyboard.press('Enter')
  await expect(field(page)).toHaveCount(0)

  const menu = page.getByRole('menu', { name: 'Add widget' })
  await expect(menu).toBeVisible()
  // Opened over cell b, under its top line; the Where picture has the focus, on Tab.
  const m = await edges(menu)
  expect(m.left).toBeGreaterThanOrEqual(b.left - 1)
  expect(m.top).toBeGreaterThan(b.top)
  const where = menu.getByRole('group', { name: 'Where' })
  await expect(where.getByRole('menuitemradio', { name: 'Add as tab' })).toBeFocused()
  // Only the chosen kind: no list of kinds.
  await expect(menu.getByRole('menuitem', { name: 'Calendar', exact: true })).toHaveCount(0)
  await where.getByRole('menuitemradio', { name: 'Split · below' }).click()
  await menu.getByRole('menuitem', { name: 'Add Notes' }).click()
  await expect(menu).toHaveCount(0)
  await expect(page.locator('[data-ws-cell]')).toHaveCount(3)
  const added = page.locator('[data-ws-cell]').filter({ hasNot: page.locator('[data-ws-tab="aTab"], [data-ws-tab="bTab"]') })
  const n = await edges(added)
  expect(n.left).toBeCloseTo(b.left, -1)
  expect(n.top).toBeGreaterThan(b.top + (b.bottom - b.top) / 2 - 40)
})

test('Review With › person opens the review deck on their open tasks', async ({ page }) => {
  await open(page)
  await openPalette(page)
  await page.getByRole('option', { name: 'Review With', exact: true }).click()
  await expect(options(page).filter({ hasText: 'Aisha Rahman' })).toContainText('2 open tasks')
  await expect(options(page).filter({ hasText: 'Ben Ortiz' })).toContainText('2 open tasks')
  await field(page).pressSequentially('aisha')
  await page.keyboard.press('Enter')
  const deck = page.locator('[data-review-deck]')
  await expect(deck).toBeVisible()
  await expect(deck.getByTestId('review-position')).toHaveText('1 of 2')
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
