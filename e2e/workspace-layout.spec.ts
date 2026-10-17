import { expect, test, type Page } from '@playwright/test'
import { drag, dragTab, openSettings, seedWorkspace, wsCell, wsShape, wsTab, type WsLayoutSeed } from './fixtures/workspace'
import { box, pointIn, type Point } from './fixtures/geometry'

/**
 * Workspace layout editing in a real browser: the three tab drop targets
 * (cell middle / cell edge / column edge) plus tab-strip insertion, column
 * and cell resizing, collapse, and the saved-layout flow (save icon, the
 * Save / Discard / Cancel prompt on layout switch and on leaving the route,
 * none when Settings opens over the workspace, persistence across reload).
 */

const twoColumns: WsLayoutSeed = {
  name: 'Main',
  columns: [
    { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }, { id: 'eisTab', kind: 'eisenhower' }] }] },
    { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] }] },
  ],
}

const saveButton = (page: Page) => page.getByTestId('layout-save')

function bodyPoint(page: Page, cellId: string, fy: number): Promise<Point> {
  return pointIn(wsCell(page, cellId).locator('[data-ws-cell-body]'), 0.5, fy)
}

test.describe('tab drop targets', () => {
  test('cell middle joins the cell as a tab', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const to = await bodyPoint(page, 'b1', 0.5)
    await dragTab(page, wsTab(page, 'eisTab'), to, async () => {
      await expect(wsCell(page, 'b1').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', 'middle')
      await expect(wsCell(page, 'b1').getByTestId('ws-ghost-tab')).toBeVisible()
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab', 'eisTab']]])
    await expect(wsTab(page, 'eisTab')).toHaveAttribute('aria-selected', 'true')
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
  })

  test('cell top / bottom edge makes a new cell in that column', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const top = await bodyPoint(page, 'b1', 0.1)
    await dragTab(page, wsTab(page, 'eisTab'), top, async () => {
      await expect(wsCell(page, 'b1').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', 'top')
      await expect(page.getByTestId('ws-new-cell-bar')).toBeVisible()
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['eisTab'], ['calTab']]])

    const bottom = await bodyPoint(page, 'b1', 0.92)
    await dragTab(page, wsTab(page, 'notesTab'), bottom)
    await expect.poll(() => wsShape(page)).toEqual([[['eisTab'], ['calTab'], ['notesTab']]])
  })

  test('column edge makes a new column; the empty column goes away', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const a = await page.locator('[data-ws-column="colA"]').boundingBox()
    const b = await page.locator('[data-ws-column="colB"]').boundingBox()
    if (!a || !b) throw new Error('no columns')
    const gutterX = (a.x + a.width + b.x) / 2
    await dragTab(page, wsTab(page, 'eisTab'), { x: gutterX + 6, y: a.y + a.height / 2 }, async () => {
      await expect(page.getByTestId('ws-new-column-band')).toBeVisible()
      await expect(page.getByText('New column')).toBeVisible()
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['eisTab']], [['calTab']]])

    // The outer right edge, from the middle column (its only tab): that column empties and is removed.
    const area = await page.locator('[data-ws-area]').boundingBox()
    if (!area) throw new Error('no area')
    await dragTab(page, wsTab(page, 'eisTab'), { x: area.x + area.width - 10, y: area.y + area.height / 2 })
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

    // Dropping a single-tab cell's tab on its own body changes nothing (and stays plain).
    const own = await bodyPoint(page, 'b1', 0.5)
    await dragTab(page, wsTab(page, 'calTab'), own, async () => {
      await expect(wsCell(page, 'b1').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', '')
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
  test('dragging the column divider resizes both neighbours and respects the 280px minimum', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const divider = page.getByRole('separator', { name: 'Resize columns' })
    const before = await page.locator('[data-ws-column="colA"]').boundingBox()
    const d = await divider.boundingBox()
    if (!before || !d) throw new Error('no geometry')
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2)
    await page.mouse.down()
    await page.mouse.move(d.x + d.width / 2 + 120, d.y + d.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => Math.round((await page.locator('[data-ws-column="colA"]').boundingBox())!.width - before.width)).toBeGreaterThan(100)
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')

    // Far past the other column's minimum: it stops at 280px.
    const d2 = await divider.boundingBox()
    await page.mouse.move(d2!.x + 3, d2!.y + 300)
    await page.mouse.down()
    await page.mouse.move(d2!.x + 2000, d2!.y + 300, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => Math.round((await page.locator('[data-ws-column="colB"]').boundingBox())!.width)).toBe(280)
  })

  test('cell divider resizes; dragging past the minimum collapses the cell; collapse is not an unsaved change', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        columns: [{ id: 'colA', cells: [
          { id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }] },
          { id: 'a2', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] },
        ] }],
      }],
    })
    const divider = page.getByRole('separator', { name: 'Resize cells' })
    const top = await wsCell(page, 'a1').boundingBox()
    const d = await divider.boundingBox()
    if (!top || !d) throw new Error('no geometry')
    await page.mouse.move(d.x + 200, d.y + d.height / 2)
    await page.mouse.down()
    await page.mouse.move(d.x + 200, d.y + d.height / 2 - 100, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => Math.round(top.height - (await wsCell(page, 'a1').boundingBox())!.height)).toBeGreaterThan(80)
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
    await saveButton(page).click()
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')

    // Drag far up: the top cell collapses to its header.
    const d2 = await divider.boundingBox()
    await page.mouse.move(d2!.x + 200, d2!.y + 3)
    await page.mouse.down()
    await page.mouse.move(d2!.x + 200, 0, { steps: 10 })
    await page.mouse.up()
    await expect(wsCell(page, 'a1').getByRole('button', { name: 'Expand cell' })).toBeVisible()
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')

    // Collapsed state is saved automatically.
    await page.reload()
    await expect(wsCell(page, 'a1').getByRole('button', { name: 'Expand cell' })).toBeVisible()
    await wsCell(page, 'a1').getByRole('button', { name: 'Expand cell' }).click()
    await expect(wsCell(page, 'a1').locator('[data-ws-cell-body]')).toBeVisible()
  })

  test('cell header Collapse button and the cell menu split / close', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const header = wsCell(page, 'b1').locator('[data-ws-cell-header]')
    await header.hover()
    await header.getByRole('button', { name: 'Collapse cell' }).click()
    await expect(wsCell(page, 'b1').locator('[data-ws-cell-body]')).toHaveCount(0)
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
    await wsCell(page, 'b1').getByRole('button', { name: 'Expand cell' }).click()

    await header.hover()
    await header.getByRole('button', { name: 'Cell options' }).click()
    await page.getByRole('menuitem', { name: 'Split below' }).click()
    await expect(page.getByRole('region', { name: 'Empty cell' })).toBeVisible()
    await page.getByRole('region', { name: 'Empty cell' }).getByRole('button', { name: 'Notes' }).click()
    await expect.poll(async () => (await wsShape(page))[1]?.length).toBe(2)
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
  })
})

test.describe('saved layouts', () => {
  const second: WsLayoutSeed = {
    name: 'Second',
    columns: [{ id: 'colZ', cells: [{ id: 'z1', tabs: [{ id: 'zTab', kind: 'eisenhower' }] }] }],
  }

  test('save persists across reload; switching layouts prompts Save / Discard / Cancel', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns, second] })
    await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Main')

    // An unsaved change: close the Eisenhower tab.
    await wsTab(page, 'eisTab').click()
    await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Eisenhower' }).click()
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')

    // Switch → prompt → Cancel stays.
    await page.getByTestId('layout-picker').click()
    await expect(page.getByRole('menuitemradio', { name: /Main/ })).toContainText('Edited')
    await page.getByRole('menuitemradio', { name: 'Second' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save changes to layout “Main”?' })
    await expect(dialog).toContainText('You’re switching to “Second”.')
    await dialog.getByRole('button', { name: /Cancel/ }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Main')

    // Switch → Save: the change is kept and the other layout opens.
    await page.getByTestId('layout-picker').click()
    await page.getByRole('menuitemradio', { name: 'Second' }).click()
    await dialog.getByRole('button', { name: 'Save layout' }).click()
    await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Second')
    await expect.poll(() => wsShape(page)).toEqual([[['zTab']]])

    // Reload: still on Second; Main kept the saved change.
    await page.reload()
    await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Second')
    await page.getByTestId('layout-picker').click()
    await page.getByRole('menuitemradio', { name: 'Main' }).click()
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']]])
  })

  test('New layout: an empty, unsaved Untitled layout; Save stores it, Discard goes back', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns, second] })
    const picker = page.getByTestId('layout-picker')
    await picker.click()
    await page.getByRole('menuitem', { name: 'New layout', exact: true }).click()
    await expect(picker).toHaveAccessibleName('Layout: Untitled layout')
    await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
    await expect(page.getByText('This layout is empty')).toBeVisible()
    expect(await wsShape(page)).toEqual([])

    // The picker lists it, checked and marked New; Discard goes back to Main.
    await picker.click()
    await expect(page.getByRole('menuitemradio', { name: /Untitled layout/ })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('menuitemradio', { name: /Untitled layout/ })).toContainText('New')
    await page.getByRole('menuitem', { name: 'Discard changes' }).click()
    await expect(picker).toHaveAccessibleName('Layout: Main')
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']]])

    // Again, then Save: it's stored and stays after a reload.
    await picker.click()
    await page.getByRole('menuitem', { name: 'New layout', exact: true }).click()
    await page.getByRole('button', { name: 'Notes' }).first().click()
    await saveButton(page).click()
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
    await page.reload()
    await expect(picker).toHaveAccessibleName('Layout: Untitled layout')
    await picker.click()
    await expect(page.getByRole('menuitemradio')).toHaveText(['Main', 'Second', 'Untitled layout'])
  })

  test('New layout with unsaved changes asks Save / Discard / Cancel first', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await wsTab(page, 'eisTab').click()
    await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Eisenhower' }).click()
    await page.getByTestId('layout-picker').click()
    await page.getByRole('menuitem', { name: 'New layout', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Save changes to layout “Main”?' })
    await expect(dialog).toContainText('You’re starting a new layout.')
    await dialog.getByRole('button', { name: 'Discard' }).click()
    await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Untitled layout')
    // Main lost the discarded change.
    await page.getByTestId('layout-picker').click()
    await page.getByRole('menuitemradio', { name: 'Main' }).click()
    await page.getByRole('dialog', { name: /Save changes to layout “Untitled layout”/ }).getByRole('button', { name: 'Discard' }).click()
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']]])
  })

  test('switching with Discard drops the change', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns, second] })
    await wsTab(page, 'eisTab').click()
    await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Eisenhower' }).click()
    await page.getByTestId('layout-picker').click()
    await page.getByRole('menuitemradio', { name: 'Second' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click()
    await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Second')
    await page.getByTestId('layout-picker').click()
    await page.getByRole('menuitemradio', { name: 'Main' }).click()
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
    const settingsTab = page.getByRole('tab', { name: 'Settings' })
    await settingsTab.click()
    const dialog = page.getByRole('dialog', { name: 'Save changes to layout “Main”?' })
    await expect(dialog).toContainText('You’re leaving the workspace.')
    await dialog.getByRole('button', { name: /Cancel/ }).click()
    await expect(page).toHaveURL(/#\/$/)

    await settingsTab.click()
    await dialog.getByRole('button', { name: 'Discard' }).click()
    await expect(page).toHaveURL(/#\/settings$/)

    // Back on the workspace: the discarded change is gone, nothing to save.
    await page.getByRole('tab', { name: 'Workspace' }).click()
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']]])
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  })

  test('save as, rename and delete from the layout menu', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await page.getByTestId('layout-picker').click()
    await expect(page.getByRole('menuitem', { name: 'Delete layout…' })).toBeDisabled()
    await page.getByRole('menuitem', { name: 'Save as new layout…' }).click()
    const nameDialog = page.getByRole('dialog', { name: 'Save as new layout' })
    await expect(nameDialog.getByLabel('Name')).toHaveValue('Main copy')
    await nameDialog.getByLabel('Name').fill('Planning')
    await nameDialog.getByRole('button', { name: 'Save layout' }).click()
    await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Planning')

    await page.getByTestId('layout-picker').click()
    await page.getByRole('menuitem', { name: 'Rename…' }).click()
    const renameDialog = page.getByRole('dialog', { name: 'Rename layout' })
    await renameDialog.getByLabel('Name').fill('Weekly')
    await renameDialog.getByRole('button', { name: 'Rename' }).click()
    await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Weekly')

    await page.getByTestId('layout-picker').click()
    await page.getByRole('menuitem', { name: 'Delete layout…' }).click()
    await page.getByRole('dialog', { name: 'Delete layout “Weekly”?' }).getByRole('button', { name: 'Delete layout' }).click()
    await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Main')
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
    await changeWidget.getByRole('menuitemradio', { name: 'Dashboard' }).click()
    await expect(page.getByRole('tab', { name: /Dashboard/ })).toBeVisible()
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
          { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'lensTab', kind: 'lens', listDefIdx: 0 }] }] },
          { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar', dateTypes: { due: true, followup: false } }] }] },
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
