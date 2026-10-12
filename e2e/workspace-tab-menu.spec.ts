import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A list tab's menu (`WidgetKindMenu`): the "Change list" row opens an
 * in-place flyout by hover or ArrowRight, Escape closes the flyout back to the
 * menu, and a pick switches the tab's list. Plus the add-tab list picker,
 * which must stay inside the viewport when opened from a cell near the
 * bottom.
 *
 * JSDOM is unauthoritative here — both menus portal to `document.body` and
 * place / clamp themselves from `getBoundingClientRect`; hover intent and the
 * flyout's leave-delay timer are order-sensitive in a real browser.
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
  await flyout(page).getByRole('button', { name: 'Target list' }).click()
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
  // Focus starts on the first item (List options…); Change list is third.
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
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
