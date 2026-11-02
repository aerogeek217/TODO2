import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'

/**
 * The filter pickers by keyboard alone: the top bar's People picker opens on
 * Enter with the focus in its search, ↓ goes into the rows, Space ticks one,
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
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

const titles = (page: Page) => rowTitles(wsListWidget(page, 't1'))

test.use({ viewport: { width: 1600, height: 900 } })

test('tick a person in the top bar’s People picker with the keyboard only', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => titles(page)).toEqual(['Ann task', 'Bob task'])

  const button = page.getByRole('button', { name: /^People filter/ })
  await button.focus()
  await page.keyboard.press('Enter')
  const search = page.getByPlaceholder('Search...')
  await expect(search).toBeFocused()

  const list = page.getByRole('listbox', { name: 'People' })
  await page.keyboard.press('ArrowDown')
  await expect(list.getByRole('option', { name: 'None' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  const ann = list.getByRole('option', { name: '@Ann' })
  await expect(ann).toBeFocused()
  await page.keyboard.press('Space')
  await expect(ann).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => titles(page)).toEqual(['Ann task'])

  // The picker keeps the focus on the ticked row; Tab leaves the list (one tab stop).
  await expect(ann).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(button).toBeFocused()
  await expect.poll(() => titles(page)).toEqual(['Ann task'])
})

test('Tab in the People picker’s search ticks the highlighted row and keeps the focus there', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => titles(page)).toEqual(['Ann task', 'Bob task'])

  const button = page.getByRole('button', { name: /^People filter/ })
  await button.focus()
  await page.keyboard.press('Enter')
  const search = page.getByPlaceholder('Search...')
  await expect(search).toBeFocused()

  const list = page.getByRole('listbox', { name: 'People' })
  await page.keyboard.type('bo')
  // The row Tab will pick is highlighted and is the search's active descendant.
  const bob = list.getByRole('option', { name: '@Bob' })
  await expect(bob).toHaveAttribute('data-search-pick', '')
  await expect(search).toHaveAttribute('aria-activedescendant', (await bob.getAttribute('id')) ?? 'missing')
  await page.keyboard.press('Tab')
  await expect(list.getByRole('option', { name: '@Bob' })).toHaveAttribute('aria-selected', 'true')
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await expect.poll(() => titles(page)).toEqual(['Bob task'])

  // Tab again on a ticked row leaves it ticked; Enter toggles.
  await page.keyboard.type('bo')
  await page.keyboard.press('Tab')
  await expect(search).toBeFocused()
  await expect(list.getByRole('option', { name: '@Bob' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.type('ann')
  await page.keyboard.press('Enter')
  await expect(search).toBeFocused()
  await expect.poll(() => titles(page)).toEqual(['Ann task', 'Bob task'])
  await expect(list.getByRole('option', { name: '@Ann' })).toHaveAttribute('aria-selected', 'true')
})

test('a named row wins the search’s pick; ↓ goes to it, and the focused row is then the only current one', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => titles(page)).toEqual(['Ann task', 'Bob task'])

  await page.getByRole('button', { name: /^People filter/ }).focus()
  await page.keyboard.press('Enter')
  // The search is a combobox over the rows' listbox.
  const search = page.getByRole('combobox', { name: 'Search...' })
  await expect(search).toBeFocused()
  const list = page.getByRole('listbox', { name: 'People' })
  await expect(search).toHaveAttribute('aria-controls', (await list.getAttribute('id')) ?? 'missing')
  await expect(search).toHaveAttribute('aria-expanded', 'true')

  // `n`: None and Ann show — Ann (a named row) is the pick, not None.
  await page.keyboard.type('n')
  const none = list.getByRole('option', { name: 'None' })
  const ann = list.getByRole('option', { name: '@Ann' })
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
