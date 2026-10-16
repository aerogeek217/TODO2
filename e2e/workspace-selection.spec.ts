import { expect, test } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, wsListWidget, wsTab } from './fixtures/workspace'

/**
 * A list widget's row selection goes away with the widget: after switching
 * to another tab of the cell, Space / Delete act on nothing — never on rows
 * nobody can see.
 */

test.use({ viewport: { width: 1280, height: 800 } })

test('switching tabs drops the hidden list selection', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Tasks' }],
    tasks: [{ title: 'one' }, { title: 'two' }],
    layouts: [{
      name: 'Main',
      columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [
        { id: 'list', kind: 'lens', listDefIdx: 0 },
        { id: 'notes', kind: 'notes' },
      ] }] }],
    }],
  })
  await wsListWidget(page, 'list').waitFor({ state: 'visible' })
  await taskRowByTitle(page, 'one').locator('span[title="one"]').click()
  await expect(page.locator('[data-selected="true"]')).toHaveCount(1)

  await wsTab(page, 'notes').click()
  await expect(wsListWidget(page, 'list')).toHaveCount(0)
  await page.keyboard.press('Delete')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press(' ')

  await wsTab(page, 'list').click()
  await expect(taskRowByTitle(page, 'one').getByRole('checkbox', { name: 'Mark complete' })).toBeVisible()
  await expect(page.locator('[data-selected="true"]')).toHaveCount(0)
})

/**
 * The list, Eisenhower and dashboard widgets select rows the same way (one
 * hook): a click selects one task, Ctrl+click adds, Shift+click takes the
 * range, a click on the widget's empty space clears it, and only one widget
 * holds a selection at a time.
 */
test('list, Eisenhower and dashboard rows select alike; one widget at a time', async ({ page }) => {
  const hot = { urgent: true, important: true }
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Tasks' }],
    tasks: [{ title: 'alpha', ...hot }, { title: 'bravo', ...hot }, { title: 'charlie', ...hot }],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] }] },
        { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 'eis', kind: 'eisenhower' }] }] },
        { id: 'c3', cells: [{ id: 'k3', tabs: [{ id: 'dash', kind: 'dashboard', dashboard: { tiles: [], sections: [{ id: 'hot' }] } }] }] },
      ],
    }],
  })
  const widgets = [
    { name: 'list', root: wsListWidget(page, 'list') },
    { name: 'eisenhower', root: page.locator('[data-eisenhower="eis"]') },
    { name: 'dashboard', root: page.locator('[data-dashboard="dash"]') },
  ]
  const selected = page.locator('[data-selected="true"]')
  const bulkBar = page.getByTestId('list-bulk-bar')

  for (const w of widgets) {
    const title = (t: string) => w.root.locator('[data-todo-id]').filter({ hasText: t }).locator(`span[title="${t}"]`)
    await expect(title('charlie')).toBeVisible()

    await title('alpha').click()
    await expect(selected).toHaveCount(1)
    await expect(w.root.locator('[data-selected="true"]')).toHaveCount(1)
    await title('bravo').click({ modifiers: ['Control'] })
    await expect(w.root.locator('[data-selected="true"]')).toHaveCount(2)
    await expect(bulkBar).toContainText('2 selected')
    await title('charlie').click({ modifiers: ['Shift'] })
    // The range runs from the anchor (bravo) to charlie.
    await expect(w.root.locator('[data-selected="true"]')).toHaveCount(2)
    await expect(w.root.locator('[data-selected="true"]').filter({ hasText: 'alpha' })).toHaveCount(0)
    // Only this widget holds a selection.
    await expect(selected).toHaveCount(2)

    // A click on the widget's own empty space clears it: below the list's
    // rows; on the grid itself (between quadrants / sections) elsewhere.
    if (w.name === 'list') {
      // Just under the last row (the bulk bar floats at the bottom).
      const last = await w.root.locator('[data-todo-id]').last().boundingBox()
      if (!last) throw new Error('no box')
      await page.mouse.click(last.x + last.width / 2, last.y + last.height + 24)
    } else {
      await w.root.dispatchEvent('click')
    }
    await expect(selected).toHaveCount(0)
    await expect(bulkBar).toHaveCount(0)

    // Selecting here, then in another widget, moves the selection there.
    await title('alpha').click()
    await expect(w.root.locator('[data-selected="true"]')).toHaveCount(1)
  }
  // The dashboard's click took the selection from the Eisenhower widget.
  await expect(selected).toHaveCount(1)
  await expect(widgets[2]!.root.locator('[data-selected="true"]')).toHaveCount(1)
})
