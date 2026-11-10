import { expect, test, type Page } from '@playwright/test'
import { openSettings, seedWorkspace, wsListWidget, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'
import { filterMenuRow, openFilterPickerByKeyboard } from './fixtures/filters'

/**
 * The filter pickers by keyboard alone: the top bar's People picker opens on
 * Enter (on its Filter menu row) with the focus in its search, ↓ goes into the rows, Space ticks one,
 * Esc closes it; Tab / Enter in its search pick the highlighted row, and in a
 * list's prompt field the highlighted match — the focus staying in the field.
 * Real-browser because focus handoffs are.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Ann task', people: ['Ann'] },
    { title: 'Bob task', people: ['Bob'] },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

const titles = (page: Page) => rowTitles(wsListWidget(page, 't1'))

test.use({ viewport: { width: 1600, height: 900 } })

test('tick a person in the top bar’s People picker with the keyboard only', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => titles(page)).toEqual(['Ann task', 'Bob task'])

  await openFilterPickerByKeyboard(page, 'People')
  const search = page.getByPlaceholder('Search...')
  await expect(search).toBeFocused()

  const list = page.getByRole('listbox', { name: 'People' })
  await page.keyboard.press('ArrowDown')
  await expect(list.getByRole('option', { name: 'None' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  const ann = list.getByRole('option', { name: 'Ann' })
  await expect(ann).toBeFocused()
  await page.keyboard.press('Space')
  await expect(ann).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => titles(page)).toEqual(['Ann task'])

  // The picker keeps the focus on the ticked row; Tab leaves the list (one tab stop).
  await expect(ann).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  // Back on its row in the Filter menu.
  await expect(filterMenuRow(page, 'People')).toBeFocused()
  await expect.poll(() => titles(page)).toEqual(['Ann task'])
})

test('Tab in the People picker’s search ticks the highlighted row and keeps the focus there', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => titles(page)).toEqual(['Ann task', 'Bob task'])

  await openFilterPickerByKeyboard(page, 'People')
  const search = page.getByPlaceholder('Search...')
  await expect(search).toBeFocused()

  const list = page.getByRole('listbox', { name: 'People' })
  await page.keyboard.type('bo')
  // The row Tab will pick is highlighted and is the search's active descendant.
  const bob = list.getByRole('option', { name: 'Bob' })
  await expect(bob).toHaveAttribute('data-search-pick', '')
  await expect(search).toHaveAttribute('aria-activedescendant', (await bob.getAttribute('id')) ?? 'missing')
  await page.keyboard.press('Tab')
  await expect(list.getByRole('option', { name: 'Bob' })).toHaveAttribute('aria-selected', 'true')
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await expect.poll(() => titles(page)).toEqual(['Bob task'])

  // Tab again on a ticked row leaves it ticked; Enter toggles.
  await page.keyboard.type('bo')
  await page.keyboard.press('Tab')
  await expect(search).toBeFocused()
  await expect(list.getByRole('option', { name: 'Bob' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.type('ann')
  await page.keyboard.press('Enter')
  await expect(search).toBeFocused()
  await expect.poll(() => titles(page)).toEqual(['Ann task', 'Bob task'])
  await expect(list.getByRole('option', { name: 'Ann' })).toHaveAttribute('aria-selected', 'true')
})

test('a named row wins the search’s pick; ↓ goes to it, and the focused row is then the only current one', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => titles(page)).toEqual(['Ann task', 'Bob task'])

  await openFilterPickerByKeyboard(page, 'People')
  // The search is a combobox over the rows' listbox.
  const search = page.getByRole('combobox', { name: 'Search...' })
  await expect(search).toBeFocused()
  const list = page.getByRole('listbox', { name: 'People' })
  await expect(search).toHaveAttribute('aria-controls', (await list.getAttribute('id')) ?? 'missing')
  await expect(search).toHaveAttribute('aria-expanded', 'true')

  // `n`: None and Ann show — Ann (a named row) is the pick, not None.
  await page.keyboard.type('n')
  const none = list.getByRole('option', { name: 'None' })
  const ann = list.getByRole('option', { name: 'Ann' })
  await expect(list.getByRole('option')).toHaveCount(2)
  await expect(ann).toHaveAttribute('data-search-pick', '')
  const background = (row: typeof ann) => row.evaluate((el) => getComputedStyle(el).backgroundColor)
  await expect.poll(() => background(ann)).not.toBe('rgba(0, 0, 0, 0)')

  // ↓ goes to the pick; ↑ to None — Ann's tint is gone while the focus is in the rows.
  await page.keyboard.press('ArrowDown')
  await expect(ann).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(none).toBeFocused()
  await expect.poll(() => background(ann)).toBe('rgba(0, 0, 0, 0)')
  // ↑ on the first row: back in the search, the pick tinted again.
  await page.keyboard.press('ArrowUp')
  await expect(search).toBeFocused()
  await expect.poll(() => background(ann)).not.toBe('rgba(0, 0, 0, 0)')
})

test('Tab in a list’s prompt field adds the highlighted person and keeps the focus in the field', async ({ page }) => {
  await seedWorkspace(page, { ...SEED, listDefinitions: [{ name: 'Team', runtimeFilter: { field: 'person' } }] })
  const widget = wsListWidget(page, 't1')
  const input = widget.getByRole('combobox', { name: 'Filter tasks by person' })
  await input.focus()
  await page.keyboard.type('bo')
  // The first match is highlighted.
  const bob = page.getByRole('option', { name: 'Bob', exact: true })
  await expect(bob).toBeVisible()
  await expect(input).toHaveAttribute('aria-activedescendant', (await bob.getAttribute('id')) ?? 'missing')
  await page.keyboard.press('Tab')
  await expect(widget.getByRole('button', { name: 'Remove Bob' })).toBeVisible()
  await expect(input).toHaveValue('')
  await expect(input).toBeFocused()
  await expect.poll(() => titles(page)).toEqual(['Bob task'])

  // Enter toggles the highlighted match.
  await page.keyboard.type('a')
  await page.keyboard.press('Enter')
  await expect(widget.getByRole('button', { name: 'Remove Ann' })).toBeVisible()
  await expect(input).toBeFocused()
  await expect.poll(() => titles(page)).toEqual(['Ann task', 'Bob task'])

  // No query: Tab moves on.
  await page.keyboard.press('Escape')
  await input.focus()
  await page.keyboard.press('Tab')
  await expect(input).not.toBeFocused()
})

test('the top bar’s Priority picker takes the focus: arrows and Space tick a value (cr31 UI F2)', async ({ page }) => {
  await seedWorkspace(page, {
    ...SEED,
    tasks: [{ title: 'Calm task' }, { title: 'Focus task', focus: true }],
  })
  await expect.poll(() => titles(page)).toEqual(['Calm task', 'Focus task'])

  await openFilterPickerByKeyboard(page, 'Priority')
  const list = page.getByRole('listbox', { name: 'Priority' })
  // No search box: the focus is on its first row.
  await expect(list.getByRole('option').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  const focus = list.getByRole('option', { name: 'Focus' })
  await expect(focus).toBeFocused()
  await page.keyboard.press('Space')
  await expect(focus).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => titles(page)).toEqual(['Focus task'])
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(filterMenuRow(page, 'Priority')).toBeFocused()
})

test('a lens’s Priority picker in Settings takes the focus too', async ({ page }) => {
  await seedWorkspace(page, { ...SEED, lenses: [{ id: 'lens-a', name: 'Mine' }] })
  const settings = await openSettings(page, 'Tasks')
  await settings.getByTestId('lens-list').getByRole('button', { name: /^Mine/ }).click()
  await settings.getByTestId('lens-filter').getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Priority' }).click()
  const list = page.getByTestId('list-filter-picker').getByRole('listbox', { name: 'Priority' })
  await expect(list.getByRole('option').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await expect(list.getByRole('option', { name: 'Focus' })).toHaveAttribute('aria-selected', 'true')
  await expect(settings.getByTestId('lens-filter').getByTestId('list-filter-chip')).toHaveText(/Priority\s*Focus/)
})

test('Delete on a focused chip in Edit list: the focus goes to the next chip, then + Filter — never <body> (cr31 UI F4)', async ({ page }) => {
  await seedWorkspace(page, {
    ...SEED,
    listDefinitions: [{ name: 'Team', people: ['Ann'], predicate: { searchText: 'task' } }],
  })
  await expect.poll(() => titles(page)).toEqual(['Ann task'])
  await page.locator('[data-ws-tab]').filter({ hasText: 'Team' }).first().getByTestId('top-line-name').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit list…' }).click()
  const editor = page.getByTestId('edit-list')
  const chips = editor.getByTestId('list-filter-chip')
  await expect(chips).toHaveCount(2)
  // A chip's own button takes the focus (its × is a sibling button, cr31 F9).
  const own = (chip: typeof chips) => chip.getByRole('button').first()
  await own(chips.first()).focus()
  await page.keyboard.press('Delete')
  await expect(chips).toHaveCount(1)
  await expect(own(chips.first())).toBeFocused()
  await page.keyboard.press('Delete')
  await expect(chips).toHaveCount(0)
  await expect(editor.getByRole('button', { name: 'Filter', exact: true })).toBeFocused()
  await expect(editor).toBeVisible()
})

test('a chip is two controls: Shift+Tab reaches its × then its own button, and the focus rings the whole chip (cr31 UI F9)', async ({ page }) => {
  await seedWorkspace(page, {
    ...SEED,
    listDefinitions: [{ name: 'Team', people: ['Ann'], predicate: { searchText: 'task' } }],
  })
  await expect.poll(() => titles(page)).toEqual(['Ann task'])
  await page.locator('[data-ws-tab]').filter({ hasText: 'Team' }).first().getByTestId('top-line-name').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit list…' }).click()
  const editor = page.getByTestId('edit-list')
  const last = editor.getByTestId('list-filter-chip').last()
  await editor.getByRole('button', { name: 'Another filter (AND)' }).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(last.getByRole('button', { name: 'Remove filter' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  const own = last.getByRole('button').first()
  await expect(own).toBeFocused()
  await expect(own).toHaveAttribute('aria-haspopup', 'dialog')
  expect(await own.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none')
  expect(await last.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
  // Enter on it opens its picker.
  await page.keyboard.press('Enter')
  await expect(own).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('list-filter-picker')).toBeVisible()
})

