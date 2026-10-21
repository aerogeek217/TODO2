import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, seedWorkspace, switchLayout, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * Custom Eisenhower panes in a real browser: Settings › Tasks › Eisenhower
 * (the tab menu's Customize panes…) gives Delegate `Status is not Delegated` — a Delegated task leaves
 * the matrix and the line under it counts it (a click lists it in the task
 * dialog); the pane header shows the filter in words and the custom dot;
 * the panes are an app-wide setting — saved at once (the layout stays
 * saved), kept across a reload, the same in every Eisenhower tab, one undo
 * step per change; the header menu's Reset pane puts the default back. A drop on a pane whose filter sets a status writes the
 * status; a drop that wouldn't land the task in the pane is refused with
 * why — also on a pane naming a status that no longer exists. On a phone
 * the custom names show, read-only.
 */

const SEED: WorkspaceSeed = {
  statuses: ['Delegated', 'Waiting'],
  listDefinitions: [{ name: 'Everything' }],
  tasks: [
    { title: 'Chase vendor', urgent: true, status: 'Delegated' },
    { title: 'Review analytics', urgent: true },
    { title: 'Draft OKRs', important: true },
    { title: 'Migrate blog' },
  ],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'lensTab', kind: 'lens', listDefIdx: 0 }] }] },
      { id: 'colB', weight: 2, cells: [{ id: 'b1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] }] },
    ],
  }],
}

const widget = (page: Page) => page.locator('[data-eisenhower="eisTab"]')
const quadrant = (page: Page, q: string) => widget(page).locator(`[data-eis-quadrant="${q}"]`)
const row = (scope: Locator, title: string) => scope.locator('[data-row-key]').filter({ hasText: title })
const listRow = (page: Page, title: string) => row(wsCell(page, 'a1'), title)
const noPane = (page: Page) => wsCell(page, 'b1').getByTestId('eisenhower-no-pane')

const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true })

/** The tab menu's Customize panes…: Settings › Tasks › Eisenhower. */
async function openCustomize(page: Page): Promise<Locator> {
  await wsTab(page, 'eisTab').click({ button: 'right' })
  await page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitem', { name: 'Customize panes…' }).click()
  const part = settings(page).getByRole('region', { name: 'Eisenhower', exact: true })
  await expect(part).toBeVisible()
  return part
}

async function closeSettings(page: Page): Promise<void> {
  await settings(page).getByRole('button', { name: 'Close settings' }).click()
  await expect(settings(page)).toHaveCount(0)
}

/** In a pane card of the Eisenhower settings: + Filter › Status › (Is / Is not) › `status`. */
async function addStatusFilter(page: Page, card: Locator, status: string, mode: 'Is' | 'Is not'): Promise<void> {
  await card.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Status' }).click()
  const picker = page.getByTestId('list-filter-picker')
  if (mode === 'Is not') await picker.getByRole('radio', { name: 'Is not' }).click()
  await picker.getByRole('option', { name: status }).click()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
}

/** The stored Eisenhower panes setting, parsed; `undefined` = none (the defaults). */
async function storedPanes(page: Page): Promise<Record<string, unknown> | undefined> {
  const row = (await readStore<{ key: string; value: string }>(page, 'settings')).find((r) => r.key === 'eisenhowerPanes')
  return row ? JSON.parse(row.value) as Record<string, unknown> : undefined
}

async function statusId(page: Page, name: string): Promise<number> {
  const s = (await readStore<{ id: number; name: string }>(page, 'statuses')).find((x) => x.name === name)
  if (!s) throw new Error(`no status "${name}"`)
  return s.id
}

async function taskOf(page: Page, title: string): Promise<{ statusId?: number; urgent?: boolean; important?: boolean }> {
  const t = (await readStore<{ title: string; statusId?: number; urgent?: boolean; important?: boolean }>(page, 'todos')).find((x) => x.title === title)
  if (!t) throw new Error(`no task "${title}"`)
  return t
}

/** Drags `from` (grabbed near its left edge) onto `to`, checking `during` before letting go. */
async function dragOnto(page: Page, from: Locator, to: Locator, during?: () => Promise<void>): Promise<void> {
  const a = await box(from)
  await drag(page, { x: a.x + 12, y: a.y + a.height / 2 }, await pointIn(to, 0.5, 0.6), { during })
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('Delegate: Status is not Delegated — the task leaves the matrix, counted under it; saved at once; reload; Reset pane; Undo', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect(row(quadrant(page, 'delegate'), 'Chase vendor')).toBeVisible()
    await expect(noPane(page)).toHaveCount(0)

    const part = await openCustomize(page)
    const card = part.locator('[data-pane-card="delegate"]')
    await expect(card.getByTestId('customize-pane-count')).toHaveText('2 now')
    await addStatusFilter(page, card, 'Delegated', 'Is not')
    // Live in Settings and behind it.
    await expect(card.getByTestId('customize-pane-count')).toHaveText('1 now')
    await expect(part.getByTestId('customize-panes-no-pane')).toContainText('1 open task is in no pane')
    await expect(row(quadrant(page, 'delegate'), 'Chase vendor')).toHaveCount(0)
    await closeSettings(page)

    // The header: the filter in words and the custom dot; a setting — the layout stays saved.
    await expect(quadrant(page, 'delegate').getByTestId('eisenhower-pane-subtitle')).toHaveText('Urgent · not Important · not Delegated')
    await expect(quadrant(page, 'delegate').getByTestId('eisenhower-pane-custom')).toBeVisible()
    await expect(quadrant(page, 'do').getByTestId('eisenhower-pane-custom')).toHaveCount(0)
    await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
    await expect.poll(() => storedPanes(page)).toMatchObject({ delegate: { filter: { negate: { statusIds: true } } } })
    await expect(wsTab(page, 'eisTab')).toContainText('3 of 4')

    // The line under the matrix opens the task in the task dialog.
    await expect(noPane(page)).toHaveText('1 open task in no pane')
    await noPane(page).click()
    const tasks = page.getByRole('dialog', { name: 'In no pane' })
    await expect(tasks).toBeVisible()
    await expect(tasks).toContainText('Chase vendor')
    await page.keyboard.press('Escape')
    await expect(tasks).toHaveCount(0)

    // Saved at once: kept across a reload.
    await page.reload()
    await expect(quadrant(page, 'delegate').getByTestId('eisenhower-pane-subtitle')).toHaveText('Urgent · not Important · not Delegated')
    await expect(noPane(page)).toHaveText('1 open task in no pane')

    // The pane header's menu: Reset pane puts the default back.
    await quadrant(page, 'delegate').getByTestId('eisenhower-pane-subtitle').click({ button: 'right' })
    await page.getByRole('menu', { name: 'Delegate pane' }).getByRole('menuitem', { name: 'Reset pane' }).click()
    await expect(row(quadrant(page, 'delegate'), 'Chase vendor')).toBeVisible()
    await expect(quadrant(page, 'delegate').getByTestId('eisenhower-pane-subtitle')).toHaveText('Urgent, not important')
    await expect(quadrant(page, 'delegate').getByTestId('eisenhower-pane-custom')).toHaveCount(0)
    await expect(noPane(page)).toHaveCount(0)
    await expect.poll(() => storedPanes(page)).toBeUndefined()
    // One undo step brings it back (Ctrl+Z, or the snackbar's Undo).
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')
    await expect(row(quadrant(page, 'delegate'), 'Chase vendor')).toHaveCount(0)
    await expect(noPane(page)).toHaveText('1 open task in no pane')
  })

  test('the panes are the same in every Eisenhower tab, on every layout', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      eisenhower: { panes: { delegate: { name: 'Hand off', filter: { markers: { urgent: true, important: false }, statusIds: [999], negate: { statusIds: true } } } } },
      layouts: [
        SEED.layouts[0]!,
        { name: 'Second', columns: [{ id: 'colX', cells: [{ id: 'x1', tabs: [{ id: 'eis2', kind: 'eisenhower' }] }] }] },
      ],
    })
    await expect(quadrant(page, 'delegate')).toContainText('Hand off')
    const part = await openCustomize(page)
    await part.locator('[data-pane-card="drop"]').getByRole('textbox', { name: 'Name' }).fill('Someday')
    await closeSettings(page)
    await expect(quadrant(page, 'drop')).toContainText('Someday')

    await switchLayout(page, 'Second')
    const other = page.locator('[data-eisenhower="eis2"]')
    await expect(other.locator('[data-eis-quadrant="delegate"]')).toContainText('Hand off')
    await expect(other.locator('[data-eis-quadrant="drop"]')).toContainText('Someday')
  })

  test('a pane header’s Edit pane… opens Settings on that pane; renaming shows at once', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await quadrant(page, 'drop').getByTestId('eisenhower-pane-subtitle').click({ button: 'right' })
    await page.getByRole('menu', { name: 'Drop pane' }).getByRole('menuitem', { name: 'Edit pane…' }).click()
    const name = settings(page).locator('[data-pane-card="drop"]').getByRole('textbox', { name: 'Name' })
    await expect(name).toBeFocused()
    await name.fill('Someday')
    await expect(quadrant(page, 'drop')).toContainText('Someday')
    await expect(quadrant(page, 'drop').getByRole('button', { name: 'Add task to Someday' })).toBeAttached()
    // A renamed pane with its default filter keeps the default subtitle and has no dot.
    await expect(quadrant(page, 'drop').getByTestId('eisenhower-pane-subtitle')).toHaveText('Neither')
    await expect(quadrant(page, 'drop').getByTestId('eisenhower-pane-custom')).toHaveCount(0)
  })

  test('a drop on a pane whose filter sets a status writes it; one undo step', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const part = await openCustomize(page)
    await addStatusFilter(page, part.locator('[data-pane-card="drop"]'), 'Waiting', 'Is')
    await closeSettings(page)
    // Migrate blog has no status now: in no pane.
    await expect(row(quadrant(page, 'drop'), 'Migrate blog')).toHaveCount(0)
    await expect(noPane(page)).toHaveText('1 open task in no pane')

    await dragOnto(page, listRow(page, 'Migrate blog'), quadrant(page, 'drop'), async () => {
      await expect(quadrant(page, 'drop')).toHaveAttribute('data-drop-state', 'over')
      await expect(quadrant(page, 'drop').getByTestId('eisenhower-drop-preview')).toHaveText('→ Waiting')
    })
    await expect(row(quadrant(page, 'drop'), 'Migrate blog')).toBeVisible()
    await expect(noPane(page)).toHaveCount(0)
    const waiting = await statusId(page, 'Waiting')
    await expect.poll(async () => (await taskOf(page, 'Migrate blog')).statusId).toBe(waiting)
    await expect(page.getByText('Status Waiting · Migrate blog')).toBeVisible()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await taskOf(page, 'Migrate blog')).statusId).toBeUndefined()
  })

  test('a drop that wouldn’t land the task in the pane is refused, saying why', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const part = await openCustomize(page)
    await addStatusFilter(page, part.locator('[data-pane-card="delegate"]'), 'Delegated', 'Is not')
    await closeSettings(page)

    await dragOnto(page, listRow(page, 'Chase vendor'), quadrant(page, 'delegate'), async () => {
      await expect(quadrant(page, 'delegate')).toHaveAttribute('data-drop-state', 'refused')
      const tip = page.getByTestId('eisenhower-refusal')
      await expect(tip).toBeVisible()
      await expect(tip).toContainText('Can’t move to Delegate')
      await expect(tip).toContainText('Chase vendor is still Delegated.')
      // Do takes it (its filter doesn't test the status).
      await expect(quadrant(page, 'do')).toHaveAttribute('data-drop-state', 'valid')
    })
    await expect(page.getByTestId('eisenhower-refusal')).toHaveCount(0)
    expect(await taskOf(page, 'Chase vendor')).toMatchObject({ urgent: true })
    expect((await taskOf(page, 'Chase vendor')).important).toBeUndefined()
  })

  test('a pane naming a status that no longer exists refuses the drop, saying so, and writes nothing', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'lensTab', kind: 'lens', listDefIdx: 0 }] }] },
          {
            id: 'colB',
            weight: 2,
            cells: [{ id: 'b1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] }],
          },
        ],
      }],
      eisenhower: { panes: { drop: { name: 'Waiting on', filter: { statusIds: [999] } } } },
    })
    await dragOnto(page, listRow(page, 'Draft OKRs'), quadrant(page, 'drop'), async () => {
      await expect(quadrant(page, 'drop')).toHaveAttribute('data-drop-state', 'refused')
      const tip = page.getByTestId('eisenhower-refusal')
      await expect(tip).toContainText('Can’t move to Waiting on')
      await expect(tip).toContainText('The status this pane sets no longer exists.')
    })
    expect((await taskOf(page, 'Draft OKRs')).statusId).toBeUndefined()
    expect((await taskOf(page, 'Draft OKRs')).important).toBe(true)
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('custom pane names show; no Customize, no header menu', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      layouts: [{
        name: 'Main',
        columns: [{
          id: 'colB',
          cells: [{ id: 'b1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] }],
        }],
      }],
      eisenhower: { panes: { do: { name: 'Now' }, drop: { name: 'Someday' } } },
    })
    await expect(widget(page)).toHaveAttribute('data-layout', 'stacked')
    await expect(quadrant(page, 'do')).toContainText('Now')
    await expect(quadrant(page, 'drop')).toContainText('Someday')
    await expect(widget(page).locator('[data-eisenhower-customize]')).toHaveCount(0)
    await quadrant(page, 'do').getByTestId('eisenhower-pane-subtitle').dispatchEvent('contextmenu')
    await expect(page.getByRole('menu', { name: 'Now pane' })).toHaveCount(0)
  })
})
