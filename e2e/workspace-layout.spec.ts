import { expect, test, type Page } from '@playwright/test'
import {
  drag, dragTab, expectOpenLayout, openCellMenu, pickCellMenu, pickSplit, pickWidgetKind, openLayoutAction, openLayoutTab, openLayoutTabMenu, openSettings, seedWorkspace, switchLayout, withSpareLayouts, wsCell, wsDivider, wsGhost, wsShape, wsTab,
  type WsLayoutSeed,
  wsRow,
} from './fixtures/workspace'
import { box, pointIn, type Point } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * Workspace layout editing in a real browser: the tab drop targets (a
 * cell's middle and edges, the layout's edge, a tab strip) with the drop
 * ghost, the dividers (view state), collapse, and the saved-layout flow
 * (save icon, the Save / Discard / Cancel prompt on layout switch and on
 * leaving the route, none when Settings opens over the workspace,
 * persistence across reload).
 */

const twoColumns: WsLayoutSeed = {
  name: 'Main',
  columns: [
    { id: 'colA', rows: [wsRow({ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }, { id: 'eisTab', kind: 'eisenhower' }] })] },
    { id: 'colB', rows: [wsRow({ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] })] },
  ],
}

const saveButton = (page: Page) => page.getByTestId('layout-save')

function bodyPoint(page: Page, cellId: string, fy: number, fx = 0.5): Promise<Point> {
  return pointIn(wsCell(page, cellId).locator('[data-ws-cell-body]'), fx, fy)
}

test.describe('tab drop targets', () => {
  test('cell middle joins the cell as a tab', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const to = await bodyPoint(page, 'b1', 0.5)
    await dragTab(page, wsTab(page, 'eisTab'), to, async () => {
      await expect(page.getByTestId('ws-drop-label')).toHaveText('Add as tab')
      await expect(wsCell(page, 'b1').getByTestId('ws-ghost-tab')).toBeVisible()
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab', 'eisTab']]])
    await expect(wsTab(page, 'eisTab')).toHaveAttribute('aria-selected', 'true')
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
  })

  test('cell top / bottom edge splits it above / below; a cell that leaves no neighbour its place stays empty', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await dragTab(page, wsTab(page, 'eisTab'), await bodyPoint(page, 'b1', 0.1), async () => {
      await expect(page.getByTestId('ws-drop-label')).toHaveText('Split Calendar · above')
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['eisTab'], ['calTab']]])

    // a1's place: no cell shares its whole right edge (two cells do, each half of it), so it stays as an empty cell.
    await dragTab(page, wsTab(page, 'notesTab'), await bodyPoint(page, 'b1', 0.92))
    await expect.poll(() => wsShape(page)).toEqual([[[]], [['eisTab'], ['calTab'], ['notesTab']]])
    await expect(page.getByRole('region', { name: 'Empty cell' })).toBeVisible()
  })

  test('a cell’s side edge makes a new column beside it; the layout’s outer edge a new column there', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await dragTab(page, wsTab(page, 'eisTab'), await bodyPoint(page, 'b1', 0.5, 0.05), async () => {
      await expect(page.getByTestId('ws-drop-label')).toHaveText('Split Calendar · left')
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['eisTab']], [['calTab']]])

    // The outer right edge, from the middle column (its only tab): its place goes to the column on its left.
    const area = await box(page.locator('[data-ws-area]'))
    await dragTab(page, wsTab(page, 'eisTab'), { x: area.x + area.width - 10, y: area.y + area.height / 2 }, async () => {
      await expect(page.getByTestId('ws-drop-label')).toHaveText('Insert column · full height')
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']], [['eisTab']]])
  })

  test('tab strip inserts at the pointer position; own cell middle is a no-op', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const first = await wsTab(page, 'notesTab').boundingBox()
    if (!first) throw new Error('no tab')
    // Left half of the first tab, clear of the outer-edge new-column zone.
    await dragTab(page, wsTab(page, 'eisTab'), { x: first.x + 20, y: first.y + first.height / 2 }, async () => {
      await expect(wsCell(page, 'a1').getByTestId('ws-tab-insert-line')).toBeVisible()
    })
    await expect.poll(() => wsShape(page)).toEqual([[['eisTab', 'notesTab']], [['calTab']]])

    // Dropping a single-tab cell's tab on its own body changes nothing (and draws no ghost).
    const own = await bodyPoint(page, 'b1', 0.5)
    await dragTab(page, wsTab(page, 'calTab'), own, async () => {
      await expect(wsGhost(page)).toHaveCount(0)
    })
    await expect.poll(() => wsShape(page)).toEqual([[['eisTab', 'notesTab']], [['calTab']]])
  })

  test('Escape cancels a tab drag', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const tab = wsTab(page, 'eisTab')
    const t = await box(tab)
    const to = await bodyPoint(page, 'b1', 0.5)
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2)
    await page.mouse.down()
    await page.mouse.move(t.x + 20, t.y + 20, { steps: 2 })
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']]])
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  })
})

test.describe('resize and collapse', () => {
  test('dragging the column divider resizes both neighbours (saved at once, never unsaved) and respects the 120px minimum', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const divider = page.getByRole('separator', { name: 'Resize Notes and Calendar' })
    const before = await box(wsCell(page, 'a1'))
    const d = await box(divider)
    await drag(page, { x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: d.x + d.width / 2 + 120, y: d.y + d.height / 2 })
    await expect.poll(async () => Math.round((await box(wsCell(page, 'a1'))).width - before.width)).toBeGreaterThan(100)
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
    const resized = Math.round((await box(wsCell(page, 'a1'))).width)
    await page.reload()
    await expect.poll(async () => Math.round((await box(wsCell(page, 'a1'))).width)).toBe(resized)
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')

    // Far past the other cell's minimum: it stops at 120px.
    const d2 = await box(divider)
    await drag(page, { x: d2.x + 3, y: d2.y + 300 }, { x: d2.x + 2000, y: d2.y + 300 })
    await expect.poll(async () => Math.round((await box(wsCell(page, 'b1'))).width)).toBe(120)
  })

  test('the row divider resizes; past the minimum it stops there; neither is an unsaved change', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        columns: [{ id: 'colA', rows: [
          wsRow({ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }] }),
          wsRow({ id: 'a2', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] }),
        ] }],
      }],
    })
    const divider = page.getByRole('separator', { name: 'Resize Notes and Eisenhower' })
    const top = await box(wsCell(page, 'a1'))
    const d = await box(divider)
    await drag(page, { x: d.x + 200, y: d.y + d.height / 2 }, { x: d.x + 200, y: d.y + d.height / 2 - 100 })
    await expect.poll(async () => Math.round(top.height - (await box(wsCell(page, 'a1'))).height)).toBeGreaterThan(80)
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')

    // Far up: the top cell stops at its minimum (112px).
    const d2 = await box(divider)
    await drag(page, { x: d2.x + 200, y: d2.y + 3 }, { x: d2.x + 200, y: 0 })
    await expect.poll(async () => Math.round((await box(wsCell(page, 'a1'))).height)).toBe(112)
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  })

  test('cell header Collapse button and the cell menu split / close', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const header = wsCell(page, 'b1').locator('[data-ws-cell-header]')
    await header.hover()
    // D26: collapse is a row track's — the row b1 lies in.
    await header.getByRole('button', { name: 'Collapse row' }).click()
    await expect(wsCell(page, 'b1').locator('[data-ws-cell-body]')).toHaveCount(0)
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
    await wsCell(page, 'b1').getByRole('button', { name: 'Expand row' }).click()

    await header.hover()
    await header.getByRole('button', { name: 'Cell options' }).click()
    await pickSplit(page, 'Below')
    await expect(page.getByRole('region', { name: 'Empty cell' })).toBeVisible()
    await page.getByRole('region', { name: 'Empty cell' }).getByRole('button', { name: 'Notes' }).click()
    await expect.poll(async () => (await wsShape(page))[1]?.length).toBe(2)
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
  })

  test('with an unsaved new column, a column resize stays unsaved with it (kept over a reload); Save keeps the widths', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await openCellMenu(page, 'b1')
    await pickCellMenu(page, 'Insert', 'Column at the right')
    await page.getByRole('region', { name: 'Empty cell' }).getByRole('button', { name: 'Notes' }).click()
    await expect.poll(async () => (await wsShape(page)).length).toBe(3)
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')

    const a1 = wsCell(page, 'a1')
    const before = (await box(a1)).width
    const d = await box(wsDivider(page, 'a1', 'b1'))
    await drag(page, { x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: d.x + d.width / 2 - 100, y: d.y + d.height / 2 })
    await expect.poll(async () => Math.round(before - (await box(a1)).width)).toBeGreaterThan(80)
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
    const widths = async () => Promise.all((await page.locator('[data-ws-cell]').all()).map(async (c) => Math.round((await box(c)).width)))
    const resized = await widths()
    // The stored layout has neither the column nor the widths yet.
    const storedWeights = async () => ((await readStore<{ grid: { columns: Array<{ weight: number }> } }>(page, 'layouts'))[0]?.grid.columns ?? []).map((c) => c.weight)
    expect(await storedWeights()).toEqual([500, 500])

    await page.reload()
    await expect.poll(widths).toEqual(resized)
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
    await saveButton(page).click()
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
    await expect.poll(async () => (await storedWeights()).length).toBe(3)
    await page.reload()
    await expect.poll(widths).toEqual(resized)
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  })
})

test.describe('a pane that goes leaves no void', () => {
  /** Unfilled px of the table, right of `cellId` (its padding not counted). */
  const voidRight = (page: Page, cellId: string) => page.evaluate((id) => {
    const table = document.querySelector<HTMLElement>('[data-ws-table]')
    const cell = document.querySelector(`[data-ws-cell="${id}"]`)
    if (!table || !cell) throw new Error('no table')
    return table.getBoundingClientRect().right - parseFloat(getComputedStyle(table).paddingRight) - cell.getBoundingClientRect().right
  }, cellId)
  /** Unfilled px of the table, below `cellId`. */
  const voidBelow = (page: Page, cellId: string) => page.evaluate((id) => {
    const table = document.querySelector<HTMLElement>('[data-ws-table]')
    const cell = document.querySelector(`[data-ws-cell="${id}"]`)
    if (!table || !cell) throw new Error('no table')
    return table.getBoundingClientRect().bottom - parseFloat(getComputedStyle(table).paddingBottom) - cell.getBoundingClientRect().bottom
  }, cellId)

  test('a cell split off, whose last tab then joins another pane, gives its height back', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await dragTab(page, wsTab(page, 'eisTab'), await bodyPoint(page, 'a1', 0.92))
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab'], ['eisTab']], [['calTab']]])

    await dragTab(page, wsTab(page, 'eisTab'), await bodyPoint(page, 'b1', 0.5))
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab', 'eisTab']]])
    await expect.poll(() => voidBelow(page, 'a1')).toBeLessThan(1)
  })

  test('a column whose last tab joins another column gives its width back', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'colA', weight: 0.5, rows: [wsRow({ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }] })] },
          { id: 'colB', weight: 0.5, rows: [wsRow({ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] })] },
        ],
      }],
    })
    await dragTab(page, wsTab(page, 'calTab'), await bodyPoint(page, 'a1', 0.5))
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'calTab']]])
    await expect.poll(() => voidRight(page, 'a1')).toBeLessThan(1)
  })

  test('a layout stored with weights under 1 fills the workspace', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{ name: 'Main', table: { areas: ['a1'], cols: [0.5], rows: [0.25], cells: [{ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }] }] } }],
    })
    await expect.poll(() => voidRight(page, 'a1')).toBeLessThan(1)
    await expect.poll(() => voidBelow(page, 'a1')).toBeLessThan(1)
  })

  test('beside a collapsed row, the expanded cells take all the free height', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        table: {
          areas: ['a1 b1', 'a2 b1', 'a3 b1'],
          rows: [{ weight: 250, collapsed: true }, 250, 500],
          cells: [
            { id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }] },
            { id: 'a2', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] },
            { id: 'a3', tabs: [{ id: 'dashTab', kind: 'notes' }] },
            { id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] },
          ],
        },
      }],
    })
    await expect.poll(async () => Math.round((await box(wsCell(page, 'a1'))).height)).toBe(32)
    await dragTab(page, wsTab(page, 'dashTab'), await bodyPoint(page, 'b1', 0.5))
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab'], ['eisTab']], [['calTab', 'dashTab']]])
    await expect.poll(() => voidBelow(page, 'a2')).toBeLessThan(1)
  })

  test('the last expanded cell going expands the collapsed one left', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'colA', rows: [
            wsRow({ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }] }, { collapsed: true }),
            wsRow({ id: 'a2', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] }),
          ] },
          { id: 'colB', rows: [wsRow({ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] })] },
        ],
      }],
    })
    await dragTab(page, wsTab(page, 'eisTab'), await bodyPoint(page, 'b1', 0.5))
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab', 'eisTab']]])
    await expect(wsCell(page, 'a1').locator('[data-ws-cell-body]')).toBeVisible()
    await expect.poll(() => voidBelow(page, 'a1')).toBeLessThan(1)
  })
})

test.describe('saved layouts', () => {
  const second: WsLayoutSeed = {
    name: 'Second',
    columns: [{ id: 'colZ', rows: [wsRow({ id: 'z1', tabs: [{ id: 'zTab', kind: 'eisenhower' }] })] }],
  }

  test('save persists across reload; switching layouts prompts Save / Discard / Cancel', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns, second] })
    await expectOpenLayout(page, 'Main')

    // An unsaved change: close the Eisenhower tab. The open tab shows the dot.
    await wsTab(page, 'eisTab').click()
    await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Eisenhower' }).click()
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
    await expect(openLayoutTab(page).getByRole('img', { name: 'unsaved changes' })).toBeVisible()

    // Switch → prompt → Cancel stays.
    await switchLayout(page, 'Second')
    const dialog = page.getByRole('dialog', { name: 'Save changes to layout “Main”?' })
    await expect(dialog).toContainText('You’re switching to “Second”.')
    await dialog.getByRole('button', { name: /Cancel/ }).click()
    await expect(dialog).toBeHidden()
    await expectOpenLayout(page, 'Main')

    // Switch → Save: the change is kept and the other layout opens.
    await switchLayout(page, 'Second')
    await dialog.getByRole('button', { name: 'Save layout' }).click()
    await expectOpenLayout(page, 'Second')
    await expect.poll(() => wsShape(page)).toEqual([[['zTab']]])

    // Reload: still on Second; Main kept the saved change.
    await page.reload()
    await expectOpenLayout(page, 'Second')
    await switchLayout(page, 'Main')
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']]])
  })

  test('the folded picker: the layouts (the open one checked, Edited while unsaved) and its actions', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 })
    // A third layout, so the tabs fold even with the tray shrunk.
    await seedWorkspace(page, withSpareLayouts({ layouts: [twoColumns, second] }, 1))
    await wsTab(page, 'eisTab').click()
    await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Eisenhower' }).click()
    await page.getByTestId('layout-picker').click()
    await expect(page.getByRole('menuitemradio', { name: /Main/ })).toContainText('Edited')
    await expect(page.getByRole('menuitemradio', { name: /Main/ })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('menu', { name: 'Layouts' }).getByRole('menuitem')).toHaveText([
      'New layout…', 'Save changes', 'Save as new layout…', 'Discard changes', 'Edit…', 'Delete layout…',
    ])
    await page.getByRole('menuitem', { name: 'Discard changes' }).click()
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
    // The closed tab is back (a narrow cell may show its tabs in another order).
    await expect(wsTab(page, 'eisTab')).toBeVisible()
  })

  test('New layout asks a name; the empty layout is stored and opened at once', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns, second] })
    await page.getByRole('button', { name: 'New layout', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New layout' })
    await dialog.getByLabel('Name').fill('Planning')
    await dialog.getByRole('button', { name: 'Create layout' }).click()
    await expectOpenLayout(page, 'Planning')
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
    await expect(page.getByText('This layout is empty')).toBeVisible()
    expect(await wsShape(page)).toEqual([])

    await page.getByRole('button', { name: 'Notes' }).first().click()
    await saveButton(page).click()
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
    await page.reload()
    await expectOpenLayout(page, 'Planning')
    await expect(page.getByTestId('layout-tab')).toHaveText(['Main', 'Second', 'Planning'])
  })

  test('New layout with unsaved changes asks Save / Discard / Cancel first', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await wsTab(page, 'eisTab').click()
    await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Eisenhower' }).click()
    await page.getByRole('button', { name: 'New layout', exact: true }).click()
    await page.getByRole('dialog', { name: 'New layout' }).getByLabel('Name').fill('Planning')
    await page.getByRole('dialog', { name: 'New layout' }).getByRole('button', { name: 'Create layout' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save changes to layout “Main”?' })
    await expect(dialog).toContainText('You’re starting a new layout “Planning”.')
    await dialog.getByRole('button', { name: 'Discard' }).click()
    await expectOpenLayout(page, 'Planning')
    // Main lost the discarded change; nothing to ask about now.
    await switchLayout(page, 'Main')
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']]])
  })

  test('switching with Discard drops the change', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns, second] })
    await wsTab(page, 'eisTab').click()
    await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Eisenhower' }).click()
    await switchLayout(page, 'Second')
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click()
    await expectOpenLayout(page, 'Second')
    await switchLayout(page, 'Main')
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']]])
  })

  test('opening Settings with unsaved changes shows no prompt and keeps the layout dirty', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await wsTab(page, 'eisTab').click()
    await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Eisenhower' }).click()
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')

    const settings = await openSettings(page)
    await expect(page.getByRole('dialog', { name: /Save changes/ })).toHaveCount(0)
    await expect(page).toHaveURL(/#\/$/)
    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(settings).toBeHidden()
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']]])
  })

  test('leaving the workspace with unsaved changes prompts; Cancel stays, Discard leaves', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await wsTab(page, 'eisTab').click()
    await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Eisenhower' }).click()

    // Only the phone's Settings tab still navigates away from the workspace.
    await page.setViewportSize({ width: 390, height: 844 })
    const settingsTab = page.getByRole('button', { name: 'Settings' })
    await settingsTab.click()
    const dialog = page.getByRole('dialog', { name: 'Save changes to layout “Main”?' })
    await expect(dialog).toContainText('You’re leaving the workspace.')
    await dialog.getByRole('button', { name: /Cancel/ }).click()
    await expect(page).toHaveURL(/#\/$/)

    await settingsTab.click()
    await dialog.getByRole('button', { name: 'Discard' }).click()
    await expect(page).toHaveURL(/#\/settings$/)

    // Back on the workspace: the discarded change is gone, nothing to save.
    await page.getByRole('button', { name: 'Workspace' }).click()
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']]])
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  })

  test('save as, rename and delete from the open layout’s tab menu', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const only = await openLayoutTabMenu(page)
    await expect(only.getByRole('menuitem', { name: 'Delete layout…' })).toBeDisabled()
    await only.getByRole('menuitem', { name: 'Save as new layout…' }).click()
    const nameDialog = page.getByRole('dialog', { name: 'Save as new layout' })
    await expect(nameDialog.getByLabel('Name')).toHaveValue('Main copy')
    await nameDialog.getByLabel('Name').fill('Planning')
    await nameDialog.getByRole('button', { name: 'Save layout' }).click()
    await expectOpenLayout(page, 'Planning')

    await openLayoutAction(page, 'Edit…')
    const renameDialog = page.getByRole('dialog', { name: 'Edit layout' })
    await renameDialog.getByLabel('Name').fill('Weekly')
    await renameDialog.getByRole('button', { name: 'Apply' }).click()
    await expectOpenLayout(page, 'Weekly')

    await openLayoutAction(page, 'Delete layout…')
    await page.getByRole('dialog', { name: 'Delete layout “Weekly”?' }).getByRole('button', { name: 'Delete layout' }).click()
    await expectOpenLayout(page, 'Main')
    await expect(page.getByTestId('layout-tab')).toHaveText(['Main'])
  })
})

test.describe('adding and changing widgets', () => {
  test('empty layout tiles, the add-tab menu and the tab menu’s Change widget', async ({ page }) => {
    await seedWorkspace(page, { layouts: [{ name: 'Blank', columns: [] }] })
    await expect(page.getByText('This layout is empty')).toBeVisible()
    await page.getByRole('button', { name: 'Notes', exact: true }).click()
    await expect.poll(async () => (await wsShape(page)).flat(2).length).toBe(1)

    await page.getByRole('button', { name: 'Add widget as tab' }).click()
    await page.getByRole('menu', { name: 'Add widget' }).getByRole('menuitem', { name: 'Calendar' }).click()
    await expect(page.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('tab', { name: 'Calendar' }).click({ button: 'right' })
    const changeWidget = page.getByRole('menu', { name: 'Change widget' })
    await expect(changeWidget.getByRole('menuitemradio', { name: 'Calendar' })).toHaveAttribute('aria-checked', 'true')
    // A Numbers & charts kind, from its submenu.
    await pickWidgetKind(page, 'Change widget', 'Created vs completed')
    await expect(page.getByRole('tab', { name: /Created vs completed/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Calendar' })).toHaveCount(0)
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
  })
})

test.describe('task drags inside the workspace', () => {
  test('dragging a task from a list widget onto a calendar day sets its due date', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'Everything' }],
      tasks: [{ title: 'Move me' }],
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'colA', rows: [wsRow({ id: 'a1', tabs: [{ id: 'lensTab', kind: 'lens', listDefIdx: 0 }] })] },
          { id: 'colB', rows: [wsRow({ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar', dateTypes: { due: true, followup: false }, titles: true }] })] },
        ],
      }],
    })
    const row = wsCell(page, 'a1').locator('[data-row-key]').filter({ hasText: 'Move me' })
    const day = wsCell(page, 'b1').locator('[data-day]').nth(2)
    await expect(row).toBeVisible()
    const from = await box(row)
    await drag(page, { x: from.x + 40, y: from.y + from.height / 2 }, await pointIn(day), {
      during: () => expect(day).toHaveAttribute('data-drop-target', 'true'),
    })
    await expect(day).toContainText('Move me')
    // A task drop is not a layout change.
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  })
})
