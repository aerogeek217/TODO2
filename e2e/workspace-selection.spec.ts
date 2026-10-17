import { expect, test } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { drag, seedWorkspace, wsCell, wsListWidget, wsTab } from './fixtures/workspace'

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

/**
 * A row selection goes when the user clicks anywhere that isn't a row: the
 * top bar, another widget, a cell header, the workspace between cells. Clicks
 * on rows, the bulk bar and its menus keep it, and so does a drag (here a
 * divider resize, whose release lands outside any row).
 */
test('a click outside the rows clears the selection; rows, the bulk bar, menus and drags keep it', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Tasks' }],
    tasks: [{ title: 'alpha' }, { title: 'bravo' }, { title: 'charlie' }],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] }] },
        { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 'notes', kind: 'notes' }] }, { id: 'k3', tabs: [{ id: 'eis', kind: 'eisenhower' }] }] },
      ],
    }],
  })
  const list = wsListWidget(page, 'list')
  const title = (t: string) => list.locator('[data-todo-id]').filter({ hasText: t }).locator(`span[title="${t}"]`)
  const selected = page.locator('[data-selected="true"]')
  const bulkBar = page.getByTestId('list-bulk-bar')
  const selectTwo = async () => {
    await title('alpha').click()
    await title('bravo').click({ modifiers: ['Control'] })
    await expect(selected).toHaveCount(2)
  }

  // Kept: another row click changes it; the bulk bar and its menu keep it.
  await selectTwo()
  await bulkBar.getByRole('button', { name: 'More', exact: true }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await bulkBar.getByText('2 selected').click()
  await expect(selected).toHaveCount(2)

  // Kept: a drag that ends outside the rows (a divider resize).
  const divider = page.locator('[data-ws-divider]').first()
  const d = await divider.boundingBox()
  if (!d) throw new Error('no divider')
  await drag(page, { x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: d.x + d.width / 2 + 60, y: d.y + d.height / 2 })
  await expect(selected).toHaveCount(2)

  // Cleared: the top bar's search box.
  await page.getByRole('textbox', { name: 'Search tasks' }).click()
  await expect(selected).toHaveCount(0)
  await expect(bulkBar).toHaveCount(0)

  // Cleared: another widget's tab.
  await selectTwo()
  await wsTab(page, 'eis').click()
  await expect(selected).toHaveCount(0)

  // Cleared: another widget's body.
  await selectTwo()
  await page.locator('[data-eisenhower="eis"]').click({ position: { x: 4, y: 4 } })
  await expect(selected).toHaveCount(0)

  // Cleared: the list's own cell header.
  await selectTwo()
  const header = await wsCell(page, 'k1').locator('[role="tablist"]').boundingBox()
  if (!header) throw new Error('no tab strip')
  await page.mouse.click(header.x + header.width - 60, header.y + header.height / 2)
  await expect(selected).toHaveCount(0)
})
