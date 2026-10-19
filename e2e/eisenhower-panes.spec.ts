import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * Custom Eisenhower panes in a real browser: Customize panes (from the tab
 * menu) gives Delegate `Status is not Delegated` — a Delegated task leaves
 * the matrix and the line under it counts it (a click lists it in the task
 * dialog); the pane header shows the filter in words and the custom dot;
 * Save layout + reload keeps it; the header menu's Reset pane puts the
 * default back. A drop on a pane whose filter sets a status writes the
 * status; a drop that wouldn't land the task in the pane is refused with
 * why. On a phone the custom names show, read-only.
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

async function openCustomize(page: Page): Promise<Locator> {
  await wsTab(page, 'eisTab').click({ button: 'right' })
  await page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitem', { name: 'Customize panes…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Customize panes' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** In a pane card of the dialog: + Filter › Status › (Is / Is not) › `status`. */
async function addStatusFilter(page: Page, card: Locator, status: string, mode: 'Is' | 'Is not'): Promise<void> {
  await card.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Status' }).click()
  const picker = page.getByTestId('list-filter-picker')
  if (mode === 'Is not') await picker.getByRole('radio', { name: 'Is not' }).click()
  await picker.locator('label', { hasText: status }).click()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
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

  test('Delegate: Status is not Delegated — the task leaves the matrix, counted under it; Save + reload; Reset pane', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect(row(quadrant(page, 'delegate'), 'Chase vendor')).toBeVisible()
    await expect(noPane(page)).toHaveCount(0)

    const dialog = await openCustomize(page)
    const card = dialog.locator('[data-pane-card="delegate"]')
    await expect(card.getByTestId('customize-pane-count')).toHaveText('2 now')
    await addStatusFilter(page, card, 'Delegated', 'Is not')
    // Live in the dialog and behind it.
    await expect(card.getByTestId('customize-pane-count')).toHaveText('1 now')
    await expect(dialog.getByTestId('customize-panes-no-pane')).toContainText('1 open task is in no pane')
    await expect(row(quadrant(page, 'delegate'), 'Chase vendor')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)

    // The header: the filter in words and the custom dot; the layout is unsaved.
    await expect(quadrant(page, 'delegate').getByTestId('eisenhower-pane-subtitle')).toHaveText('Urgent · not Important · not Delegated')
    await expect(quadrant(page, 'delegate').getByTestId('eisenhower-pane-custom')).toBeVisible()
    await expect(quadrant(page, 'do').getByTestId('eisenhower-pane-custom')).toHaveCount(0)
    await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')
    await expect(wsTab(page, 'eisTab')).toContainText('3 of 4')

    // The line under the matrix opens the task in the task dialog.
    await expect(noPane(page)).toHaveText('1 open task in no pane')
    await noPane(page).click()
    const tasks = page.getByRole('dialog', { name: 'In no pane' })
    await expect(tasks).toBeVisible()
    await expect(tasks).toContainText('Chase vendor')
    await page.keyboard.press('Escape')
    await expect(tasks).toHaveCount(0)

    // Saved with the layout: kept across a reload.
    await page.getByTestId('layout-save').click()
    await expect(page.getByTestId('layout-save')).toHaveAttribute('aria-disabled', 'true')
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
  })

  test('a pane header’s Edit pane… opens the dialog on that pane; renaming shows at once', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await quadrant(page, 'drop').getByTestId('eisenhower-pane-subtitle').click({ button: 'right' })
    await page.getByRole('menu', { name: 'Drop pane' }).getByRole('menuitem', { name: 'Edit pane…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Customize panes' })
    const name = dialog.locator('[data-pane-card="drop"]').getByRole('textbox', { name: 'Name' })
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
    const dialog = await openCustomize(page)
    await addStatusFilter(page, dialog.locator('[data-pane-card="drop"]'), 'Waiting', 'Is')
    await dialog.getByRole('button', { name: 'Done' }).click()
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
    const dialog = await openCustomize(page)
    await addStatusFilter(page, dialog.locator('[data-pane-card="delegate"]'), 'Delegated', 'Is not')
    await dialog.getByRole('button', { name: 'Done' }).click()

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
          cells: [{ id: 'b1', tabs: [{ id: 'eisTab', kind: 'eisenhower', panes: { do: { name: 'Now' }, drop: { name: 'Someday' } } }] }],
        }],
      }],
    })
    await expect(widget(page)).toHaveAttribute('data-layout', 'stacked')
    await expect(quadrant(page, 'do')).toContainText('Now')
    await expect(quadrant(page, 'drop')).toContainText('Someday')
    await expect(widget(page).locator('[data-eisenhower-customize]')).toHaveCount(0)
    await quadrant(page, 'do').getByTestId('eisenhower-pane-subtitle').dispatchEvent('contextmenu')
    await expect(page.getByRole('menu', { name: 'Now pane' })).toHaveCount(0)
  })
})
