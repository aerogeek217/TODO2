import { expect, test, type Page } from '@playwright/test'
import { expectLayoutStored, openSettings, seedWorkspace, wsListWidget, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Widget feedback 11, 14, 15, J1, J17 (phase 3B): a layout's icon, picked in
 * Edit layout's Icon row (between Name and Hue) with the one icon picker —
 * the layout glyph until one is picked, a line icon, an emoji (muted: one
 * color, the hue on the open tab; or its own colors), No icon — saved with
 * Apply and kept across a reload; a status's emoji, picked in the status
 * editor's picker (its glyphs on the Icons tab), drawn on the task row.
 * The OS emoji panel is simulated with `insertText`.
 */

const SHOTS = process.env.SHOTS_DIR

const SEED: WorkspaceSeed = {
  statuses: ['Waiting'],
  listDefinitions: [{ name: 'Everything' }],
  tasks: [{ title: 'Call the vendor', status: 'Waiting' }],
  layouts: [
    { name: 'Home', hue: 'green', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] },
    { name: 'Launch', columns: [] },
    { name: 'Reading', icon: { kind: 'none' }, columns: [] },
  ],
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })
const tabIcon = (page: Page, name: string) => tab(page, name).locator('[data-layout-tab-icon]')

async function editLayout(page: Page, name: string) {
  await tab(page, name).click({ button: 'right' })
  await page.getByRole('menu', { name: /^Layout / }).getByRole('menuitem', { name: 'Edit…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit layout' })
  await expect(dialog).toBeVisible()
  return dialog
}

const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }

test.use({ viewport: { width: 1280, height: 800 } })

test('Edit layout’s Icon row: a line icon, a muted emoji in the hue, a color emoji, No icon; kept across a reload', async ({ page }) => {
  await seedWorkspace(page, SEED)
  // J1: never picked → the layout glyph; No icon → none.
  await expect(tabIcon(page, 'Home').locator('[data-app-icon="line"]')).toBeVisible()
  await expect(tabIcon(page, 'Reading')).toHaveCount(0)

  // A line icon.
  let dialog = await editLayout(page, 'Home')
  const iconButton = dialog.getByRole('button', { name: /^Icon:/ })
  await expect(iconButton).toHaveAccessibleName('Icon: Layout icon (the default). Change')
  await expect(dialog.getByText('The layout icon')).toBeVisible()
  await iconButton.click()
  let picker = page.getByRole('dialog', { name: 'Icon of “Home”' })
  await expect(picker.getByRole('button', { name: 'Layout', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await shot(page, 'edit-layout-picker')
  await picker.getByRole('button', { name: 'Flag', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(dialog.getByText('Icon · Flag')).toBeVisible()
  // Nothing written before Apply.
  await expect(tabIcon(page, 'Home').locator('[data-app-icon="line"]')).toBeVisible()
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog).toBeHidden()
  await expectLayoutStored(page)
  // On the open tab the icon takes the hue (green, dark theme #4fb286).
  await expect(tabIcon(page, 'Home').locator('[data-app-icon="line"]')).toHaveCSS('color', 'rgb(79, 178, 134)')

  // A muted emoji: the hue on the open tab.
  dialog = await editLayout(page, 'Home')
  await dialog.getByRole('button', { name: /^Icon:/ }).click()
  picker = page.getByRole('dialog', { name: 'Icon of “Home”' })
  await picker.getByRole('tab', { name: 'Emoji' }).click()
  await expect(picker.getByRole('textbox', { name: 'Emoji' })).toBeFocused()
  await page.keyboard.insertText('house🏠')
  await expect(picker.getByRole('radio', { name: 'Muted' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Emoji · Muted')).toBeVisible()
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expectLayoutStored(page)
  const homeEmoji = tabIcon(page, 'Home').locator('[data-app-icon="emoji-muted"]')
  await expect(homeEmoji).toContainText('🏠')
  await expect(homeEmoji).toHaveCSS('color', 'rgb(79, 178, 134)')

  // A color emoji on another layout; Recent offers the house.
  dialog = await editLayout(page, 'Launch')
  await dialog.getByRole('button', { name: /^Icon:/ }).click()
  picker = page.getByRole('dialog', { name: 'Icon of “Launch”' })
  await picker.getByRole('tab', { name: 'Emoji' }).click()
  await expect(picker.getByRole('button', { name: 'Emoji 🏠' })).toBeVisible()
  await picker.getByRole('radio', { name: 'Color' }).click()
  await page.keyboard.insertText('🚀')
  await page.keyboard.press('Escape')
  await expect(dialog.getByText('Emoji · Color')).toBeVisible()
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expectLayoutStored(page)
  await expect(tabIcon(page, 'Launch').locator('[data-app-icon="emoji-color"]')).toContainText('🚀')
  await shot(page, 'layout-tabs-dark')
  if (SHOTS) {
    // The desktop picker, where the bar folds the tabs into it.
    await page.setViewportSize({ width: 800, height: 800 })
    const folded = page.getByTestId('layout-picker')
    if (await folded.isVisible()) {
      await folded.click()
      await shot(page, 'layout-picker-menu')
      await page.keyboard.press('Escape')
    }
    await page.setViewportSize({ width: 1280, height: 800 })
  }

  // The phone's layout switcher shows them too.
  await page.setViewportSize({ width: 600, height: 800 })
  const pickerButton = page.getByTestId('layout-picker')
  await expect(pickerButton.locator('[data-app-icon="emoji-muted"]')).toContainText('🏠')
  await pickerButton.click()
  const sheet = page.getByRole('dialog', { name: 'Layouts' })
  await expect(sheet.getByRole('button', { name: 'Launch' }).locator('[data-app-icon="emoji-color"]')).toContainText('🚀')
  await expect(sheet.getByRole('button', { name: 'Reading' }).locator('[data-app-icon]')).toHaveCount(0)
  await shot(page, 'phone-layout-sheet')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1280, height: 800 })

  // A reload keeps them.
  await page.reload()
  await expect(tabIcon(page, 'Home').locator('[data-app-icon="emoji-muted"]')).toContainText('🏠')
  await expect(tabIcon(page, 'Launch').locator('[data-app-icon="emoji-color"]')).toContainText('🚀')

  // No icon.
  dialog = await editLayout(page, 'Home')
  await dialog.getByRole('button', { name: /^Icon:/ }).click()
  await page.getByRole('dialog', { name: 'Icon of “Home”' }).getByRole('button', { name: 'No icon' }).click()
  await expect(dialog.getByText('No icon', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expectLayoutStored(page)
  await expect(tabIcon(page, 'Home')).toHaveCount(0)
  await page.reload()
  await expect(tabIcon(page, 'Home')).toHaveCount(0)
})

test('a status’s emoji, picked in the status editor, shows on its task’s row', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const statusCell = wsListWidget(page, 't1').locator('[data-row-cell="status"]').first()
  await expect(statusCell.locator('svg')).toBeVisible()

  const settings = await openSettings(page, 'People, statuses & tags')
  await settings.getByRole('button', { name: 'Manage statuses…' }).click()
  await page.getByText('Waiting', { exact: true }).click()
  await page.getByRole('button', { name: /^Icon: Circle icon/ }).click()
  const picker = page.getByRole('dialog', { name: 'Icon of “Waiting”' })
  await expect(picker.getByRole('button', { name: 'Circle', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(picker.getByRole('button', { name: 'No icon' })).toHaveCount(0)
  await shot(page, 'status-editor-picker-icons')
  await picker.getByRole('tab', { name: 'Emoji' }).click()
  await page.keyboard.insertText('⏳')
  await shot(page, 'status-editor-picker-emoji')
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Waiting', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  await expect(statusCell.locator('[data-app-icon="emoji-muted"]')).toContainText('⏳')
  await statusCell.hover()
  await shot(page, 'list-row-emoji-status')
  await page.reload()
  await expect(wsListWidget(page, 't1').locator('[data-row-cell="status"]').first().locator('[data-app-icon="emoji-muted"]')).toContainText('⏳')
})

test('stored icons draw on the tabs in the light theme too (screenshots only)', async ({ page }) => {
  test.skip(!SHOTS, 'screenshots only')
  await seedWorkspace(page, {
    ...SEED,
    settings: { themeMode: 'light' },
    layouts: [
      { ...SEED.layouts[0]!, icon: { kind: 'emoji', emoji: '🏠' } },
      { name: 'Launch', icon: { kind: 'emoji', emoji: '🚀', show: 'color' }, columns: [] },
      { name: 'Follow-ups', icon: { kind: 'line', key: 'flag' }, columns: [] },
      { name: 'Reading', icon: { kind: 'none' }, columns: [] },
    ],
  })
  await expect(tabIcon(page, 'Home').locator('[data-app-icon="emoji-muted"]')).toContainText('🏠')
  await shot(page, 'layout-tabs-light')
})