import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsTab, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * A widget's menu — the cell's whole menu on a right-click or Shift+F10
 * (D26 AA1), its widget's entries first: a list tab's has no Change list
 * (UX cleanup 4A); Shift+F10 on a tab opens the menu under the tab and Esc
 * gives the tab its focus back; the menu stays inside the window; the
 * Neglect map's Untouched after submenu sits beside its item.
 *
 * JSDOM is unauthoritative here — the menus portal to `document.body` and are
 * placed / clamped from `getBoundingClientRect`; hover and focus order are
 * real-browser behaviour.
 */

/** Two lists of the layout (each shown by a tab: a layout's lists are the ones it shows). */
const twoLists: WorkspaceSeed = {
  listDefinitions: [{ name: 'Source list' }, { name: 'Target list' }],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'col', rows: [wsRow({ id: 'cell', tabs: [{ id: 'listTab', kind: 'lens', listDefIdx: 0 }] })] },
      { id: 'col2', rows: [wsRow({ id: 'cell2', tabs: [{ id: 'targetTab', kind: 'lens', listDefIdx: 1 }] })] },
    ],
  }],
}

const tabMenu = (page: Page) => page.getByRole('menu', { name: 'Cell options' })

test('a list tab’s menu has no Change list (UX cleanup 4A, decision 11): Edit list… leads it', async ({ page }) => {
  await seedWorkspace(page, twoLists)
  // Alone in its cell: its top line (the filter line, its name first) stands for the tab.
  const tab = wsTab(page, 'listTab')
  await expect(tab).toContainText('Source list')
  await tab.getByTestId('top-line-name').click({ button: 'right' })
  const menu = tabMenu(page)
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await expect(menu.getByRole('menuitem').first()).toHaveAttribute('data-menu-label', 'Edit list…')
  await expect(menu.getByRole('menuitem', { name: /Change list/ })).toHaveCount(0)
})

/** A tab in the right-hand of two columns (near the right edge) and one on the left. */
const twoColumns: WorkspaceSeed = {
  listDefinitions: [{ name: 'Source list' }, { name: 'Target list' }],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'left', rows: [wsRow({ id: 'leftCell', tabs: [{ id: 'mapTab', kind: 'neglect' }, { id: 'listTab', kind: 'lens', listDefIdx: 0 }] })] },
      { id: 'right', rows: [wsRow({ id: 'rightCell', tabs: [{ id: 'notesTab', kind: 'notes' }] })] },
    ],
  }],
}

async function rect(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

test('Shift+F10 on a tab opens its menu under the tab; type-ahead moves; Esc returns focus to the tab', async ({ page }) => {
  // A tab: the list beside the Neglect map in one cell.
  await seedWorkspace(page, twoColumns)
  const tab = wsTab(page, 'listTab')
  await tab.focus()
  await page.keyboard.press('Shift+F10')
  const menu = tabMenu(page)
  await expect(menu).toBeVisible()
  await expect(menu).toHaveAttribute('data-shortcut-scope', 'none')
  const t = await rect(tab)
  const m = await rect(menu)
  expect(Math.round(m.x)).toBe(Math.round(t.x))
  expect(m.y).toBeGreaterThanOrEqual(t.y + t.height)
  await expect(menu.getByRole('menuitem', { name: 'Edit list…' })).toBeFocused()
  // Type-ahead: the next item starting with the key — the kinds are in Change widget's submenu, so it is
  // the cell's (Shift+F10 opens the whole menu, both sections).
  await page.keyboard.press('s')
  await expect(menu.getByRole('menuitem', { name: 'Split cell' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(tab).toBeFocused()
})

test('the tab menu opened at the window’s right edge stays inside the window', async ({ page }) => {
  await seedWorkspace(page, twoColumns)
  const vp = page.viewportSize()!
  // Right-click the right-hand widget's top line at the window's right edge: the menu ends inside the window.
  const tab = wsTab(page, 'notesTab')
  const t = await rect(tab)
  await page.mouse.click(Math.min(t.x + t.width - 2, vp.width - 4), t.y + t.height / 2, { button: 'right' })
  const menu = tabMenu(page)
  await expect(menu).toBeVisible()
  const m = await rect(menu)
  expect(m.x + m.width).toBeLessThanOrEqual(vp.width - 8 + 0.5)
  expect(m.y + m.height).toBeLessThanOrEqual(vp.height - 8 + 0.5)
})

test('a widget setting’s submenu (the Neglect map’s Untouched after): → opens it on the current value beside its item; ← goes back', async ({ page }) => {
  await seedWorkspace(page, twoColumns)
  await wsTab(page, 'mapTab').click({ button: 'right' })
  const menu = tabMenu(page)
  const item = menu.getByRole('menuitem', { name: /Untouched after/ })
  // First Colour by, then Untouched after.
  await expect(menu.getByRole('menuitem', { name: /Colour by/ })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(item).toBeFocused()
  await expect(item).toContainText('14 days')
  await page.keyboard.press('ArrowRight')
  const sub = page.getByRole('menu', { name: 'Untouched after' })
  await expect(sub.getByRole('menuitemradio', { name: /14 days/ })).toBeFocused()
  const m = await rect(menu)
  const s = await rect(sub)
  const i = await rect(item)
  expect(s.x).toBeGreaterThanOrEqual(m.x + m.width)
  // The submenu's top is 4px (its padding) above the item.
  expect(Math.abs(s.y + 4 - i.y)).toBeLessThanOrEqual(2)
  await page.keyboard.press('ArrowLeft')
  await expect(sub).toHaveCount(0)
  await expect(item).toBeFocused()
})
