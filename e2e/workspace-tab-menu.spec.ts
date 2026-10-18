import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A tab's menu (`WidgetKindMenu` on `MenuPopover`): the list tab's "Change
 * list" submenu opens by hover or ArrowRight, Escape closes it back to the
 * menu, and a pick switches the tab's list; Shift+F10 opens the menu under
 * the tab and Esc gives the tab its focus back; the menu stays inside the
 * window; the dashboard's Hot is › panel and the Eisenhower range submenu
 * sit beside their items (flipped left near the right edge). Plus the
 * add-tab list picker, which must stay inside the viewport when opened from a
 * cell near the bottom.
 *
 * JSDOM is unauthoritative here — the menus portal to `document.body` and are
 * placed / clamped from `getBoundingClientRect`; hover and focus order are
 * real-browser behaviour.
 */

const twoLists: WorkspaceSeed = {
  listDefinitions: [{ name: 'Source list' }, { name: 'Target list' }],
  layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: 'listTab', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

const tabMenu = (page: Page) => page.getByRole('menu', { name: 'Change widget' })
const flyout = (page: Page) => page.getByRole('menu', { name: 'Change list' })

test('hovering Change list opens the flyout; picking a list switches the tab', async ({ page }) => {
  await seedWorkspace(page, twoLists)
  const tab = wsTab(page, 'listTab')
  await expect(tab).toContainText('Source list')

  await tab.click({ button: 'right' })
  const menu = tabMenu(page)
  await expect(menu).toBeVisible()
  const changeList = menu.getByRole('menuitem', { name: /^Change list/ })
  await expect(changeList).toContainText('Source list')

  await changeList.hover()
  await expect(flyout(page)).toBeVisible()
  await flyout(page).getByRole('menuitem', { name: 'Target list' }).click()
  await expect(menu).toHaveCount(0)
  await expect(flyout(page)).toHaveCount(0)
  await expect(tab).toContainText('Target list')
  // The tab's list is layout config: the layout is now unsaved.
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')
})

test('keyboard: ArrowRight on Change list opens the flyout, Escape closes it back to the menu', async ({ page }) => {
  await seedWorkspace(page, twoLists)
  await wsTab(page, 'listTab').click({ button: 'right' })
  const menu = tabMenu(page)
  // Focus starts on the first item (Edit list…); Change list is second.
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  const changeList = menu.getByRole('menuitem', { name: /^Change list/ })
  await expect(changeList).toBeFocused()

  await page.keyboard.press('ArrowRight')
  await expect(flyout(page)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(flyout(page)).toHaveCount(0)
  await expect(menu).toBeVisible()
  await expect(changeList).toBeFocused()
})

test('the add-tab list picker opened from a cell near the bottom stays inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await seedWorkspace(page, {
    listDefinitions: ['List A', 'List B', 'List C', 'List D', 'List E'].map((name) => ({ name })),
    layouts: [{
      name: 'Main',
      columns: [{
        id: 'col',
        cells: [
          { id: 'top', weight: 5, tabs: [{ id: 'notesTab', kind: 'notes' }] },
          { id: 'bottom', weight: 1, tabs: [{ id: 'eisTab', kind: 'eisenhower' }] },
        ],
      }],
    }],
  })

  const addBtn = wsCell(page, 'bottom').getByRole('button', { name: 'Add widget as tab' })
  const addBox = await addBtn.boundingBox()
  if (!addBox) throw new Error('no add button')
  // The button sits low enough that a picker hanging below it would overflow.
  expect(addBox.y).toBeGreaterThan(560)
  await addBtn.click()
  await page.getByRole('menu', { name: 'Add widget' }).getByRole('menuitem', { name: 'List' }).click()
  await expect(page.getByText('Add list', { exact: true })).toBeVisible()

  const popup = await page.evaluate(() => {
    const header = Array.from(document.querySelectorAll('div')).find((d) => d.textContent === 'Add list')
    let el: HTMLElement | null = header ?? null
    while (el && getComputedStyle(el).position !== 'fixed') el = el.parentElement
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { y: r.y, height: r.height }
  })
  expect(popup).not.toBeNull()
  expect(popup!.height).toBeGreaterThan(0)
  expect(popup!.y).toBeGreaterThanOrEqual(0)
  expect(popup!.y + popup!.height).toBeLessThanOrEqual(800)

  // Picking a list adds it as a tab of that cell.
  await page.getByRole('button', { name: /^List E/ }).click()
  await expect(wsCell(page, 'bottom').getByRole('tab', { name: 'List E' })).toHaveAttribute('aria-selected', 'true')
})

/** A tab in the right-hand of two columns (near the right edge) and one on the left. */
const twoColumns: WorkspaceSeed = {
  listDefinitions: [{ name: 'Source list' }, { name: 'Target list' }],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'left', cells: [{ id: 'leftCell', tabs: [{ id: 'eisTab', kind: 'eisenhower' }, { id: 'listTab', kind: 'lens', listDefIdx: 0 }] }] },
      { id: 'right', cells: [{ id: 'rightCell', tabs: [{ id: 'dashTab', kind: 'dashboard' }] }] },
    ],
  }],
}

async function rect(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

test('Shift+F10 on a tab opens its menu under the tab; type-ahead moves; Esc returns focus to the tab', async ({ page }) => {
  await seedWorkspace(page, twoLists)
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
  // Type-ahead: the next item starting with the key.
  await page.keyboard.press('c')
  await expect(menu.getByRole('menuitem', { name: /^Change list/ })).toBeFocused()
  await page.keyboard.press('n')
  await expect(menu.getByRole('menuitemradio', { name: 'Notes' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(tab).toBeFocused()
})

test('the tab menu opened at the window’s right edge stays inside the window', async ({ page }) => {
  await seedWorkspace(page, twoColumns)
  const vp = page.viewportSize()!
  // Right-click the right-hand tab at the window's right edge: the menu ends inside the window.
  const tab = wsTab(page, 'dashTab')
  const t = await rect(tab)
  await page.mouse.click(Math.min(t.x + t.width - 2, vp.width - 4), t.y + t.height / 2, { button: 'right' })
  const menu = tabMenu(page)
  await expect(menu).toBeVisible()
  const m = await rect(menu)
  expect(m.x + m.width).toBeLessThanOrEqual(vp.width - 8 + 0.5)
  expect(m.y + m.height).toBeLessThanOrEqual(vp.height - 8 + 0.5)
})

test('the Hot is › panel sits beside the menu, flipped to its left near the right edge; outside click closes both', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await seedWorkspace(page, twoColumns)
  const tab = wsTab(page, 'dashTab')
  const t = await rect(tab)
  await page.mouse.click(t.x + t.width - 4, t.y + t.height / 2, { button: 'right' })
  const menu = tabMenu(page)
  const hotIs = menu.getByRole('menuitem', { name: /Hot is/ })
  await hotIs.hover()
  const panel = page.getByRole('dialog', { name: 'Hot rule' })
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-shortcut-scope', 'none')
  const m = await rect(menu)
  const p = await rect(panel)
  const i = await rect(hotIs)
  // No room on the right: on the menu's left, top level with its item.
  expect(m.x + m.width + p.width).toBeGreaterThan(1100 - 8)
  expect(p.x + p.width).toBeLessThanOrEqual(m.x + 0.5)
  expect(Math.abs(p.y - i.y)).toBeLessThanOrEqual(1)
  // Hovering another plain item closes a panel that was only hovered open.
  await menu.getByRole('menuitem', { name: 'Customize dashboard…' }).hover()
  await expect(panel).toHaveCount(0)

  // Clicked open, it takes the focus and stays while the pointer crosses other items.
  await hotIs.click()
  await expect(panel).toBeVisible()
  await expect(panel.locator(':focus')).toHaveCount(1)
  await menu.getByRole('menuitem', { name: 'Customize dashboard…' }).hover()
  await expect(panel).toBeVisible()
  // A click outside the menu and its panel closes both.
  await page.mouse.click(20, 780)
  await expect(panel).toHaveCount(0)
  await expect(menu).toHaveCount(0)
})

test('the Eisenhower range submenu: → opens it on the current value beside its item; ← goes back', async ({ page }) => {
  await seedWorkspace(page, twoColumns)
  await wsTab(page, 'eisTab').click({ button: 'right' })
  const menu = tabMenu(page)
  const item = menu.getByRole('menuitem', { name: /Due date makes a task urgent/ })
  await expect(item).toBeFocused()
  await expect(item).toContainText('3 days')
  await page.keyboard.press('ArrowRight')
  const sub = page.getByRole('menu', { name: 'Due date makes a task urgent' })
  await expect(sub.getByRole('menuitemradio', { name: /3 days/ })).toBeFocused()
  await expect(sub).toContainText('Overdue tasks count too')
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
