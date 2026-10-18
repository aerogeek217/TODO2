import { expect, test, type Page } from '@playwright/test'
import { openSettings, seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * Settings › Keyboard shortcuts in a real browser: recording new keys (a
 * combo and a two-key sequence), the new keys working after a reload while
 * the old ones don't, the `?` list and the palette showing the new keys, a
 * refused clash (recording never fires an app shortcut), Esc cancelling a
 * recording without closing Settings, and Reset / Reset all.
 */

const seed: WorkspaceSeed = {
  listDefinitions: [{ name: 'Inbox' }],
  tasks: [{ title: 'A task' }],
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] },
  ],
}

const mac = process.platform === 'darwin'
/** A Mod combo's label as the app shows it on this machine. */
const modLabel = (rest: string, shift = false) => (mac ? `⌘${shift ? '⇧' : ''}${rest}` : `Ctrl+${shift ? 'Shift+' : ''}${rest}`)

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const keysOf = (page: Page, id: string) => page.locator(`[data-shortcut-id="${id}"] kbd`)

async function storedShortcuts(page: Page): Promise<string | undefined> {
  const rows = await readStore<{ key: string; value: string }>(page, 'settings')
  return rows.find((r) => r.key === 'keyboardShortcuts')?.value
}

async function record(page: Page, description: string, ...keys: string[]): Promise<void> {
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: `Change keys for ${description}` }).click()
  const capture = settings.getByRole('textbox', { name: `New keys for ${description}` })
  await expect(capture).toBeFocused()
  for (const key of keys) await page.keyboard.press(key)
}

test('new keys work after a reload, the old ones no longer do, and the lists show them', async ({ page }) => {
  await seedWorkspace(page, seed)
  await openSettings(page, 'Keyboard shortcuts')

  await record(page, 'Command Palette', 'ControlOrMeta+Shift+P')
  await expect(keysOf(page, 'command-palette')).toHaveText(modLabel('P', true))
  await record(page, 'Open Settings', 'g', 'o')
  await expect(keysOf(page, 'open-settings')).toHaveText('G then O')
  await expect.poll(() => storedShortcuts(page)).toBe('{"command-palette":"Mod-Shift-p","open-settings":"g o"}')

  await page.reload()
  await expect(page.locator('[data-ws-area]')).toBeVisible()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })

  // The old keys do nothing; the new ones work.
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.press('g')
  await page.keyboard.press('s')
  await expect(palette(page)).toBeHidden()
  await expect(settings).toBeHidden()
  await page.keyboard.press('ControlOrMeta+Shift+P')
  await expect(palette(page)).toBeVisible()
  // The palette's hint for Open Settings shows its new keys.
  await page.getByRole('combobox').fill('open settings')
  await expect(palette(page).getByRole('option', { name: /Open Settings/ })).toContainText('G then O')
  await page.keyboard.press('Escape')
  await expect(palette(page)).toBeHidden()

  await page.keyboard.press('g')
  await page.keyboard.press('o')
  await expect(settings).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  // The `?` list shows the new keys.
  await page.keyboard.press('?')
  const list = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
  await expect(list).toBeVisible()
  await expect(list.getByText('Command Palette', { exact: true }).locator('xpath=preceding-sibling::*[1]')).toHaveText(modLabel('P', true))
  await expect(list.getByText('Open Settings', { exact: true }).locator('xpath=preceding-sibling::*[1]')).toHaveText('G then O')
})

test('keys another shortcut uses are refused, and recording never fires a shortcut; Esc cancels only the recording', async ({ page }) => {
  await seedWorkspace(page, seed)
  const settings = await openSettings(page, 'Keyboard shortcuts')

  await record(page, 'Focus filters', 'ControlOrMeta+k')
  await expect(settings.getByRole('alert')).toHaveText(`${modLabel('K')} is already used by Command Palette.`)
  await expect(palette(page)).toBeHidden()
  // A browser key is refused too.
  await page.keyboard.press('ControlOrMeta+r')
  await expect(settings.getByRole('alert')).toHaveText(`${modLabel('R')} is used by the browser (Reload).`)
  // Still recording, nothing stored.
  await expect(settings.getByRole('textbox', { name: 'New keys for Focus filters' })).toBeFocused()
  expect(await storedShortcuts(page)).toBeUndefined()

  await page.keyboard.press('Escape')
  await expect(settings.getByRole('textbox', { name: 'New keys for Focus filters' })).toBeHidden()
  await expect(settings).toBeVisible()
  await expect(keysOf(page, 'focus-filters')).toHaveText('F')
  await expect(settings.getByRole('button', { name: 'Change keys for Focus filters' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
})

test('Reset puts one shortcut back; Reset all asks first and puts every one back', async ({ page }) => {
  await seedWorkspace(page, seed)
  const settings = await openSettings(page, 'Keyboard shortcuts')
  await record(page, 'Command Palette', 'ControlOrMeta+Shift+P')
  await record(page, 'Focus filters', 'n', 'Enter')
  await expect(keysOf(page, 'focus-filters')).toHaveText('N')

  await settings.getByRole('button', { name: `Reset Command Palette to ${modLabel('K')}` }).click()
  await expect(keysOf(page, 'command-palette')).toHaveText(modLabel('K'))
  await expect.poll(() => storedShortcuts(page)).toBe('{"focus-filters":"n"}')

  await settings.getByRole('button', { name: 'Reset all…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Reset all shortcuts?' })
  await confirm.getByRole('button', { name: 'Reset all' }).click()
  await expect(confirm).toBeHidden()
  await expect(keysOf(page, 'focus-filters')).toHaveText('F')
  await expect.poll(() => storedShortcuts(page)).toBeUndefined()
  await expect(settings).toBeVisible()

  // The default works again.
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette(page)).toBeVisible()
})
