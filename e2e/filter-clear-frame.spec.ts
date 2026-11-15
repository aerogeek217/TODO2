import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsListWidget, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { filterMenu, openFilterMenu } from './fixtures/filters'

/**
 * Feedback 2026-11-15: clearing the screen filter lagged — the click held
 * its frame while every widget mounted the tasks the filter hid (some
 * 300 ms on a seeded workspace, over a second in dev). The widgets take the
 * screen filter deferred (`stores/screen-filter`): the click's own frame
 * shows the top bar cleared, and the lists follow in a background render.
 */

const HIDDEN = 150

const SEED: WorkspaceSeed = {
  tags: ['vendor'],
  listDefinitions: [{ name: 'Everything', layoutIdx: 0 }],
  tasks: [
    { title: 'Vendor call', tags: ['vendor'] },
    { title: 'Vendor contract', tags: ['vendor'] },
    ...Array.from({ length: HIDDEN }, (_, i) => ({ title: `Other task ${i + 1}` })),
  ],
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] },
  ],
}

const tray = (page: Page) => page.locator('header').getByRole('group', { name: 'Screen filters — apply to every widget' })
const field = (page: Page) => tray(page).getByRole('textbox', { name: 'Filter tasks' })
const pills = (page: Page) => tray(page).getByTestId('top-bar-pills')
const rows = (page: Page) => wsListWidget(page, 't1').locator('[data-todo-id]')

/** What the page showed at the first animation frame after a click on `target`. */
interface FirstFrame {
  pills: number
  fieldValue: string
  rows: number
}

/**
 * Records, at the first animation frame after the next click on `target`,
 * the top bar's pills and field and the list's rows — what that frame paints.
 */
async function recordFirstFrame(target: Locator): Promise<() => Promise<FirstFrame>> {
  await target.evaluate((el) => {
    const w = window as unknown as { __firstFrame?: FirstFrame }
    delete w.__firstFrame
    el.addEventListener('click', () => {
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Filter tasks"]')
        w.__firstFrame = {
          pills: document.querySelectorAll('[data-top-bar-pill]').length,
          fieldValue: input?.value ?? '',
          rows: document.querySelectorAll('[data-list-widget="t1"] [data-todo-id]').length,
        }
      })
    }, { capture: true, once: true })
  })
  return async () => {
    await expect.poll(() => target.page().evaluate(() => (window as unknown as { __firstFrame?: FirstFrame }).__firstFrame != null)).toBe(true)
    return target.page().evaluate(() => (window as unknown as { __firstFrame: FirstFrame }).__firstFrame)
  }
}

async function filterToVendor(page: Page) {
  await field(page).click()
  await page.keyboard.type('#vendor', { delay: 10 })
  await page.keyboard.press('Enter')
  await expect(rows(page)).toHaveCount(2)
  await field(page).blur()
  await expect(pills(page)).toBeVisible()
}

test.use({ viewport: { width: 1440, height: 900 } })

test('the field’s × clears the top bar in the click’s own frame; the list fills in after it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(rows(page)).toHaveCount(HIDDEN + 2)
  await filterToVendor(page)

  const clear = tray(page).getByRole('button', { name: 'Clear all filters' })
  const firstFrame = await recordFirstFrame(clear)
  await clear.click()
  // The frame the click paints already has the field and pills cleared — and
  // doesn't wait for the list to mount the 150 tasks the filter hid.
  expect(await firstFrame()).toEqual({ pills: 0, fieldValue: '', rows: 2 })
  await expect(rows(page)).toHaveCount(HIDDEN + 2)
  await expect(clear).toHaveCount(0)
})

test('so does the funnel’s pause, and its resume', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(rows(page)).toHaveCount(HIDDEN + 2)
  await filterToVendor(page)

  const funnel = tray(page).getByRole('button', { name: 'Pause the filter' })
  const paused = await recordFirstFrame(funnel)
  await funnel.click()
  // The pills stay (struck through); the list shows every task after the frame.
  expect(await paused()).toEqual({ pills: 1, fieldValue: '#vendor', rows: 2 })
  await expect(funnel).toHaveAttribute('aria-pressed', 'true')
  await expect(rows(page)).toHaveCount(HIDDEN + 2)

  await funnel.click()
  await expect(funnel).toHaveAttribute('aria-pressed', 'false')
  await expect(rows(page)).toHaveCount(2)
})

test('so does the Filter menu’s Clear all filters', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(rows(page)).toHaveCount(HIDDEN + 2)
  await filterToVendor(page)

  await openFilterMenu(page)
  const clear = filterMenu(page).getByRole('button', { name: 'Clear all filters' })
  const firstFrame = await recordFirstFrame(clear)
  await clear.click()
  expect(await firstFrame()).toEqual({ pills: 0, fieldValue: '', rows: 2 })
  await expect(rows(page)).toHaveCount(HIDDEN + 2)
})
