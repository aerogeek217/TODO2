import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSettings, readListDefinitions, seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * Settings › Tasks › Eisenhower in a real browser: the app-wide panes and
 * source are edited there — Delegate gets `Status is not Delegated` and
 * every Eisenhower tab (on two layouts) and the dashboard's Eisenhower
 * section follow; Esc in a pane's filter picker closes only the picker; Show
 * › a list moves every Eisenhower to it; each change is one undo step and is
 * kept across a reload. The workspace's entries are shortcuts into it: the
 * tab menu's Customize panes… (whose first line names the source), the cell
 * ⋯ menu's, a pane header's Edit pane… (focuses that pane's name). On a
 * phone there is no entry.
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
      columns: [
        { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] }] },
        { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'dash', kind: 'dashboard', dashboard: { tiles: ['open'], sections: [{ id: 'eisenhower' }] } }] }] },
      ],
    },
    { name: 'Second', columns: [{ id: 'colX', cells: [{ id: 'x1', tabs: [{ id: 'eis2', kind: 'eisenhower' }] }] }] },
  ],
}

const quadrant = (page: Page, tabId: string, q: string) => page.locator(`[data-eisenhower="${tabId}"] [data-eis-quadrant="${q}"]`)
const row = (scope: Locator, title: string) => scope.locator('[data-row-key]').filter({ hasText: title })
const dashQuadrantCount = (page: Page, q: string) =>
  page.locator('[data-dashboard="dash"] [data-dash-section="eisenhower"]').locator(`[data-eis-cell="${q}"]`).getByTestId('dash-eis-count')
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

async function switchLayout(page: Page, name: string): Promise<void> {
  await page.getByTestId('layout-picker').click()
  await page.getByRole('menuitemradio', { name }).click()
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('Delegate gets Status is not Delegated: every Eisenhower and the dashboard follow; Esc closes the picker only; Undo; reload', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect(row(quadrant(page, 'eisTab', 'delegate'), 'Chase vendor')).toBeVisible()
    await expect(dashQuadrantCount(page, 'delegate')).toHaveText('2')

    await openSettings(page, 'Eisenhower')
    await expect(part(page)).toBeInViewport()
    await expect(card(page, 'delegate').getByTestId('customize-pane-count')).toHaveText('2 now')
    await card(page, 'delegate').getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Status' }).click()
    const picker = page.getByTestId('list-filter-picker')
    await picker.getByRole('radio', { name: 'Is not' }).click()
    await picker.locator('label', { hasText: 'Delegated' }).click()
    // Esc closes the picker only; Settings stays.
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(settingsDialog(page)).toBeVisible()
    await expect(card(page, 'delegate').getByTestId('customize-pane-count')).toHaveText('1 now')
    await expect(part(page).getByTestId('customize-panes-no-pane')).toContainText('1 open task is in no pane')
    await expect.poll(() => storedPanes(page)).toMatchObject({ delegate: { filter: { negate: { statusIds: true } } } })
    await closeSettings(page)

    // This layout's Eisenhower and the dashboard section; a setting — the layout stays saved.
    await expect(row(quadrant(page, 'eisTab', 'delegate'), 'Chase vendor')).toHaveCount(0)
    await expect(quadrant(page, 'eisTab', 'delegate').getByTestId('eisenhower-pane-subtitle')).toHaveText('Urgent · not Important · not Delegated')
    await expect(dashQuadrantCount(page, 'delegate')).toHaveText('1')
    await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
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
    await expect(dashQuadrantCount(page, 'delegate')).toHaveText('1')
  })

  test('Show › a list: every Eisenhower follows; the tab menu names it; Undo; reload keeps it', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] }] },
          { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'eis2', kind: 'eisenhower' }] }] },
        ],
      }],
    })
    await openSettings(page, 'Eisenhower')
    const show = part(page).getByTestId('eisenhower-source')
    await expect(show).toHaveText('All tasks')
    await show.click()
    const menu = page.getByRole('menu', { name: 'Eisenhower shows' })
    await expect(menu.getByRole('menuitemradio', { name: 'All tasks' })).toHaveAttribute('aria-checked', 'true')
    await menu.getByRole('menuitemradio', { name: 'Team' }).click()
    await expect(menu).toHaveCount(0)
    await expect(show).toHaveText('Team')
    const team = (await readListDefinitions(page)).find((d) => d.name === 'Team')!.id
    await expect.poll(() => storedSource(page)).toBe(`list:${team}`)
    await closeSettings(page)

    for (const id of ['eisTab', 'eis2']) await expect(wsTab(page, id)).toHaveAttribute('title', 'Eisenhower · Team')
    await expect(wsCell(page, 'a1').getByTestId('list-filter-row')).toBeVisible()
    await expect(wsCell(page, 'b1').getByTestId('list-filter-row')).toBeVisible()
    // The tab menu's first line names the source; Edit list… is there.
    await wsTab(page, 'eisTab').click({ button: 'right' })
    const tabMenu = page.getByRole('menu', { name: 'Change widget' })
    await expect(tabMenu).toContainText('Shows “Team”')
    await expect(tabMenu.getByRole('menuitem', { name: 'Edit list…' })).toBeVisible()
    await expect(tabMenu.getByRole('menuitem', { name: /^Show/ })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Undo' }).click()
    for (const id of ['eisTab', 'eis2']) await expect(wsTab(page, id)).toHaveAttribute('title', 'Eisenhower')
    await expect.poll(() => storedSource(page)).toBeUndefined()

    await openSettings(page, 'Eisenhower')
    await part(page).getByTestId('eisenhower-source').click()
    await page.getByRole('menu', { name: 'Eisenhower shows' }).getByRole('menuitemradio', { name: 'Other' }).click()
    await closeSettings(page)
    await expect.poll(() => storedSource(page)).toMatch(/^list:/)
    await page.reload()
    for (const id of ['eisTab', 'eis2']) await expect(wsTab(page, id)).toHaveAttribute('title', 'Eisenhower · Other')
  })

  test('a pane edit is undone from the snackbar while Settings is open; Reset all panes asks first', async ({ page }) => {
    await seedWorkspace(page, { ...SEED, eisenhower: { panes: { drop: { name: 'Someday' } } } })
    await openSettings(page, 'Eisenhower')
    const snackbar = page.locator('[data-keeps-selection]').filter({ hasText: 'Undo' })

    // A filter change shows the snackbar over Settings; its Undo puts it back, Settings stays.
    await card(page, 'delegate').getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Status' }).click()
    const picker = page.getByTestId('list-filter-picker')
    await picker.getByRole('radio', { name: 'Is not' }).click()
    await picker.locator('label', { hasText: 'Delegated' }).click()
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

  test('Show’s menu: Esc closes only the menu; leaving a source list’s unsaved edits asks first, over Settings', async ({ page }) => {
    await seedWorkspace(page, { ...SEED, eisenhower: { listDefIdx: 0 } })
    // Edit the source list from the Eisenhower's filter line: it becomes unsaved.
    const filterLine = wsCell(page, 'a1').getByTestId('list-filter-row')
    await filterLine.getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Status' }).click()
    await page.getByTestId('list-filter-picker').locator('label', { hasText: 'Delegated' }).click()
    await page.keyboard.press('Escape')
    await expect(wsTab(page, 'eisTab').getByRole('img', { name: 'unsaved list changes' })).toBeVisible()

    await openSettings(page, 'Eisenhower')
    const show = part(page).getByTestId('eisenhower-source')
    await expect(show).toHaveText('Team')
    await show.click()
    const menu = page.getByRole('menu', { name: 'Eisenhower shows' })
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(settingsDialog(page)).toBeVisible()
    await expect(show).toBeFocused()

    // Only Eisenhower tabs show Team: picking another list asks first, over Settings.
    await show.click()
    await menu.getByRole('menuitemradio', { name: 'Other' }).click()
    const prompt = page.getByRole('dialog', { name: 'Save changes to list “Team”?' })
    await expect(prompt).toBeVisible()
    await expect(prompt.getByRole('button', { name: 'Cancel' })).toBeInViewport()
    // Esc is the prompt's: Settings stays, the source too.
    await page.keyboard.press('Escape')
    await expect(prompt).toHaveCount(0)
    await expect(settingsDialog(page)).toBeVisible()
    await expect(show).toHaveText('Team')
    await expect.poll(() => storedSource(page)).toMatch(/^list:/)

    await show.click()
    await menu.getByRole('menuitemradio', { name: 'Other' }).click()
    await prompt.getByRole('button', { name: 'Discard' }).click()
    await expect(prompt).toHaveCount(0)
    await expect(show).toHaveText('Other')
    const other = (await readListDefinitions(page)).find((d) => d.name === 'Other')!.id
    await expect.poll(() => storedSource(page)).toBe(`list:${other}`)
    await expect(settingsDialog(page)).toBeVisible()
    await closeSettings(page)
    await expect(wsTab(page, 'eisTab').getByRole('img', { name: 'unsaved list changes' })).toHaveCount(0)
  })

  test('the tab menu’s and the cell menu’s Customize panes…, a pane header’s Edit pane…, land on the part', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await wsTab(page, 'eisTab').click({ button: 'right' })
    const tabMenu = page.getByRole('menu', { name: 'Change widget' })
    await expect(tabMenu).toContainText('Shows all tasks')
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

  test('no entry: not in the Settings page, the tab sheet only says what it shows, no pane menu', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      layouts: [{ name: 'Main', columns: [{ id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] }] }] }],
    })
    await expect(page.locator('[data-eisenhower="eisTab"]')).toHaveAttribute('data-layout', 'stacked')
    await wsTab(page, 'eisTab').dispatchEvent('contextmenu')
    const sheet = page.getByRole('menu', { name: 'Eisenhower' })
    await expect(sheet.getByTestId('eisenhower-sheet-source')).toHaveText(/Show\s*All tasks/)
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
