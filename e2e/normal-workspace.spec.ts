import { expect, test } from '@playwright/test'
import {
  addWidgetAsTab,
  drag,
  enterLayoutEdit,
  expectLayoutStep,
  layoutEditBar,
  openCellLayoutMenu,
  openCellMenu,
  pickSplit,
  seedWorkspace,
  wsCell,
  wsShape,
  wsTab,
  type WsLayoutSeed,
} from './fixtures/workspace'
import { pointIn } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * The normal workspace (layout edit mode E4): edit mode changes the grid;
 * what's inside a cell changes in place. At rest there is no grip, no
 * crossing handle and no drag handle; a cell's ⋯ adds a widget as a tab
 * and removes one, a lone widget leaving its cell empty — whose placeholder
 * offers the kinds and Edit layout; a right-click's Edit layout opens the
 * mode with that cell selected; a tab dragged to another cell goes nowhere.
 */

/** `a b / c d`: Notes, Calendar, Neglect map and a second tab beside Notes. */
const quad: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['a b', 'c d'],
    cells: [
      { id: 'a', tabs: [{ id: 'notesTab', kind: 'notes' }, { id: 'mapTab', kind: 'neglect' }] },
      { id: 'b', tabs: [{ id: 'calTab', kind: 'calendar' }] },
      { id: 'c', tabs: [{ id: 'trendTab', kind: 'trend' }] },
      { id: 'd', tabs: [{ id: 'pulseTab', kind: 'pulse' }] },
    ],
  },
}

async function storedCells(page: import('@playwright/test').Page): Promise<Array<{ id: string; tabs: unknown[] }>> {
  return (await readStore<{ cells: Array<{ id: string; tabs: unknown[] }> }>(page, 'layouts'))[0]?.cells ?? []
}

test('at rest: no grip, no crossing handle, no drag handle in any cell', async ({ page }) => {
  await seedWorkspace(page, { layouts: [quad] })
  for (const id of ['a', 'b', 'c', 'd']) await wsCell(page, id).hover()
  await expect(page.getByTestId('ws-cell-grip')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cell layout' })).toHaveCount(0)
  await expect(page.locator('[data-ws-crossing]')).toHaveCount(0)
  await expect(page.locator('[data-ws-panel-handle]')).toHaveCount(0)
  // The dividers stay: four pieces of two lines.
  await expect(page.locator('[data-ws-divider]')).toHaveCount(4)
})

test('the ⋯’s Add widget as tab adds the kind to that cell, made its active tab', async ({ page }) => {
  await seedWorkspace(page, { layouts: [quad] })
  await addWidgetAsTab(page, 'b', 'Notes')
  await expect(wsCell(page, 'b').getByRole('tab')).toHaveCount(2)
  await expect(wsCell(page, 'b').getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-ws-table] [data-ws-cell]')).toHaveCount(4)
  await expectLayoutStep(page, 'Added “Notes”')
})

test('Remove widget on a lone widget leaves its cell, empty; the placeholder’s kinds fill it, its Edit layout opens the mode on it', async ({ page }) => {
  await seedWorkspace(page, { layouts: [quad] })
  await openCellMenu(page, 'b')
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Remove widget' }).click()
  await expectLayoutStep(page, 'Removed “Calendar”')
  const empty = wsCell(page, 'b')
  await expect(empty).toHaveAttribute('data-empty', 'true')
  await expect.poll(async () => (await storedCells(page)).find((c) => c.id === 'b')?.tabs.length).toBe(0)
  // A quiet placeholder: the kinds and Edit layout — no close ×, no drag hint outside the mode.
  await expect(empty.getByText('Add a widget')).toBeVisible()
  await expect(empty.getByRole('button', { name: 'Close empty cell' })).toHaveCount(0)
  await expect(empty.getByRole('button', { name: 'Edit layout' })).toBeVisible()

  // Undo brings the widget back into the same cell.
  await page.locator('[data-snackbar-live]').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(wsCell(page, 'b').locator('[data-ws-tab="calTab"]')).toHaveCount(1)

  // Removed again, then filled from the placeholder: the cell keeps its place.
  await openCellMenu(page, 'b')
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Remove widget' }).click()
  await empty.getByRole('group', { name: 'Tasks' }).getByRole('button', { name: 'Notes', exact: true }).click()
  await expect(wsCell(page, 'b')).not.toHaveAttribute('data-empty', 'true')
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'mapTab'], ['trendTab']], [[expect.any(String)], ['pulseTab']]])

  // Emptied once more, its Edit layout opens the mode with the cell selected.
  await openCellMenu(page, 'b')
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Remove widget' }).click()
  await wsCell(page, 'b').getByRole('button', { name: 'Edit layout' }).click()
  await expect(layoutEditBar(page)).toBeVisible()
  await expect(wsCell(page, 'b')).toHaveAttribute('data-edit-selected', '')
})

test('a right-click’s Edit layout opens the mode with that cell selected', async ({ page }) => {
  await seedWorkspace(page, { layouts: [quad] })
  await wsTab(page, 'mapTab').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Cell options' })
  await expect(menu.getByRole('menuitem', { name: 'Split cell' })).toHaveCount(0)
  await menu.getByRole('menuitem', { name: 'Edit layout' }).click()
  await expect(layoutEditBar(page)).toBeVisible()
  await expect(wsCell(page, 'a')).toHaveAttribute('data-edit-selected', '')
  await expect(wsCell(page, 'b')).not.toHaveAttribute('data-edit-selected', '')
})

test('outside the mode a tab dragged to another cell goes nowhere; inside its own strip it reorders', async ({ page }) => {
  await seedWorkspace(page, { layouts: [quad] })
  await drag(page, await pointIn(wsTab(page, 'mapTab')), await pointIn(wsCell(page, 'b').locator('[data-ws-cell-body]')), {
    during: async () => { await expect(page.getByTestId('ws-drop-ghost')).toHaveCount(0) },
  })
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'mapTab'], ['trendTab']], [['calTab'], ['pulseTab']]])
  // Onto the left half of the first tab: before it.
  await drag(page, await pointIn(wsTab(page, 'mapTab')), await pointIn(wsTab(page, 'notesTab'), 0.2, 0.5))
  await expect.poll(() => wsShape(page)).toEqual([[['mapTab', 'notesTab'], ['trendTab']], [['calTab'], ['pulseTab']]])
})

test('on a phone: no way into the layout edit mode, an empty cell offers nothing, and narrowing closes an open mode', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await seedWorkspace(page, { layouts: [quad] })
  // An empty cell, made on the desktop.
  await openCellMenu(page, 'b')
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Remove widget' }).click()
  await expectLayoutStep(page, 'Removed “Calendar”')
  // The mode open with a change, then the window narrowed to a phone's: it closes, saying the draft wasn't saved.
  await enterLayoutEdit(page)
  await openCellLayoutMenu(page, 'a')
  await pickSplit(page, 'Below')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(layoutEditBar(page)).toHaveCount(0)
  await expect(page.locator('[data-layout-editing]')).toHaveCount(0)
  await expect(page.locator('[data-edit-surface], [data-edit-slot]')).toHaveCount(0)
  await expect(page.getByText('Edit layout closed: its changes weren’t saved.')).toBeVisible()
  // No pencil, no Edit layout anywhere; the empty cell says where layouts are made and offers no kinds.
  await expect(page.getByTestId('layout-edit')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit layout' })).toHaveCount(0)
  const empty = wsCell(page, 'b')
  await expect(empty).toContainText('Empty cell')
  await expect(empty.getByRole('button')).toHaveCount(0)
  await wsCell(page, 'a').getByRole('button', { name: 'Cell options' }).click()
  await expect(page.getByRole('menu').first()).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Edit layout' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Add widget as tab' })).toHaveCount(0)
})
