import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A Number's stored colour as the theme draws it (J21, `utils/theme-color`):
 * the dark theme draws exactly the picked hex; the light theme draws v78's
 * follow-up colour as `--color-followup`'s light twin and any other pick
 * shaded by `--custom-color-shade`. Nothing stored changes.
 */

const SEED: WorkspaceSeed = {
  tasks: [{ title: 'Chase it', followupInDays: 0 }],
  layouts: [{ name: 'Main', table: {
    areas: ['f c', 'n n'],
    cells: [
      { id: 'f', tabs: [{ id: 'fu', kind: 'number', glance: { metric: 'followupDue' } }] },
      { id: 'c', tabs: [{ id: 'lime', kind: 'number', glance: { metric: 'open', color: '#c6e05a', litWhen: 'above', litAt: 0 } }] },
      { id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] },
    ],
  } }],
}

async function setTheme(page: Page, mode: 'dark' | 'light') {
  await page.evaluate(async (m) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
      useSettingsStore: { getState: () => { setThemeMode: (mode: 'dark' | 'light') => Promise<void> } }
    }
    await mod.useSettingsStore.getState().setThemeMode(m)
  }, mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
}

/** A Number's count's drawn colour as sRGB bytes (whatever form the computed colour takes). */
async function drawn(count: Locator): Promise<number[]> {
  return count.evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = getComputedStyle(el).color
    ctx.fillRect(0, 0, 1, 1)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3))
  })
}

const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= 1)
const count = (page: Page, id: string) => page.locator(`[data-number="${id}"] [data-testid="number-count"]`)

test('dark draws the picked hex; light draws the meaning’s light twin and shades a custom pick', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(page.locator(`[data-number="fu"]`)).toHaveAttribute('data-lit', 'true')
  await expect(page.locator(`[data-number="lime"]`)).toHaveAttribute('data-lit', 'true')
  await setTheme(page, 'dark')
  expect(await drawn(count(page, 'fu'))).toEqual([245, 200, 66])
  const lime = await drawn(count(page, 'lime'))
  expect(near(lime, [198, 224, 90]), `lime in dark: ${lime}`).toBe(true)

  await setTheme(page, 'light')
  // `--color-followup` in light (#826600).
  expect(await drawn(count(page, 'fu'))).toEqual([130, 102, 0])
  const shaded = await drawn(count(page, 'lime'))
  for (const [i, v] of shaded.entries()) expect(v, `lime channel ${i} in light`).toBeLessThan([198, 224, 90][i]! * 0.8)
})
