import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace } from './fixtures/workspace'

/**
 * Reduced motion (the system setting): animations and transitions finish at
 * once, everywhere — one rule in the stylesheet — while the recent-task pill,
 * whose animation times how long it shows, keeps its five seconds without
 * sliding in. Real-browser because `prefers-reduced-motion` and computed
 * animation timing are.
 */

const SEED = {
  layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: 'notes', kind: 'notes' as const }] }] }] }],
}

/** Every element's (and pseudo-element's) transition and animation durations that are longer than 1 ms. */
async function slowTimings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const slow: string[] = []
    const long = (list: string) => list.split(', ').some((d) => parseFloat(d) > 0.001)
    for (const el of document.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo)
        const animated = cs.animationName !== 'none' && long(cs.animationDuration)
        const transitioned = long(cs.transitionDuration)
        if (animated || transitioned) slow.push(`${el.tagName}.${el.className}${pseudo ?? ''}`)
      }
    }
    return slow
  })
}

async function animation(el: Locator) {
  return el.evaluate((node) => {
    const cs = getComputedStyle(node)
    return { duration: cs.animationDuration, name: cs.animationName }
  })
}

async function addTask(page: Page, title: string) {
  await page.keyboard.press('Control+Space')
  const dialog = page.getByRole('dialog', { name: 'Quick add task' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('New task…').pressSequentially(title)
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
}

test('with reduced motion nothing animates, and the new-task pill still stays its five seconds', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seedWorkspace(page, SEED)
  expect(await slowTimings(page)).toEqual([])

  // An open dialog (the command palette fades in).
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  expect((await animation(palette)).duration).toBe('0.001s')
  expect(await slowTimings(page)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()

  await addTask(page, 'Still pill')
  const pill = page.getByRole('status').filter({ hasText: 'Still pill' })
  await expect(pill).toBeVisible()
  const pillAnimation = await animation(pill)
  expect(pillAnimation.duration).toBe('5.5s')
  expect(pillAnimation.name).toMatch(/appearLingerStill/)
})

test('without it, things animate as designed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await seedWorkspace(page, SEED)
  expect((await slowTimings(page)).length).toBeGreaterThan(0)
  await addTask(page, 'Moving pill')
  const pill = page.getByRole('status').filter({ hasText: 'Moving pill' })
  await expect(pill).toBeVisible()
  expect((await animation(pill)).name).toMatch(/appearLingerFade/)
})
