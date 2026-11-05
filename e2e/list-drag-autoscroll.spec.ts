import { expect, test } from '@playwright/test'
import { seedTaskList } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * A row held still at the bottom of a list that scrolls under it (dnd-kit's
 * auto-scroll) lands where the pointer is once it has scrolled: the drop
 * slot follows the scroll, not only the pointer's moves (cr31 W7).
 */

test.use({ viewport: { width: 1000, height: 600 } })

const TASKS = Array.from({ length: 40 }, (_, n) => ({ title: `Task ${n + 1}` }))

test('a row held still while the list auto-scrolls: the drop slot stays under the pointer', async ({ page }) => {
  const list = await seedTaskList(page, { tasks: TASKS })
  const row = list.locator('[data-row-key]', { has: page.locator('span[data-task-title="Task 2"]') })
  const r = await box(row)
  const lb = await box(list)
  await page.mouse.move(r.x + 10, r.y + r.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.x + 10, r.y + r.height / 2 + 8, { steps: 2 })
  const y = lb.y + lb.height - 6
  await page.mouse.move(r.x + 10, y, { steps: 12 })
  // Held still until the list has scrolled to its end.
  const scrolledToEnd = () => list.evaluate((el) => {
    const s = Array.from(el.querySelectorAll<HTMLElement>('*')).find((e) => e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflowY !== 'visible')
    return s ? s.scrollHeight - s.clientHeight - s.scrollTop < 2 : false
  })
  await expect.poll(scrolledToEnd, { timeout: 10000 }).toBe(true)
  // The slot is where the pointer is: in view, near the list's bottom.
  const slot = list.locator('[data-drop-slot]')
  await expect(slot).toHaveCount(1)
  await expect.poll(async () => {
    const s = await box(slot)
    return s.y + s.height > lb.y + lb.height / 2 && s.y < lb.y + lb.height
  }).toBe(true)
  await page.mouse.up()
})
