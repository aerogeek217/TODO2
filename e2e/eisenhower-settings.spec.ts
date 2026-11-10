import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADD_FILTER, closeListFilterEditor, openListFilterEditor, openSettings, readListDefinitions, seedWorkspace, switchLayout, wsCell, wsTab, type WorkspaceSeed, wsRow, expectLayoutStored } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * Settings › Tasks › Eisenhower in a real browser: the app-wide panes and
 * source are edited there — Delegate gets `Status is not Delegated` and
 * every Eisenhower tab (on two layouts, one at its small face — the old
 * Eisenhower summary) follows; Esc in a pane's filter picker closes only the picker; each
 * change is one undo step and is kept across a reload. The Eisenhower's own
 * list's filter is edited there too, saved at once as an undo step like the
 * panes (Edit list from a widget's line saves with its Save). The workspace's entries are
 * shortcuts into it: the tab menu's Customize panes…, the cell ⋯ menu's, a
 * pane header's Edit pane… (focuses that pane's name). On a phone there is
 * no entry.
 */

const SEED: WorkspaceSeed = {
  statuses: ['Delegated'],
  listDefinitions: [{ name: 'Team' }, { name: 'Other' }],
  tasks: [
    { title: 'Chase vendor', urgent: true, status: 'Delegated' },
    { title: 'Review analytics', urgent: true },
    { title: 'Draft OKRs', important: true },
    { title: 'Migrate blog' },
  ],
  layouts: [
    {
      name: 'Main',
      // The second Eisenhower in a short fixed row across the bottom: its small face.
      table: {
        areas: ['a1 b0', 'b1 b1'],
        rows: [1000, { px: 120 }],
        cells: [
          { id: 'a1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] },
          { id: 'b0', tabs: [{ id: 'notes', kind: 'notes' }] },
          { id: 'b1', tabs: [{ id: 'dash', kind: 'eisenhower' }] },
        ],
      },
    },
    { name: 'Second', columns: [{ id: 'colX', rows: [wsRow({ id: 'x1', tabs: [{ id: 'eis2', kind: 'eisenhower' }] })] }] },
  ],
}

const quadrant = (page: Page, tabId: string, q: string) => page.locator(`[data-eisenhower="${tabId}"] [data-eis-quadrant="${q}"]`)
const row = (scope: Locator, title: string) => scope.locator('[data-row-key]').filter({ hasText: title })
const glanceQuadrantCount = (page: Page, q: string) =>
  page.locator('[data-eis-face-tab="dash"]').locator(`[data-eis-cell="${q}"]`).getByTestId('eis-face-count')
const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true })
const part = (page: Page) => settingsDialog(page).getByRole('region', { name: 'Eisenhower', exact: true })
const card = (page: Page, q: string) => part(page).locator(`[data-pane-card="${q}"]`)

async function storedPanes(page: Page): Promise<Record<string, unknown> | undefined> {
  const r = (await readStore<{ key: string; value: string }>(page, 'settings')).find((x) => x.key === 'eisenhowerPanes')
  return r ? JSON.parse(r.value) as Record<string, unknown> : undefined
}

async function storedSource(page: Page): Promise<string | undefined> {
  return (await readStore<{ key: string; value: string }>(page, 'settings')).find((x) => x.key === 'eisenhowerSource')?.value
}

async function closeSettings(page: Page): Promise<void> {
  await settingsDialog(page).getByRole('button', { name: 'Close settings' }).click()
  await expect(settingsDialog(page)).toHaveCount(0)
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('Delegate gets Status is not Delegated: every Eisenhower and the small face follow; Esc closes the picker only; Undo; reload', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect(row(quadrant(page, 'eisTab', 'delegate'), 'Chase vendor')).toBeVisible()
    await expect(glanceQuadrantCount(page, 'delegate')).toHaveText('2')

    await openSettings(page, 'Eisenhower')
    await expect(part(page)).toBeInViewport()
    await expect(card(page, 'delegate').getByTestId('customize-pane-count')).toHaveText('2 now')
    await card(page, 'delegate').getByRole('button', { name: ADD_FILTER }).click()
    await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Status' }).click()
    const picker = page.getByTestId('list-filter-picker')
    await picker.getByRole('radio', { name: 'Is not' }).click()
    await picker.getByRole('option', { name: 'Delegated' }).click()
    // Esc closes the picker only; Settings stays.
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(settingsDialog(page)).toBeVisible()
    await expect(card(page, 'delegate').getByTestId('customize-pane-count')).toHaveText('1 now')
    await expect(part(page).getByTestId('customize-panes-no-pane')).toContainText('1 open task is in no pane')
    await expect.poll(() => storedPanes(page)).toMatchObject({ delegate: { filter: { negate: { statusIds: true } } } })
    await closeSettings(page)

    // This layout's Eisenhower and its small face; a setting — the layout stays saved.
    await expect(row(quadrant(page, 'eisTab', 'delegate'), 'Chase vendor')).toHaveCount(0)
    await expect(quadrant(page, 'eisTab', 'delegate').getByTestId('eisenhower-pane-subtitle')).toHaveText('Urgent · not Important · not Delegated')
    await expect(glanceQuadrantCount(page, 'delegate')).toHaveText('1')
    await expectLayoutStored(page)
    // The other layout's Eisenhower.
    await switchLayout(page, 'Second')
    await expect(row(quadrant(page, 'eis2', 'delegate'), 'Review analytics')).toBeVisible()
    await expect(row(quadrant(page, 'eis2', 'delegate'), 'Chase vendor')).toHaveCount(0)

    // One undo step (Ctrl+Z, or the snackbar's Undo).
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')
    await expect(row(quadrant(page, 'eis2', 'delegate'), 'Chase vendor')).toBeVisible()
    await expect.poll(() => storedPanes(page)).toBeUndefined()
    await page.keyboard.press('Control+y')
    await expect(row(quadrant(page, 'eis2', 'delegate'), 'Chase vendor')).toHaveCount(0)
    await expect.poll(() => storedPanes(page)).toMatchObject({ delegate: { filter: { negate: { statusIds: true } } } })

    // Kept across a reload, on both layouts.
    await page.reload()
    await expect(row(quadrant(page, 'eis2', 'delegate'), 'Review analytics')).toBeVisible()
    await expect(row(quadrant(page, 'eis2', 'delegate'), 'Chase vendor')).toHaveCount(0)
    await switchLayout(page, 'Main')
    await expect(row(quadrant(page, 'eisTab', 'delegate'), 'Review analytics')).toBeVisible()
    await expect(row(quadrant(page, 'eisTab', 'delegate'), 'Chase vendor')).toHaveCount(0)
    await expect(glanceQuadrantCount(page, 'delegate')).toHaveText('1')
  })

  test('its list’s filter: a change in Settings is saved at once, one undo step; every Eisenhower and the small face follow; reload', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect(glanceQuadrantCount(page, 'delegate')).toHaveText('2')
    await openSettings(page, 'Eisenhower')
    // No Show › choice: the Eisenhower's own list, its filter as chips.
    await expect(part(page).getByTestId('eisenhower-source')).toHaveCount(0)
    const line = part(page).getByTestId('eisenhower-list-line')
    await expect(line).toContainText('No filters')
    await line.getByRole('button', { name: ADD_FILTER }).click()
    await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Status' }).click()
    const picker = page.getByTestId('list-filter-picker')
    await picker.getByRole('radio', { name: 'Is not' }).click()
    await picker.getByRole('option', { name: 'Delegated' }).click()
    // Esc closes the picker only.
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(settingsDialog(page)).toBeVisible()
    // Saved at once: no Revert · Save; the counts follow.
    await expect(line.getByTestId('save-list')).toHaveCount(0)
    await expect(card(page, 'delegate').getByTestId('customize-pane-count')).toHaveText('1 now')
    const source = await storedSource(page)
    const eisenhower = (await readListDefinitions(page)).find((d) => `list:${d.id}` === source)!
    expect(eisenhower.owner).toEqual({ eisenhower: true })
    await expect.poll(async () => ((await readListDefinitions(page)).find((d) => d.id === eisenhower.id)?.membership as { predicate: unknown }).predicate)
      .toMatchObject({ negate: { statusIds: true } })
    const snackbar = page.locator('[data-keeps-selection]').filter({ hasText: 'Undo' })
    await expect(snackbar).toContainText('Changed the Eisenhower’s filter')
    await closeSettings(page)

    // The widget's filter line reads it; the small face counts it too.
    const widgetLine = wsCell(page, 'a1').getByTestId('list-filter-row')
    await expect(widgetLine).toContainText('not Delegated')
    await expect(row(quadrant(page, 'eisTab', 'delegate'), 'Chase vendor')).toHaveCount(0)
    await expect(glanceQuadrantCount(page, 'delegate')).toHaveText('1')

    // Kept across a reload; the other layout's Eisenhower too.
    await page.reload()
    await expect(glanceQuadrantCount(page, 'delegate')).toHaveText('1')
    await switchLayout(page, 'Second')
    await expect(row(quadrant(page, 'eis2', 'delegate'), 'Review analytics')).toBeVisible()
    await expect(row(quadrant(page, 'eis2', 'delegate'), 'Chase vendor')).toHaveCount(0)
  })

  test('a pane edit is undone from the snackbar while Settings is open; Reset all panes asks first', async ({ page }) => {
    await seedWorkspace(page, { ...SEED, eisenhower: { panes: { drop: { name: 'Someday' } } } })
    await openSettings(page, 'Eisenhower')
    const snackbar = page.locator('[data-keeps-selection]').filter({ hasText: 'Undo' })

    // A filter change shows the snackbar over Settings; its Undo puts it back, Settings stays.
    await card(page, 'delegate').getByRole('button', { name: ADD_FILTER }).click()
    await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Status' }).click()
    const picker = page.getByTestId('list-filter-picker')
    await picker.getByRole('radio', { name: 'Is not' }).click()
    await picker.getByRole('option', { name: 'Delegated' }).click()
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(card(page, 'delegate').getByTestId('customize-pane-count')).toHaveText('1 now')
    await expect(snackbar).toContainText('Changed pane “Delegate”')
    await snackbar.getByRole('button', { name: 'Undo' }).click()
    await expect(card(page, 'delegate').getByTestId('customize-pane-count')).toHaveText('2 now')
    await expect.poll(() => storedPanes(page)).toEqual({ drop: { name: 'Someday' } })
    await expect(settingsDialog(page)).toBeVisible()

    // Reset all panes… asks first; Esc keeps the panes and Settings.
    const resetAll = part(page).getByRole('button', { name: 'Reset all panes…' })
    await resetAll.click()
    const confirm = page.getByRole('dialog', { name: 'Reset all panes?' })
    await expect(confirm).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(settingsDialog(page)).toBeVisible()
    await expect(card(page, 'drop').getByRole('textbox', { name: 'Name' })).toHaveValue('Someday')

    await resetAll.click()
    await confirm.getByRole('button', { name: 'Reset all panes' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(card(page, 'drop').getByRole('textbox', { name: 'Name' })).toHaveValue('')
    await expect.poll(() => storedPanes(page)).toBeUndefined()
    await expect(resetAll).toBeDisabled()
    await expect(snackbar).toContainText('Reset the Eisenhower panes')
    await snackbar.getByRole('button', { name: 'Undo' }).click()
    await expect(card(page, 'drop').getByRole('textbox', { name: 'Name' })).toHaveValue('Someday')
    await expect.poll(() => storedPanes(page)).toEqual({ drop: { name: 'Someday' } })
    await expect(settingsDialog(page)).toBeVisible()
  })

  test('Edit list’s Save on the widget’s line shows in Settings; Undo puts the filter back for every Eisenhower', async ({ page }) => {
    await seedWorkspace(page, SEED)
    // The widget's line reads the filter in words; Edit list (from them) edits it.
    const editor = await openListFilterEditor(page, wsCell(page, 'a1'))
    await editor.getByRole('button', { name: ADD_FILTER }).click()
    await page.getByRole('menuitem', { name: 'Status' }).click()
    await page.getByTestId('list-filter-picker').getByRole('option', { name: 'Delegated' }).click()
    await page.keyboard.press('Escape')
    await closeListFilterEditor(page)
    await expect(wsTab(page, 'eisTab').getByRole('img', { name: 'unsaved list changes' })).toHaveCount(0)

    await openSettings(page, 'Eisenhower')
    const line = part(page).getByTestId('eisenhower-list-line')
    await expect(line).toContainText('Delegated')
    await expect(line.getByTestId('revert-list')).toHaveCount(0)
    await closeSettings(page)
    // One undo step: Ctrl+Z puts the filter back, in the widget and in Settings.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')
    await expect(wsCell(page, 'a1').getByTestId('list-filter-row')).toContainText('Every open task')
    await openSettings(page, 'Eisenhower')
    await expect(line).toContainText('No filters')
  })

  test('the tab menu’s and the cell menu’s Customize panes…, a pane header’s Edit pane…, land on the part', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await wsTab(page, 'eisTab').click({ button: 'right' })
    const tabMenu = page.getByRole('menu', { name: 'Cell options' })
    await expect(tabMenu.getByRole('menuitem', { name: 'Edit list…' })).toBeVisible()
    await tabMenu.getByRole('menuitem', { name: 'Customize panes…' }).click()
    await expect(settingsDialog(page).getByRole('heading', { level: 2 })).toHaveText('Tasks')
    await expect(part(page)).toBeInViewport()
    await expect(card(page, 'do')).toBeInViewport()
    await closeSettings(page)

    await wsCell(page, 'a1').getByRole('button', { name: 'Cell options' }).click()
    await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Customize panes…' }).click()
    await expect(part(page)).toBeInViewport()
    await closeSettings(page)

    await quadrant(page, 'eisTab', 'drop').getByTestId('eisenhower-pane-subtitle').click({ button: 'right' })
    await page.getByRole('menu', { name: 'Drop pane' }).getByRole('menuitem', { name: 'Edit pane…' }).click()
    const name = card(page, 'drop').getByRole('textbox', { name: 'Name' })
    await expect(name).toBeFocused()
    await expect(name).toBeInViewport()
    await name.fill('Someday')
    await expect(quadrant(page, 'eisTab', 'drop')).toContainText('Someday')
    // The corner gear is gone.
    await expect(page.locator('[data-eisenhower-customize]')).toHaveCount(0)
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('no entry: not in the Settings page, the options sheet has Edit list… but no Customize, no pane menu', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      layouts: [{ name: 'Main', columns: [{ id: 'colA', rows: [wsRow({ id: 'a1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] })] }] }],
    })
    await expect(page.locator('[data-eisenhower="eisTab"]')).toHaveAttribute('data-layout', 'stacked')
    // Alone in its cell: no tab to long-press; its ⋯ has Eisenhower options….
    await wsCell(page, 'a1').getByRole('button', { name: 'Cell options' }).click()
    await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Eisenhower options…' }).click()
    const sheet = page.getByRole('menu', { name: 'Eisenhower' })
    await expect(sheet.getByRole('menuitem', { name: 'Edit list…' })).toBeVisible()
    await expect(sheet).toContainText('To change the panes, use Settings on a wider screen.')
    await expect(sheet.getByText('Customize panes…')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await quadrant(page, 'eisTab', 'do').getByTestId('eisenhower-pane-subtitle').dispatchEvent('contextmenu')
    await expect(page.getByRole('menu', { name: 'Do pane' })).toHaveCount(0)

    await page.goto('/#/settings')
    await expect(page.getByRole('button', { name: 'Database' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tasks' })).toHaveCount(0)
    await expect(page.getByText('Eisenhower', { exact: true })).toHaveCount(0)
  })
})
