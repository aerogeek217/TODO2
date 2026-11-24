import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * The week load in a real browser: the meter in the Planner's top line
 * opens its popover under it, flipped above near the viewport's foot; Esc
 * closes it and hands the focus back to the meter; a widget too narrow for
 * it drops the meter before Reset plan's words. Week load… in the widget's
 * ⋯ menu opens the popover beside a Planner with no top line.
 */

const TASKS: NonNullable<WorkspaceSeed['tasks']> = [
  { title: 'Renew the domain', dueInDays: 0 },
  { title: 'Chase the invoice', followupInDays: 1 },
  { title: 'Write the brief', doInDays: 2 },
]

const planner = (page: Page) => page.locator('[data-planner="plan"]')
const meter = (page: Page) => planner(page).locator('[data-week-load-meter]')
const popover = (page: Page) => page.getByRole('dialog', { name: 'Week load' })

/** A Planner over `rows` of the height (the rest a notes cell above it), `cols` of the width (the rest a notes cell beside it). */
function layout({ top = 0, side = 0 }: { top?: number; side?: number }): WorkspaceSeed {
  const plan = { id: 'p', tabs: [{ id: 'plan', kind: 'planner' as const }] }
  const notes = (id: string) => ({ id, tabs: [{ id: `${id}-notes`, kind: 'notes' as const }] })
  const areas = top > 0 ? ['n', 'p'] : side > 0 ? ['p s'] : ['p']
  const cells = top > 0 ? [notes('n'), plan] : side > 0 ? [plan, notes('s')] : [plan]
  return {
    tasks: TASKS,
    layouts: [{
      name: 'Week',
      table: {
        areas,
        cells,
        ...(top > 0 ? { rows: [top, 1000] } : {}),
        ...(side > 0 ? { cols: [1000, side] } : {}),
      },
    }],
  }
}

test.describe('the week load meter and popover', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('opens under the meter, its right edge on the meter’s; Esc closes it and the focus is back on the meter', async ({ page }) => {
    await seedWorkspace(page, layout({}))
    await expect(meter(page)).toBeVisible()
    await expect(meter(page)).toHaveAccessibleName(/^This week: \d+ dates?, usual 0$/)
    await meter(page).click()
    await expect(popover(page)).toBeVisible()
    await expect(popover(page)).toBeFocused()
    await expect(meter(page)).toHaveAttribute('aria-expanded', 'true')
    const m = await box(meter(page))
    const p = await box(popover(page))
    // Below, past the caret's gap; lined up on the meter's right edge.
    expect(p.y).toBeGreaterThanOrEqual(m.y + m.height)
    expect(p.y - (m.y + m.height)).toBeLessThan(16)
    expect(Math.abs(p.x + p.width - (m.x + m.width))).toBeLessThan(1)
    await expect(popover(page).locator('[data-popover-caret="top"]')).toHaveCount(1)
    // Seven day columns, ~120px tall.
    const columns = popover(page).getByRole('img')
    await expect(columns).toHaveCount(7)
    const barsHeight = await columns.first().evaluate((day) => day.lastElementChild?.getBoundingClientRect().height)
    expect(barsHeight).toBe(120)
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)
    await expect(meter(page)).toBeFocused()
    await expect(meter(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('near the viewport’s foot it flips above the meter', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 })
    // The Planner in the bottom quarter: no room for the popover under its top line.
    await seedWorkspace(page, layout({ top: 3000 }))
    await expect(meter(page)).toBeVisible()
    const m = await box(meter(page))
    expect(700 - (m.y + m.height)).toBeLessThan(300)
    await meter(page).click()
    await expect(popover(page)).toBeVisible()
    const p = await box(popover(page))
    expect(p.y + p.height).toBeLessThanOrEqual(m.y)
    expect(p.y).toBeGreaterThanOrEqual(8)
    await expect(popover(page).locator('[data-popover-caret="bottom"]')).toHaveCount(1)
    // A press outside closes it.
    await page.mouse.click(40, 40)
    await expect(popover(page)).toHaveCount(0)
  })

  test('a narrow widget drops the meter before Reset plan’s words; Week load… in the ⋯ menu opens the popover beside it', async ({ page }) => {
    // The Planner ~520px wide: the meter gone, Reset plan's words still there.
    await seedWorkspace(page, layout({ side: 1770 }))
    const width = (await box(planner(page))).width
    expect(width).toBeGreaterThan(421)
    expect(width).toBeLessThanOrEqual(540)
    await expect(meter(page)).toBeHidden()
    const reset = planner(page).getByTestId('planner-reset')
    await expect(reset).toBeVisible()
    await expect(reset).toHaveText('Reset plan')
    // Nothing in the top line runs past its end.
    const overflows = await page.locator('[data-planner="plan"] [data-widget-top-line]').evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(overflows).toBe(false)

    await page.getByRole('region', { name: 'Planner cell' }).getByRole('button', { name: 'Cell options' }).click()
    await page.getByRole('menuitem', { name: 'Week load…' }).click()
    await expect(popover(page)).toBeVisible()
    await expect(popover(page).getByTestId('week-load-title')).toHaveText(/^This week · /)
    const w = await box(planner(page))
    const p = await box(popover(page))
    // Beside the widget, on its right.
    expect(p.x).toBeGreaterThanOrEqual(w.x + w.width)
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Planner cell' }).getByRole('button', { name: 'Cell options' })).toBeFocused()
  })

  test('a wider widget keeps the meter, with room to spare in its top line', async ({ page }) => {
    // The Planner ~600px wide.
    await seedWorkspace(page, layout({ side: 1400 }))
    const width = (await box(planner(page))).width
    expect(width).toBeGreaterThan(541)
    await expect(meter(page)).toBeVisible()
    const overflows = await page.locator('[data-planner="plan"] [data-widget-top-line]').evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(overflows).toBe(false)
  })
})
