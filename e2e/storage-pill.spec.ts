import { expect, test, type Page } from '@playwright/test'

/**
 * The storage pill carries every sync warning — no strip anywhere: its
 * colour per state (amber = waiting for you, red = something failed), the
 * count badge, the narrow-window look and the popover's place. The states
 * are set on the app's own stores (the paths that cause them in real use are
 * covered in `launch-permission`, `file-sync-conflict` and `backup-*`).
 */

type Store = { setState: (s: Record<string, unknown>) => void; getState: () => Record<string, unknown> }

async function setStorage(page: Page, fileStorage: Record<string, unknown>, snapshotWarning: string | null = null) {
  await page.evaluate(async ({ fileStorage, snapshotWarning }) => {
    const fs = (await import(/* @vite-ignore */ '/src/services/file-storage-store.ts' as string)) as { useFileStorageStore: Store }
    const ops = (await import(/* @vite-ignore */ '/src/stores/file-ops-store.ts' as string)) as { useFileOpsStore: Store }
    fs.useFileStorageStore.setState(fileStorage)
    ops.useFileOpsStore.setState({ snapshotWarning })
  }, { fileStorage, snapshotWarning })
}

async function setTheme(page: Page, mode: 'light' | 'dark') {
  await page.evaluate(async (mode) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as { useSettingsStore: { getState: () => { setThemeMode: (m: string) => Promise<void> } } }
    await mod.useSettingsStore.getState().setThemeMode(mode)
  }, mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
}

const PAUSED = { reason: 'conflict-cancelled', message: 'File sync paused — this browser and todo2.json have different data. Choose which version to keep.' }
const STATES = {
  permission: { fileStorage: { fileName: 'todo2.json', needsPermission: true, paused: null, error: null }, text: 'Permission needed', tone: 'amber' },
  paused: { fileStorage: { fileName: 'todo2.json', needsPermission: false, paused: PAUSED, error: null }, text: 'Sync paused', tone: 'amber' },
  error: { fileStorage: { fileName: 'todo2.json', isConnected: true, needsPermission: false, paused: null, error: 'Failed to save to file' }, text: 'Sync error', tone: 'red' },
} as const

const textColour = (page: Page) => page.getByTestId('storage-pill').evaluate((el) => getComputedStyle(el).color)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
})

test('every warning state in the pill, amber or red, with its icon; never a strip under the top bar', async ({ page }) => {
  const pill = page.getByTestId('storage-pill')
  const area = page.locator('[data-ws-area]')
  const topBarBottom = async () => {
    const bar = (await page.locator('header').first().boundingBox())!
    return bar.y + bar.height
  }
  const areaTop = async () => (await area.boundingBox())!.y
  const restingTop = await areaTop()
  expect(restingTop).toBeLessThanOrEqual((await topBarBottom()) + 1)

  for (const [kind, s] of Object.entries(STATES)) {
    await setStorage(page, s.fileStorage)
    await expect(pill, kind).toHaveAttribute('data-state', kind)
    await expect(pill).toHaveText(s.text)
    await expect(pill.locator('svg')).toHaveCount(1)
    // Dark theme: amber text = warning (#f5a623), red = danger (#ee7d77).
    expect(await textColour(page), kind).toBe(s.tone === 'amber' ? 'rgb(245, 166, 35)' : 'rgb(238, 125, 119)')
    // No strip: the workspace stays right under the top bar.
    expect(await areaTop()).toBe(restingTop)
    await expect(page.getByRole('alert')).toHaveCount(0)
  }

  await setStorage(page, { isConnected: true, fileName: 'todo2.json', needsPermission: false, paused: null, error: null }, 'Backup snapshot (auto) would not restore: 2 tasks have an unreadable date')
  await expect(pill).toHaveAttribute('data-state', 'backup')
  await expect(pill).toHaveText('Backup warning')
  expect(await textColour(page)).toBe('rgb(245, 166, 35)')
  expect(await areaTop()).toBe(restingTop)
})

test('two warnings: the most urgent leads, a count badge, both in the popover — right-aligned under the pill', async ({ page }) => {
  await setStorage(page, STATES.paused.fileStorage, 'No backup was taken before importing the file — the backup could not be saved.')
  const pill = page.getByRole('button', { name: 'Storage: Sync paused, 2 warnings' })
  await expect(pill).toBeVisible()
  await expect(pill).toHaveText('Sync paused2')
  await pill.click()
  const popover = page.getByRole('dialog', { name: 'Sync paused' })
  await expect(popover.locator('[data-warning]')).toHaveCount(2)
  await expect(popover.locator('h3')).toHaveText(['Sync paused', 'Backup warning'])
  await expect(popover.getByRole('button', { name: 'File storage settings…' })).toBeVisible()
  const p = (await pill.boundingBox())!
  const b = (await popover.boundingBox())!
  expect(Math.abs(b.x + b.width - (p.x + p.width))).toBeLessThanOrEqual(1)
  expect(Math.round(b.y - (p.y + p.height))).toBe(8)
  expect(Math.round(b.width)).toBe(340)
  // Dismiss the backup warning: its section goes, the popover stays on the other.
  await popover.getByRole('button', { name: 'Dismiss' }).click()
  await expect(popover.locator('[data-warning]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Storage: Sync paused' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
})

test('light theme: darker amber and red text that keep their contrast', async ({ page }) => {
  await setTheme(page, 'light')
  await setStorage(page, STATES.permission.fileStorage)
  await expect(page.getByTestId('storage-pill')).toHaveAttribute('data-state', 'permission')
  expect(await textColour(page)).toBe('rgb(148, 96, 10)')
  await setStorage(page, STATES.error.fileStorage)
  await expect(page.getByTestId('storage-pill')).toHaveAttribute('data-state', 'error')
  expect(await textColour(page)).toBe('rgb(184, 53, 47)')
})

test('narrow window: Local only shrinks to its dot, a warning keeps its label', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  const pill = page.getByTestId('storage-pill')
  await expect(pill).toHaveAttribute('data-state', 'local')
  expect(Math.round((await pill.boundingBox())!.width)).toBe(24)
  await setStorage(page, STATES.permission.fileStorage)
  await expect(pill).toHaveAttribute('data-state', 'permission')
  await expect(pill.getByText('Permission needed')).toBeVisible()
  expect((await pill.boundingBox())!.width).toBeGreaterThan(100)
})

test('keyboard: the popover takes the focus, keeps Tab inside, and gives the focus back to the pill', async ({ page }) => {
  // A warning with several actions (Retry, Keep browser data…, Dismiss, File storage settings…).
  await setStorage(page, STATES.paused.fileStorage)
  const pill = page.getByTestId('storage-pill')
  await pill.focus()
  await page.keyboard.press('Enter')
  const popover = page.getByTestId('storage-popover')
  await expect(popover).toBeVisible()
  const inside = () => popover.evaluate((el) => el.contains(document.activeElement))
  const focusedName = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
  await expect.poll(inside).toBe(true)
  const first = await focusedName()

  // Tab through every control and around: never out of the popover.
  const count = await popover.locator('button:visible').count()
  expect(count).toBeGreaterThan(1)
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Tab')
    expect(await inside()).toBe(true)
  }
  expect(await focusedName()).toBe(first)
  await page.keyboard.press('Shift+Tab')
  expect(await inside()).toBe(true)
  expect(await focusedName()).not.toBe(first)

  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(pill).toBeFocused()
})
