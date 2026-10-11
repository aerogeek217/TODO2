import { expect, test, type Locator, type Page } from '@playwright/test'
import { dragRow, readListOrders, seedWorkspace, wsListWidget } from './fixtures/workspace'

/**
 * Focus: a task put in focus (row menu, task editor) shows in a Focus list
 * widget (predicate focus = true, manual order); reordering that list saves
 * at once and survives a reload; taking a task out of focus removes it.
 */

async function titles(widget: Locator): Promise<string[]> {
  return widget.locator('[data-row-key]').evaluateAll(
    (els) => els.map((el) => el.querySelector('[data-todo-id] span[title]')?.getAttribute('title') ?? ''),
  )
}

function rowIn(page: Page, widget: Locator, title: string): Locator {
  return widget.locator('[data-row-key]', { has: page.locator(`span[title="${title}"]`) })
}

async function menuAction(page: Page, row: Locator, item: string): Promise<void> {
  await row.locator('[data-todo-id]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: item }).click()
}

test('putting tasks in focus fills the Focus list, whose order persists', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [
      { name: 'All' },
      { name: 'Focus', predicate: { focus: true } },
    ],
    tasks: [{ title: 'Alpha' }, { title: 'Bravo' }, { title: 'Charlie' }],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'all', kind: 'lens', listDefIdx: 0 }] }] },
        { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 'focus', kind: 'lens', listDefIdx: 1 }] }] },
      ],
    }],
  })
  const all = wsListWidget(page, 'all')
  const focus = wsListWidget(page, 'focus')
  await expect.poll(() => titles(all)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  await expect(focus.locator('[data-row-key]')).toHaveCount(0)

  // Row menu.
  await menuAction(page, rowIn(page, all, 'Bravo'), 'Add to Focus')
  await expect.poll(() => titles(focus)).toEqual(['Bravo'])
  await expect(rowIn(page, all, 'Bravo').getByRole('img', { name: 'Focus' })).toBeVisible()
  await expect(rowIn(page, all, 'Alpha').getByRole('img', { name: 'Focus' })).toHaveCount(0)

  // Task editor toggle.
  await rowIn(page, all, 'Charlie').locator('[data-todo-id]').dblclick()
  const toggle = page.getByRole('button', { name: 'Focus', exact: true })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect.poll(() => titles(focus)).toEqual(['Bravo', 'Charlie'])

  // Reorder the Focus list: Charlie above Bravo.
  const bravoBox = await rowIn(page, focus, 'Bravo').boundingBox()
  if (!bravoBox) throw new Error('no box')
  await dragRow(page, rowIn(page, focus, 'Charlie'), bravoBox.y + 4)
  await expect.poll(() => titles(focus)).toEqual(['Charlie', 'Bravo'])
  await expect.poll(async () => (await readListOrders(page)).length).toBeGreaterThan(0)

  await page.reload()
  await expect.poll(() => titles(focus)).toEqual(['Charlie', 'Bravo'])

  // Out of focus: leaves the Focus list, keeps its place in All.
  await menuAction(page, rowIn(page, focus, 'Charlie'), 'Remove from Focus')
  await expect.poll(() => titles(focus)).toEqual(['Bravo'])
  await expect.poll(() => titles(all)).toEqual(['Alpha', 'Bravo', 'Charlie'])
})
