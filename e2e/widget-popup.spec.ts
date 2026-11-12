import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * Open larger (the widget popup) in a real browser: a List, a Calendar and a
 * Neglect map open from the cell's Open larger button, its ⋯ menu and the
 * palette's Open Widget Larger — one popup, `min(1400px, 100vw − 48px)` ×
 * `100vh − 48px`, centered, the same tab as the cell (its data, and an edit
 * made inside shows in the cell). Esc, × and a press on the scrim close it,
 * the focus back on what opened it.
 */

const VIEWPORT = { width: 1600, height: 1000 }
test.use({ viewport: VIEWPORT })

const SEED: WorkspaceSeed = {
  tags: ['Project: Atlas'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Renew the domain', dueInDays: -2, tags: ['Project: Atlas'] },
    { title: 'Book the venue', dueInDays: 1 },
    { title: 'Draft the agenda', dueInDays: 3 },
  ],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] },
      { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 'cal', kind: 'calendar' }] })] },
      { id: 'c3', rows: [wsRow({ id: 'k3', tabs: [{ id: 'map', kind: 'neglect', neglect: { colourBy: { tags: ['Project: Atlas'] } } }] })] },
    ],
  }],
}

const popup = (page: Page) => page.getByTestId('widget-popup')

/** The popup's size and place: nearly the whole window, centered. */
async function expectPopupSize(page: Page) {
  const p = await box(popup(page))
  expect(Math.round(p.width)).toBe(Math.min(1400, VIEWPORT.width - 48))
  expect(Math.round(p.height)).toBe(VIEWPORT.height - 48)
  expect(Math.abs(p.x + p.width / 2 - VIEWPORT.width / 2)).toBeLessThanOrEqual(1)
  expect(Math.abs(p.y + p.height / 2 - VIEWPORT.height / 2)).toBeLessThanOrEqual(1)
}

async function openFromButton(page: Page, cell: Locator): Promise<Locator> {
  await cell.hover()
  const button = cell.getByRole('button', { name: 'Open larger' })
  await button.click()
  await expect(popup(page)).toBeVisible()
  return button
}

test('a List opens larger from its button: the same list, an edit inside shows in the cell; Esc closes it, the focus back on the button', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const cell = wsCell(page, 'k1')
  await expect(cell.locator('[data-todo-id]')).toHaveCount(3)
  const button = await openFromButton(page, cell)
  await expectPopupSize(page)
  await expect(popup(page)).toHaveAttribute('aria-label', 'Team')
  await expect(popup(page).locator('[data-todo-id]')).toHaveCount(3)
  // No cell controls in the popup: its header has its own ⋯ and ×.
  await expect(popup(page).locator('[data-cell-controls]')).toHaveCount(0)

  await popup(page).locator('[data-row-key]').filter({ hasText: 'Book the venue' }).getByRole('checkbox', { name: 'Mark complete' }).click()
  await expect(cell.locator('[data-row-key]').filter({ hasText: 'Book the venue' })).toHaveCount(0)
  await expect(popup(page).locator('[data-row-key]').filter({ hasText: 'Book the venue' })).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(popup(page)).toHaveCount(0)
  await expect(button).toBeFocused()
})

test('a Calendar opens larger from the ⋯ menu; × closes it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const cell = wsCell(page, 'k2')
  await cell.hover()
  await cell.getByRole('button', { name: 'Cell options' }).click()
  const menu = page.getByRole('menu', { name: 'Cell options' })
  const items = await menu.getByRole('menuitem').allTextContents()
  // Open larger sits in the widget's section, before Name and icon….
  expect(items.findIndex((t) => t.includes('Open larger'))).toBeLessThan(items.findIndex((t) => t.includes('Name and icon')))
  await menu.getByRole('menuitem', { name: 'Open larger' }).click()
  await expect(popup(page)).toBeVisible()
  await expectPopupSize(page)
  await expect(popup(page).locator('[data-calendar-widget="cal"]')).toBeVisible()
  await popup(page).getByRole('button', { name: 'Close' }).click()
  await expect(popup(page)).toHaveCount(0)
})

test('a Neglect map opens larger from the palette (the cell last used); a press on the scrim closes it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const cell = wsCell(page, 'k3')
  // The cell last used: the focus in it when the palette opens.
  await cell.hover()
  await cell.getByRole('button', { name: 'Open larger' }).focus()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Find tasks, commands/).pressSequentially('open widget larger')
  await page.keyboard.press('Enter')
  await expect(popup(page)).toBeVisible()
  await expectPopupSize(page)
  const map = popup(page).locator('[data-neglect-dot]')
  await expect(map).toHaveCount(await cell.locator('[data-neglect-dot]').count())
  await page.mouse.click(6, VIEWPORT.height - 6)
  await expect(popup(page)).toHaveCount(0)
})

test('the popup’s ⋯ holds the widget’s own entries only', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await openFromButton(page, wsCell(page, 'k1'))
  await popup(page).getByRole('button', { name: 'Widget options' }).click()
  const items = await page.getByRole('menu', { name: 'Widget options' }).getByRole('menuitem').allTextContents()
  expect(items.some((t) => t.startsWith('Edit list'))).toBe(true)
  for (const absent of ['Open larger', 'Change widget', 'Add widget', 'Split cell', 'Close cell', 'Name and icon']) {
    expect(items.some((t) => t.includes(absent))).toBe(false)
  }
})
