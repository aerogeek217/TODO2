import { expect, test, type Page } from '@playwright/test'
import { drag, seedWorkspace, wsCell, wsCard, type WsLayoutSeed, enterLayoutEdit } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'

/**
 * A cell of only Numbers draws them as one strip (flair P10): side by side,
 * evenly divided, at a fit row's 58px; a + adds one, a × closes one; a
 * Number drags within the strip to reorder, out to another cell, and in
 * from another; too narrow for 72px each, the strip wraps and its row grows.
 * Real-browser: layout, hover and drag.
 */

test.use({ viewport: { width: 1280, height: 800 } })

const number = (id: string, metric: string) => ({ id, kind: 'number' as const, glance: { metric } })

/** A strip of two Numbers over a notes cell and a lone Number. */
function seed(stripTabs = [number('num1', 'open'), number('num2', 'overdue')]): { layouts: WsLayoutSeed[] } {
  return {
    layouts: [{
      name: 'Main',
      table: {
        areas: ['s s', 'a n'],
        cells: [
          { id: 's', tabs: stripTabs },
          { id: 'a', tabs: [{ id: 'notesA', kind: 'notes' }] },
          { id: 'n', tabs: [number('num3', 'focus')] },
        ],
      },
    }],
  }
}

const slots = (page: Page) => wsCell(page, 's').locator('[data-number-slot]')
const order = (page: Page) => slots(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-number-slot')))
const widths = (page: Page) => slots(page).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))

test('two Numbers in one cell: one strip, evenly divided, no tab strip, at 58px', async ({ page }) => {
  await seedWorkspace(page, seed())
  await expect(slots(page)).toHaveCount(2)
  await expect(wsCell(page, 's').locator('[data-ws-cell-header]')).toHaveCount(0)
  const [a, b] = await widths(page)
  expect(Math.abs((a ?? 0) - (b ?? 0))).toBeLessThanOrEqual(1)
  expect(Math.round((await box(wsCell(page, 's'))).height)).toBe(58)
})

test('+ adds a Number, evenly divided again; a Number’s × closes it', async ({ page }) => {
  await seedWorkspace(page, seed())
  await wsCell(page, 's').hover()
  await wsCell(page, 's').getByRole('button', { name: 'Add number' }).click()
  await expect(slots(page)).toHaveCount(3)
  const w = await widths(page)
  expect(Math.max(...w) - Math.min(...w)).toBeLessThanOrEqual(1)
  const first = slots(page).first()
  await first.hover()
  await first.getByRole('button', { name: /^Remove/ }).click()
  await expect(slots(page)).toHaveCount(2)
  expect(await order(page)).not.toContain('num1')
})

test('a Number drags within the strip to reorder it', async ({ page }) => {
  await seedWorkspace(page, seed())
  await expect(slots(page)).toHaveCount(2)
  // Onto the second slot, past its middle (inside the strip's middle band, clear of its split zones).
  await drag(page, await pointIn(slots(page).first(), 0.3, 0.5), await pointIn(slots(page).nth(1), 0.6, 0.5))
  await expect.poll(() => order(page)).toEqual(['num2', 'num1'])
})

test('a Number drags to either end of a wide strip, its very edges included', async ({ page }) => {
  await seedWorkspace(page, seed([number('num1', 'open'), number('num2', 'overdue'), number('num4', 'dueToday'), number('num5', 'urgent')]))
  await expect(slots(page)).toHaveCount(4)
  // The last Number to the strip's left edge: where its side zone used to leave no room before the first.
  await drag(page, await pointIn(slots(page).nth(3), 0.5, 0.5), await pointIn(slots(page).first(), 0.02, 0.5))
  await expect.poll(() => order(page)).toEqual(['num5', 'num1', 'num2', 'num4'])
  // And the first back past the last one's middle, near the right edge.
  await drag(page, await pointIn(slots(page).first(), 0.5, 0.5), await pointIn(slots(page).nth(3), 0.95, 0.5))
  await expect.poll(() => order(page)).toEqual(['num1', 'num2', 'num4', 'num5'])
})

test('outside the layout edit mode a Number dragged out of the strip goes nowhere', async ({ page }) => {
  await seedWorkspace(page, seed())
  await drag(page, await pointIn(slots(page).nth(1), 0.5, 0.5), await pointIn(wsCell(page, 'a'), 0.5, 0.5))
  await expect(page.getByTestId('ws-drop-ghost')).toHaveCount(0)
  await expect.poll(() => order(page)).toEqual(['num1', 'num2'])
  await expect(wsCell(page, 'a').locator('[data-ws-tab="num1"], [data-ws-tab="num2"]')).toHaveCount(0)
})

test('in the layout edit mode a lone Number dragged into the strip joins it there', async ({ page }) => {
  await seedWorkspace(page, seed())
  await enterLayoutEdit(page)
  // A lone Number drags by its card (the whole cell), then between the strip's two slots.
  const grip = wsCard(page, 'n')
  await drag(page, await pointIn(grip), await pointIn(slots(page).nth(1), 0.3, 0.5))
  await expect.poll(() => order(page)).toEqual(['num1', 'num3', 'num2'])
})

test('in the layout edit mode a Number dragged out of the strip leaves it', async ({ page }) => {
  // In the layout edit mode (E3) a strip's Numbers take presses again: each drags as a tab, out of the strip.
  await seedWorkspace(page, seed())
  await enterLayoutEdit(page)
  // Onto the notes cell's middle (a tab there).
  await drag(page, await pointIn(slots(page).nth(1), 0.5, 0.5), await pointIn(wsCell(page, 'a'), 0.5, 0.5))
  await expect(wsCell(page, 'a').locator('[data-ws-tab="num2"]')).toHaveCount(1)
})

test('too narrow for 72px each: the strip wraps and its row grows', async ({ page }) => {
  // A desktop width (a phone lays the Numbers out two up instead), with more Numbers than fit at 72px each.
  await page.setViewportSize({ width: 800, height: 800 })
  const many = Array.from({ length: 14 }, (_, i) => number(`w${i}`, i % 2 ? 'open' : 'overdue'))
  await seedWorkspace(page, seed(many))
  await expect(slots(page)).toHaveCount(14)
  const tops = await slots(page).evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))])
  expect(tops.length).toBeGreaterThan(1)
  expect((await box(wsCell(page, 's'))).height).toBeGreaterThan(58)
})
