import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { layoutTab, openLayoutTabMenu, seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * D19 · a hue per layout: picked with the name in the Rename dialog's
 * swatches and saved at once (the layout stays saved). The layout's
 * `--layout-hue` and the focus ring inside it take the hue, and it
 * survives a reload — with the layout's lens (D15) still picked.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Everything' }],
  tasks: [{ title: 'Plan the launch' }, { title: 'Ship it' }],
  lenses: [{ id: 'lens-plan', name: 'Plans', predicate: { searchText: 'plan' } }],
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] },
    { name: 'Other', columns: [] },
  ],
}

const area = (page: Page) => page.locator('[data-ws-area]')
const cssVar = (page: Page, sel: string, name: string) =>
  page.locator(sel).first().evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name)

test.use({ viewport: { width: 1280, height: 800 } })

test('a hued layout keeps its hue and its lens across a reload; the focus ring inside it reads the hue', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(area(page)).toHaveAttribute('data-layout-hue', 'none')

  // The lens, picked for the layout (view state).
  await page.locator('header').getByRole('button', { name: /^Lens:/ }).click()
  await page.getByRole('menu', { name: 'Lens for this layout' }).getByRole('menuitemradio', { name: /^Plans/ }).click()
  await expect.poll(() => rowTitles(wsListWidget(page, 't1'))).toEqual(['Plan the launch'])

  // The hue, with the name, in Rename.
  const menu = await openLayoutTabMenu(page, 'Main')
  await menu.getByRole('menuitem', { name: 'Rename…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Rename layout' })
  await expect(dialog.getByRole('radio', { name: 'None (the accent)' })).toBeChecked()
  await dialog.getByRole('radio', { name: 'Violet' }).check()
  await dialog.getByRole('button', { name: 'Rename' }).click()
  await expect(dialog).toBeHidden()

  await expect(area(page)).toHaveAttribute('data-layout-hue', 'violet')
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
  expect(await cssVar(page, '[data-ws-area]', '--layout-hue')).toBe('#a78bfa')
  // The focus ring inside the layout reads the hue (dark theme: #a78bfa).
  await page.keyboard.press('Shift')
  await wsListWidget(page, 't1').locator('[data-row-cell="checkbox"]').first().focus()
  await expect(wsListWidget(page, 't1').locator('[data-row-cell="checkbox"]').first()).toHaveCSS('box-shadow', /rgb\(167, 139, 250\) 0px 0px 0px 4px/)

  await page.reload()
  await expect(area(page)).toHaveAttribute('data-layout-hue', 'violet')
  await expect(layoutTab(page, 'Main')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('header').getByRole('button', { name: /^Lens: Plans/ })).toBeVisible()
  await expect.poll(() => rowTitles(wsListWidget(page, 't1'))).toEqual(['Plan the launch'])

  // None again: back to the accent.
  const again = await openLayoutTabMenu(page, 'Main')
  await again.getByRole('menuitem', { name: 'Rename…' }).click()
  await expect(page.getByRole('dialog', { name: 'Rename layout' }).getByRole('radio', { name: 'Violet' })).toBeChecked()
  await page.getByRole('dialog', { name: 'Rename layout' }).getByRole('radio', { name: 'None (the accent)' }).check()
  await page.getByRole('dialog', { name: 'Rename layout' }).getByRole('button', { name: 'Rename' }).click()
  await expect(area(page)).toHaveAttribute('data-layout-hue', 'none')
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the cells take the hue: the header tint and the focus ring', async ({ page }) => {
    await seedWorkspace(page, { ...SEED, layouts: [{ ...SEED.layouts[0]!, hue: 'rose' }] })
    const pager = page.locator('[data-ws-pager]')
    await expect(pager).toHaveAttribute('data-layout-hue', 'rose')
    // Dark theme: rose is #e07a9a.
    expect(await cssVar(page, '[data-ws-pager]', '--layout-hue')).toBe('#e07a9a')
    await expect(page.locator('[data-ws-cell-header]').first()).toHaveCSS('background-image', /linear-gradient\(color\(srgb 0\.878431 0\.478431 0\.603922 \/ 0\.07\)/)
    await page.keyboard.press('Shift')
    const tab = page.locator('[data-ws-cell-header] [role="tab"]').first()
    await tab.focus()
    await expect(tab).toHaveCSS('box-shadow', /rgb\(224, 122, 154\) 0px 0px 0px 2px inset/)
  })

  test('without a hue the header has no tint', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect(page.locator('[data-ws-pager]')).toHaveAttribute('data-layout-hue', 'none')
    await expect(page.locator('[data-ws-cell-header]').first()).toHaveCSS('background-image', 'linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0)), none')
  })
})
