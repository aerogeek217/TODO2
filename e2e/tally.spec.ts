import { expect, test, type Page } from '@playwright/test'
import { seedTaskList } from './fixtures/workspace'
import { taskRowByTitle } from './fixtures/seed'
import { filterField } from './fixtures/filters'

/**
 * The top bar's tally of tasks finished today (flair P3): marks in the free
 * stretch between the filter tray and the right zone — never over either,
 * whatever the width or the chips —, one more when a task is completed, and
 * the bar folds the same with it on or off (an absolute layer).
 */

const done = (title: string) => ({ title, completedInDays: 0 })
const TASKS = [
  { title: 'Open one', people: ['Aisha Rahman'] },
  { title: 'Open two' },
  ...Array.from({ length: 7 }, (_, i) => done(`Done ${i + 1}`)),
]

/** The tally's, the tray's and the right zone's edges, and the bar's fold. */
const geometry = (page: Page) => page.locator('header').evaluate((bar) => {
  const tally = bar.querySelector('[data-tally]')?.getBoundingClientRect()
  const tray = bar.querySelector('[data-filter-row]')!.getBoundingClientRect()
  const right = [...bar.querySelectorAll('[data-fold-part="spring"] > *')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0)
  return {
    fold: bar.dataset.fold,
    tally: tally ? { left: tally.left, right: tally.right, top: tally.top, bottom: tally.bottom } : null,
    trayRight: tray.right,
    rightLeft: Math.min(...right.map((r) => r.left)),
    bar: { top: bar.getBoundingClientRect().top, bottom: bar.getBoundingClientRect().bottom },
  }
})

/** Two animation frames: the tally measures on the next one. */
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

function expectClear(g: Awaited<ReturnType<typeof geometry>>, at: string) {
  if (!g.tally) return
  expect(g.tally.left - g.trayRight, `clear of the tray at ${at}`).toBeGreaterThanOrEqual(9)
  expect(g.rightLeft - g.tally.right, `clear of the right zone at ${at}`).toBeGreaterThanOrEqual(9)
  expect(g.tally.top, `inside the bar at ${at}`).toBeGreaterThanOrEqual(g.bar.top)
  expect(g.tally.bottom, `inside the bar at ${at}`).toBeLessThanOrEqual(g.bar.bottom)
}

test('the marks sit between the tray and the right zone at every width, with chips too', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 800 })
  await seedTaskList(page, { people: ['Aisha Rahman'], tasks: TASKS })
  await expect(page.getByRole('img', { name: '7 done today' })).toBeVisible()
  expect(await page.locator('[data-tally] path').count()).toBe(7)
  for (const width of [1600, 1280, 1100, 900]) {
    await page.setViewportSize({ width, height: 800 })
    await frames(page)
    expectClear(await geometry(page), `${width}px`)
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await filterField(page).click()
  await page.keyboard.type('@Aisha ')
  await page.keyboard.press('Enter')
  await frames(page)
  expectClear(await geometry(page), '1280px with a chip')
})

test('completing a task adds a mark; the tooltip says the count', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 800 })
  await seedTaskList(page, { tasks: TASKS })
  await expect(page.locator('[data-tally] path')).toHaveCount(7)
  await taskRowByTitle(page, 'Open two').getByRole('checkbox', { name: 'Mark complete' }).click()
  await expect(page.getByRole('img', { name: '8 done today' })).toBeVisible()
  await expect(page.locator('[data-tally] path')).toHaveCount(8)
  await page.locator('[data-tally]').hover()
  await expect(page.getByRole('tooltip')).toHaveText('8 done today')
})

test('the bar folds the same with the tally on and off', async ({ page }) => {
  const folds = async (settings: Record<string, string | null>) => {
    await page.setViewportSize({ width: 1600, height: 800 })
    await seedTaskList(page, { tasks: TASKS, settings })
    const out: Array<string | undefined> = []
    for (const width of [1280, 1000, 820]) {
      await page.setViewportSize({ width, height: 800 })
      await frames(page)
      out.push((await geometry(page)).fold)
    }
    return out
  }
  const on = await folds({})
  const off = await folds({ tallyMarks: 'false' })
  await expect(page.locator('[data-tally]')).toHaveCount(0)
  expect(on).toEqual(off)
})
