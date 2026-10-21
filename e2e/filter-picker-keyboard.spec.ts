import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'

/**
 * The filter pickers by keyboard alone: the top bar's People picker opens on
 * Enter with the focus in its search, ↓ goes into the rows, Space ticks one,
 * Esc closes it. Real-browser because focus handoffs are.
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
