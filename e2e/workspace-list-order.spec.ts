import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  dragRow,
  readListDefinitions,
  readListOrders,
  releaseDrag,
  seedWorkspace,
  wsCell,
  wsListWidget,
  wsTab,
  type WorkspaceSeed,
} from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'
import { box } from './fixtures/geometry'

/**
 * List widget rows: selection (click / Shift / Ctrl, arrow keys, bulk bar),
 * dragging to reorder a manual list (saved at once, per list), dragging in a
 * sorted list (asks to switch to manual order) and dragging between people
 * groups (reassigns, after a confirm).
 */

function seed(list: NonNullable<WorkspaceSeed['listDefinitions']>[number]): WorkspaceSeed {
  return {
    people: ['Alice', 'Bob'],
    listDefinitions: [list],
    tasks: [
      { title: 'Alpha', people: ['Alice'] },
      { title: 'Bravo', people: ['Bob'] },
      { title: 'Charlie', people: ['Alice', 'Bob'] },
      { title: 'Delta', people: ['Alice'] },
    ],
    layouts: [{
      name: 'Main',
      columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }],
    }],
  }
}

function rows(page: Page): Locator {
  return wsListWidget(page, 't1').locator('[data-row-key]')
}

function titles(page: Page): Promise<string[]> {
  return rowTitles(wsListWidget(page, 't1'))
}

function row(page: Page, title: string, group?: string): Locator {
  const scope = group ? wsListWidget(page, 't1').locator(`[data-list-section="${group}"]`) : wsListWidget(page, 't1')
  return scope.locator('[data-row-key]', { has: page.locator(`span[data-task-title="${title}"]`) })
}

/** Viewport y just inside the top of `target` (lands before it). */
async function above(target: Locator): Promise<number> {
  return (await box(target)).y + 4
}

test('reordering a manual list saves at once and survives a reload', async ({ page }) => {
  await seedWorkspace(page, seed({ name: 'Order' }))
  await expect.poll(() => titles(page)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])

  // Delta above Bravo: rows make room while dragging.
  await dragRow(page, row(page, 'Delta'), await above(row(page, 'Bravo')), async () => {
    await expect(wsListWidget(page, 't1').locator('[data-drop-slot]')).toHaveCount(1)
  })
  await expect.poll(() => titles(page)).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie'])
  // Not a list edit: nothing unsaved.
  await expect(wsCell(page, 'k1').getByTestId('save-list')).toHaveCount(0)
  await expect.poll(async () => (await readListOrders(page)).length).toBeGreaterThan(0)

  await page.reload()
  await expect.poll(() => titles(page)).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie'])

  // A second move writes one rank.
  const before = await readListOrders(page)
  await dragRow(page, row(page, 'Alpha'), await above(row(page, 'Charlie')))
  await expect.poll(() => titles(page)).toEqual(['Delta', 'Bravo', 'Alpha', 'Charlie'])
  const after = await readListOrders(page)
  const changed = after.filter((r) => before.find((b) => b.todoId === r.todoId)?.rank !== r.rank)
  expect(changed).toHaveLength(1)
})

test('a row moved to its spot in one quick motion and let go lands there', async ({ page }) => {
  await seedWorkspace(page, seed({ name: 'Order' }))
  await expect.poll(() => titles(page)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])

  // One pointer move both starts the drag (past the 5px activation) and
  // reaches the landing spot; nothing moves after it before the release.
  const b = await box(row(page, 'Delta'))
  const x = b.x + 10
  await page.mouse.move(x, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, await above(row(page, 'Bravo')))
  await releaseDrag(page)
  await expect.poll(() => titles(page)).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie'])
})

test('dragging in a sorted list asks to switch to manual order', async ({ page }) => {
  await seedWorkspace(page, seed({ name: 'Sorted', sort: 'name' }))
  await expect.poll(() => titles(page)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])

  await dragRow(page, row(page, 'Delta'), await above(row(page, 'Alpha')), async () => {
    await expect(page.getByTestId('sorted-drop-hint')).toContainText('Sorted by name · drop to switch to manual')
  })
  const prompt = page.getByTestId('switch-to-manual')
  await expect(prompt).toContainText('“Sorted” is sorted by name.')

  // Cancel: nothing changes.
  await prompt.getByRole('button', { name: /Cancel/ }).click()
  await expect(prompt).toBeHidden()
  await expect.poll(() => titles(page)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  expect(await readListOrders(page)).toHaveLength(0)

  // Again, and switch: the order starts from what was shown, plus the move.
  await dragRow(page, row(page, 'Delta'), await above(row(page, 'Alpha')))
  await page.getByTestId('switch-to-manual').getByRole('button', { name: 'Switch to manual' }).click()
  await expect.poll(() => titles(page)).toEqual(['Delta', 'Alpha', 'Bravo', 'Charlie'])
  expect(await readListOrders(page)).toHaveLength(4)
  // The sort change is a list edit: unsaved until saved.
  const save = wsCell(page, 'k1').getByTestId('save-list')
  await expect(save).toBeVisible()
  await save.click()
  await expect.poll(async () => (await readListDefinitions(page))[0]?.sort).toBe('manual')
})

test('dragging into another person’s group reassigns the task after a confirm', async ({ page }) => {
  await seedWorkspace(page, seed({ name: 'Team', grouping: 'people' }))
  await expect(wsListWidget(page, 't1').getByTestId('list-group-name')).toHaveText(['Alice', 'Bob'])
  // Charlie (Alice + Bob) shows in both groups, each row with its own drag id.
  const dragIds = await rows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-drag-id')))
  expect(new Set(dragIds).size).toBe(dragIds.length)
  await expect(row(page, 'Charlie', 'person-1')).toHaveCount(1)
  await expect(row(page, 'Charlie', 'person-2')).toHaveCount(1)

  await dragRow(page, row(page, 'Alpha', 'person-1'), await above(row(page, 'Bravo', 'person-2')), async () => {
    await expect(page.getByTestId('cross-group-preview')).toHaveText('Alice → Bob')
  })
  const dialog = page.getByRole('dialog', { name: 'Reassign person' })
  await expect(dialog).toContainText('Move Alpha from Alice to Bob?')
  await dialog.getByRole('button', { name: 'Reassign' }).click()
  await expect(row(page, 'Alpha', 'person-2')).toHaveCount(1)
  await expect(row(page, 'Alpha', 'person-1')).toHaveCount(0)
})

test('selection: click, Shift-range across groups, arrow keys, and the bulk bar', async ({ page }) => {
  await seedWorkspace(page, seed({ name: 'Team', grouping: 'people' }))
  await row(page, 'Alpha', 'person-1').locator('span[data-task-title="Alpha"]').click()
  await expect(row(page, 'Alpha', 'person-1')).toHaveAttribute('data-cursor', 'true')

  // Shift-click Bravo (Bob's group): a range over the group header.
  await row(page, 'Bravo', 'person-2').locator('span[data-task-title="Bravo"]').click({ modifiers: ['Shift'] })
  const bar = page.getByTestId('list-bulk-bar')
  await expect(bar).toContainText('4 selected')

  // ↓ moves the cursor to the next row; Shift+↑ extends from the anchor.
  await page.keyboard.press('Escape')
  await expect(bar).toBeHidden()
  await row(page, 'Alpha', 'person-1').locator('span[data-task-title="Alpha"]').click()
  await page.keyboard.press('ArrowDown')
  // The next row is Charlie's occurrence in Alice's group, not the one in Bob's.
  await expect(row(page, 'Charlie', 'person-1')).toHaveAttribute('data-cursor', 'true')
  await expect(row(page, 'Charlie', 'person-2')).not.toHaveAttribute('data-cursor', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(row(page, 'Delta', 'person-1')).toHaveAttribute('data-cursor', 'true')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(row(page, 'Bravo', 'person-2')).toHaveAttribute('data-cursor', 'true')
  await expect(bar).toContainText('2 selected')

  // Bulk complete asks first, then completes both.
  await bar.getByRole('button', { name: 'Complete' }).click()
  await page.getByRole('dialog', { name: 'Complete tasks' }).getByRole('button', { name: 'Complete' }).click()
  await expect(row(page, 'Delta', 'person-1')).toHaveCount(0)
  await expect(row(page, 'Bravo', 'person-2')).toHaveCount(0)
  await expect(wsTab(page, 't1')).toBeVisible()
})
