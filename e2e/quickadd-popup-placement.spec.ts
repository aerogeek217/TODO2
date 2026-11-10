import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedTaskList } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * Quick Add's `@ # /` popup is placed by `usePopoverAnchor` at the caret
 * column, under the whole bar: 4px below the bar's surface at the trigger
 * character (its chips and Details button uncovered), kept inside the window,
 * and re-placed when the window resizes. Caret-relative
 * placement reads real layout, so a real browser is the authoritative surface.
 */

const MARGIN = 8

const surfaceOf = (page: Page) => page.getByRole('dialog', { name: 'Quick add task' })

async function openQuickAdd(page: Page): Promise<Locator> {
  await seedTaskList(page, { people: [{ name: 'Alice Smith', initials: 'AS' }] })
  await expect(page.getByRole('button', { name: 'People filter' })).toBeVisible()
  await page.keyboard.press('Control+Space')
  const input = page.getByRole('dialog', { name: 'Quick add task' }).getByPlaceholder('New task…')
  await expect(input).toBeFocused()
  return input
}

/** The viewport x of the input's character at `index` (a range over its value in a mirror). */
async function caretX(input: Locator, index: number): Promise<number> {
  return input.evaluate((el, i) => {
    const inp = el as HTMLInputElement
    const style = getComputedStyle(inp)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const r = inp.getBoundingClientRect()
    return r.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) + ctx.measureText(inp.value.slice(0, i)).width - inp.scrollLeft
  }, index)
}

test('opens 4px below the bar at the trigger character, clear of its Details button', async ({ page }) => {
  const input = await openQuickAdd(page)
  await page.keyboard.type('Call about the invoice @al')
  const popup = page.getByRole('listbox', { name: 'People' })
  await expect(popup).toBeVisible()
  const s = await box(surfaceOf(page))
  const p = await box(popup)
  const at = await caretX(input, 'Call about the invoice '.length)
  expect(Math.abs(p.x - at)).toBeLessThan(3)
  expect(Math.round(p.y - (s.y + s.height))).toBe(4)
  // The footer's Details button is uncovered: the popup starts below it.
  const details = await box(surfaceOf(page).getByRole('button', { name: /Details/ }))
  expect(p.y).toBeGreaterThan(details.y + details.height)
})

test('a `/` command popup also leaves the Details button uncovered', async ({ page }) => {
  await openQuickAdd(page)
  await page.keyboard.type('Ship the release notes /')
  const popup = page.getByRole('listbox')
  await expect(popup).toBeVisible()
  const details = await box(surfaceOf(page).getByRole('button', { name: /Details/ }))
  const p = await box(popup)
  const overlaps = p.x < details.x + details.width && details.x < p.x + p.width
    && p.y < details.y + details.height && details.y < p.y + p.height
  expect(overlaps).toBe(false)
  // A click on Details reaches it (nothing over it).
  await expect(surfaceOf(page).getByRole('button', { name: /Details/ })).toBeEnabled()
})

test('a long title keeps it inside the window, under the input; a resize re-places it', async ({ page }) => {
  const input = await openQuickAdd(page)
  // Narrowed after the load signal (the People filter folds away below 1280px).
  await page.setViewportSize({ width: 900, height: 700 })
  await expect.poll(async () => Math.round((await box(input)).x + (await box(input)).width)).toBeLessThan(900)
  await page.keyboard.type('A long task title that runs well along the field and then keeps on going for a while @al')
  const popup = page.getByRole('listbox', { name: 'People' })
  await expect(popup).toBeVisible()
  const i = await box(input)
  const p = await box(popup)
  expect(p.x).toBeGreaterThanOrEqual(i.x)
  expect(p.x + p.width).toBeLessThanOrEqual(900 - MARGIN)
  const s = await box(surfaceOf(page))
  expect(Math.round(p.y - (s.y + s.height))).toBe(4)

  // The bar is centred: a wider window moves the input, and the popup follows it.
  await page.setViewportSize({ width: 1300, height: 700 })
  await expect.poll(async () => Math.round((await box(input)).x)).not.toBe(Math.round(i.x))
  await expect(popup).toBeVisible()
  const moved = Math.round((await box(input)).x - i.x)
  await expect.poll(async () => Math.round((await box(popup)).x - p.x)).toBe(moved)
})

test('a title too long for one line wraps, the field growing; the popup opens at its token on the wrapped line', async ({ page }) => {
  const input = await openQuickAdd(page)
  await page.setViewportSize({ width: 900, height: 700 })
  const oneLine = (await box(input)).height
  await page.keyboard.type('Prepare the quarterly planning review deck with the budget numbers and the hiring plan for the offsite, then share it with @al')
  const popup = page.getByRole('listbox', { name: 'People' })
  await expect(popup).toBeVisible()
  // Wrapped, never scrolled sideways: every word shows.
  await expect.poll(async () => (await box(input)).height).toBeGreaterThan(oneLine * 2 - 1)
  expect(await input.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  // The `@` sits on a later line, in from the field's left: the popup is at it, under the bar.
  const at = await page.getByTestId('quickadd-mirror').evaluate((mirror, text) => {
    const node = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT)
    let seen = 0
    for (let n = node.nextNode(); n; n = node.nextNode()) {
      const value = n.textContent ?? ''
      const i = value.indexOf('@al')
      if (i >= 0) {
        const range = document.createRange()
        range.setStart(n, i)
        range.setEnd(n, i + 1)
        const r = range.getBoundingClientRect()
        return { x: r.left, y: r.top, before: seen + i === text.indexOf('@al') }
      }
      seen += value.length
    }
    throw new Error('no @al in the mirror')
  }, await input.inputValue())
  const i = await box(input)
  expect(at.before).toBe(true)
  expect(at.y).toBeGreaterThan(i.y + oneLine - 1)
  const p = await box(popup)
  expect(Math.abs(p.x - at.x)).toBeLessThan(2)
  const s = await box(surfaceOf(page))
  expect(Math.round(p.y - (s.y + s.height))).toBe(4)
  // ⏎ picks the person; the title stays one line of text however it wraps.
  await page.keyboard.press('Enter')
  expect(await input.inputValue()).not.toContain('\n')
})
