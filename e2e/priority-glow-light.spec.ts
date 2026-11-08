import { expect, test, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, wsRow } from './fixtures/workspace'

/**
 * A priority's row glow is visible in the light theme too, and still quiet
 * (cr31 UI M5, the user's call: "Light theme could be a little more
 * visible"): read from the rendered pixels at the row's left edge against a
 * plain row's, beside the dark theme's (unchanged).
 */

const SEED = {
  listDefinitions: [{ name: 'Everything', sort: 'title' }],
  tasks: [
    { title: 'A plain task' },
    { title: 'B urgent task', urgent: true },
    { title: 'C important task', important: true },
    { title: 'D due today', dueInDays: 0 },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens' as const, listDefIdx: 0 }] })] }] }],
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

/** The rendered pixel 4 px in from a row's left edge, at its middle. */
async function edgePixels(page: Page, titles: readonly string[]): Promise<number[][]> {
  await page.mouse.move(5, 790)
  const points = await Promise.all(titles.map(async (title) => {
    const box = await taskRowByTitle(page, title).locator('[data-todo-id]').first().boundingBox()
    if (!box) throw new Error(`no row ${title}`)
    return { x: Math.round(box.x + 4), y: Math.round(box.y + box.height / 2) }
  }))
  const png = (await page.screenshot({ animations: 'disabled' })).toString('base64')
  return page.evaluate(async ({ b64, at }) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const g = canvas.getContext('2d')
    if (!g) throw new Error('no canvas')
    g.drawImage(img, 0, 0)
    return at.map(({ x, y }) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)))
  }, { b64: png, at: points })
}

/** The largest channel difference between two pixels (0–255). */
const delta = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? 0))))

async function glowDeltas(page: Page) {
  const [plain = [], urgent = [], important = [], dueToday = []] = await edgePixels(page, ['A plain task', 'B urgent task', 'C important task', 'D due today'])
  return { urgent: delta(urgent, plain), important: delta(important, plain), dueToday: delta(dueToday, plain) }
}

test.use({ viewport: { width: 1200, height: 800 } })

test('the light theme’s glow shows as the dark theme’s does, and stays quiet', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(taskRowByTitle(page, 'D due today')).toBeVisible()
  await setTheme(page, 'dark')
  const dark = await glowDeltas(page)
  await setTheme(page, 'light')
  const light = await glowDeltas(page)

  // The dark theme's glow, as it was (11 %).
  expect(dark.urgent).toBeGreaterThanOrEqual(15)
  // Light: clearly there — at least nine tenths of the dark theme's — but quiet.
  expect(light.urgent).toBeGreaterThanOrEqual(dark.urgent * 0.9)
  expect(light.important).toBeGreaterThanOrEqual(dark.important * 0.9)
  expect(light.urgent).toBeLessThanOrEqual(40)
  expect(light.important).toBeLessThanOrEqual(40)
  // Urgent only by its due date glows less, and still shows.
  expect(light.dueToday).toBeLessThan(light.urgent)
  expect(light.dueToday).toBeGreaterThanOrEqual(8)
})
