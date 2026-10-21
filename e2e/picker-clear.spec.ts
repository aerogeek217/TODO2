import { expect, test, type Locator } from '@playwright/test'
import { rowTitles, taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * The clear × in the people / tag pickers' search, the filter pickers'
 * Search... and a list's Text contains field: shown while the field has
 * text, at its right end; a click empties the field, keeps the focus (and
 * the picker) where it was. Focus and the press that must not close the
 * popover need a real browser.
 */

const SEED = {
  people: [{ name: 'Alice Chen', initials: 'AC' }, { name: 'Ben Ortiz', initials: 'BO' }],
  tasks: [
    { title: 'Plan the offsite', people: ['Alice Chen'] },
    { title: 'Call the plumber' },
  ],
}

/** The × sits inside the field, at its right end, and is what the page shows there. */
async function expectAtRightEnd(field: Locator, clear: Locator) {
  const f = await box(field)
  const c = await box(clear)
  expect(c.x).toBeGreaterThan(f.x + f.width - 28)
  expect(c.x + c.width).toBeLessThanOrEqual(f.x + f.width)
  expect(c.y).toBeGreaterThanOrEqual(f.y)
  expect(c.y + c.height).toBeLessThanOrEqual(f.y + f.height)
  expect(await clear.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
  })).toBe(true)
}

test('a row’s people picker: × empties the search, the picker stays open with the focus in it', async ({ page }) => {
  await seedTaskList(page, SEED)
  await taskRowByTitle(page, 'Plan the offsite').locator('[data-row-cell="people"]').click()
  const panel = page.locator('[data-anchored-picker]')
  const search = panel.getByRole('combobox')
  await expect(search).toBeFocused()
  await expect(panel.getByRole('button', { name: 'Clear search' })).toHaveCount(0)

  await page.keyboard.type('ben')
  await expect(panel.getByRole('option')).toHaveText([/Ben Ortiz/, /Create "ben"/])
  const clear = panel.getByRole('button', { name: 'Clear search' })
  await expectAtRightEnd(search, clear)
  await clear.click()

  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await expect(panel.getByRole('option')).toHaveText([/Alice Chen/, /Ben Ortiz/])
  await expect(clear).toHaveCount(0)
  // Nothing was picked: Alice is still the only one assigned.
  await expect(panel.getByRole('option', { name: 'Alice Chen' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByRole('option', { name: 'Ben Ortiz' })).toHaveAttribute('aria-selected', 'false')
  // Typing goes on in the field.
  await page.keyboard.type('al')
  await expect(search).toHaveValue('al')
})

test('the top bar’s People filter: × empties Search..., the picker stays open', async ({ page }) => {
  await seedTaskList(page, SEED)
  await page.getByRole('button', { name: 'People filter' }).click()
  const search = page.getByPlaceholder('Search...')
  await expect(search).toBeFocused()
  await page.keyboard.type('ali')
  await expect(page.locator('label', { hasText: '@Ben Ortiz' })).toHaveCount(0)
  const clear = page.getByRole('button', { name: 'Clear search' })
  await expectAtRightEnd(search, clear)
  await clear.click()
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await expect(page.locator('label', { hasText: '@Ben Ortiz' })).toBeVisible()
})

test('the top bar’s People filter: Esc empties Search... first, the next Esc closes the picker', async ({ page }) => {
  await seedTaskList(page, SEED)
  await page.getByRole('button', { name: 'People filter' }).click()
  const search = page.getByPlaceholder('Search...')
  await expect(search).toBeFocused()
  await page.keyboard.type('ali')
  await expect(page.locator('label', { hasText: '@Ben Ortiz' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await expect(page.locator('label', { hasText: '@Ben Ortiz' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(search).toHaveCount(0)
})

test('a list’s Text contains: Clear text filter empties the filter, the field keeps the focus', async ({ page }) => {
  const widget = await seedTaskList(page, SEED)
  await widget.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Text contains…' }).click()
  const field = page.getByLabel('Text contains')
  await expect(field).toBeFocused()
  await page.keyboard.type('plumber')
  await expect.poll(() => rowTitles(widget)).toEqual(['Call the plumber'])

  const clear = page.getByRole('button', { name: 'Clear text filter' })
  await expectAtRightEnd(field, clear)
  await clear.click()
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  await expect.poll(async () => [...await rowTitles(widget)].sort()).toEqual(['Call the plumber', 'Plan the offsite'])
  await expect(clear).toHaveCount(0)
})
