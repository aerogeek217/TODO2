import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsRow, wsListWidget } from './fixtures/workspace'

/**
 * A new task flies home (flair P4): made while a list on screen shows it, a
 * ghost of its title flies to its row and no recent-task pill shows; made
 * while no list on screen shows it, or under reduced motion, the pill shows
 * as before. Real-browser: hit testing, the Web Animations and the timing of
 * the row's first paint.
 */

/** A list of every open task beside a notes widget; or only notes. */
function seed(withList: boolean) {
  const notes = { id: 'n', rows: [wsRow({ id: 'notes-cell', tabs: [{ id: 'notes', kind: 'notes' as const }] })] }
  return {
    listDefinitions: [{ name: 'Everything' }],
    tasks: [{ title: 'Already here' }],
    layouts: [{
      name: 'Main',
      columns: withList
        ? [{ id: 'w', weight: 700, rows: [wsRow({ id: 'cell', tabs: [{ id: 'tab', kind: 'lens' as const, listDefIdx: 0 }] })] }, { ...notes, weight: 580 }]
        : [notes],
    }],
  }
}

/** Records whether a flight ghost or the pill appears, from before the task is made. */
async function watchArrival(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { __arrival: string[] }).__arrival = seen
    new MutationObserver(() => {
      if (document.querySelector('[data-task-flight]')) seen.push('ghost')
      if (document.querySelector('[data-no-flight]')) seen.push('pill')
    }).observe(document.body, { childList: true, subtree: true })
  })
}

const arrival = (page: Page) => page.evaluate(() => [...new Set((window as unknown as { __arrival: string[] }).__arrival)])

async function quickAdd(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New task' }).click()
  const dialog = page.getByRole('dialog', { name: 'Quick add task' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('New task…').fill(title)
  await watchArrival(page)
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
}

test('a list on screen shows the new task: it flies to its row, and no pill shows', async ({ page }) => {
  await seedWorkspace(page, seed(true))
  const list = wsListWidget(page, 'tab')
  await expect(list.locator('[data-task-title="Already here"]')).toBeVisible()
  await quickAdd(page, 'Flown home')
  await expect(list.locator('[data-task-title="Flown home"]')).toBeVisible()
  await expect.poll(() => arrival(page)).toContain('ghost')
  expect(await arrival(page)).not.toContain('pill')
  // The ghost is gone once it lands; the row ends at its full height.
  await expect(page.locator('[data-task-flight]')).toHaveCount(0)
  const row = list.locator('[data-todo-id]').filter({ has: page.locator('[data-task-title="Flown home"]') })
  await expect.poll(async () => Math.round((await row.boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(28)
})

test('no list on screen shows it: the pill shows, as before', async ({ page }) => {
  await seedWorkspace(page, seed(false))
  await quickAdd(page, 'Nowhere to go')
  await expect(page.locator('[data-no-flight]')).toBeVisible()
  expect(await arrival(page)).not.toContain('ghost')
})

test('reduced motion: the pill shows even when a list shows the task', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seedWorkspace(page, seed(true))
  await expect(wsListWidget(page, 'tab').locator('[data-task-title="Already here"]')).toBeVisible()
  await quickAdd(page, 'Stays put')
  await expect(page.locator('[data-no-flight]')).toBeVisible()
  expect(await arrival(page)).not.toContain('ghost')
})
