import { expect, test, type Locator } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The checklist pickers list the selected entries first, a separator, then
 * the rest; the order is fixed when the picker opens and whenever its search
 * text changes, and a pick with search text clears the text. A real browser
 * because the pointer stays put while rows re-sort, and focus handoffs are
 * involved (the search keeps it; a keyboard pick's row keeps it at its new
 * place).
 */

const SEED: WorkspaceSeed = {
  people: ['Alice', 'Bob', 'Carol'],
  listDefinitions: [{ name: 'Tasks' }],
  tasks: [
    { title: 'Top task', people: ['Bob'] },
    { title: 'Other task', people: ['Alice'] },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

test.use({ viewport: { width: 1600, height: 900 } })

/** Each option's name and whether a separator sits above it. */
const separators = (list: Locator) => list.getByRole('option').evaluateAll((els) =>
  els.map((el) => getComputedStyle(el, '::before').content !== 'none' && getComputedStyle(el, '::before').borderTopStyle === 'solid'))

test('row people picker: the assigned first; a pick with text clears it and re-sorts; a tick without text moves nothing', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await wsListWidget(page, 't1').waitFor({ state: 'visible' })
  await taskRowByTitle(page, 'Top task').getByRole('button', { name: 'People: Bob' }).click()
  const panel = page.locator('[data-anchored-picker]')
  const search = panel.getByRole('combobox')
  const list = panel.getByRole('listbox')
  await expect(search).toBeFocused()
  await expect(list.getByRole('option')).toHaveText([/Bob$/, /Alice$/, /Carol$/])
  expect(await separators(list)).toEqual([false, true, false])

  // A pick with text: the text clears, the whole list shows re-sorted, the focus stays in the search.
  await search.fill('car')
  await expect(list.getByRole('option')).toHaveText([/Carol⏎?$/, /Create/])
  await list.getByRole('option', { name: 'Carol' }).click()
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await expect(list.getByRole('option')).toHaveText([/Bob$/, /Carol$/, /Alice$/])
  await expect(list.getByRole('option', { name: 'Carol' })).toHaveAttribute('aria-selected', 'true')
  expect(await separators(list)).toEqual([false, false, true])

  // A tick with no text: Alice is ticked where she is, under the pointer.
  const alice = list.getByRole('option', { name: 'Alice' })
  const before = await alice.boundingBox()
  await alice.click()
  await expect(alice).toHaveAttribute('aria-selected', 'true')
  await expect(list.getByRole('option')).toHaveText([/Bob$/, /Carol$/, /Alice$/])
  expect(await alice.boundingBox()).toEqual(before)

  // Reopened, the order is fixed again: all three assigned, no separator.
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await taskRowByTitle(page, 'Top task').getByRole('button', { name: /^People: / }).click()
  await expect(page.locator('[data-anchored-picker]').getByRole('option')).toHaveText([/Alice$/, /Bob$/, /Carol$/])
  expect(await separators(page.locator('[data-anchored-picker]').getByRole('listbox'))).toEqual([false, false, false])
})

test('top bar People filter: Space on a row with search text clears it; the row keeps the focus at the top', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await wsListWidget(page, 't1').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: /^People filter/ }).click()
  const search = page.getByPlaceholder('Search...')
  await expect(search).toBeFocused()
  const list = page.getByRole('listbox', { name: 'People' })
  await expect(list.getByRole('option')).toHaveText(['None', '@Alice', '@Bob', '@Carol'])

  await search.pressSequentially('car')
  await page.keyboard.press('ArrowDown')
  const carol = list.getByRole('option', { name: '@Carol' })
  await expect(carol).toBeFocused()
  await page.keyboard.press('Space')
  await expect(search).toHaveValue('')
  await expect(list.getByRole('option')).toHaveText(['@Carol', 'None', '@Alice', '@Bob'])
  await expect(carol).toBeFocused()
  await expect(carol).toHaveAttribute('aria-selected', 'true')
  expect(await separators(list)).toEqual([false, true, false, false])

  // Space again unticks it; no text, so nothing moves.
  await page.keyboard.press('Space')
  await expect(carol).toHaveAttribute('aria-selected', 'false')
  await expect(list.getByRole('option')).toHaveText(['@Carol', 'None', '@Alice', '@Bob'])
  await expect(carol).toBeFocused()
})
