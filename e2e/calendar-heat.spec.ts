import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * D18 calendar heat map in a real browser: with Titles off (the default) a
 * month day is tinted by its entry count — the step's `--cal-heat-*` fill —
 * with the count in its corner; hover names the count, a click opens the day
 * popover. The Titles toggle brings the bars back and is view state: it
 * survives a reload and never makes the layout unsaved.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Everything' }],
  tasks: [
    ...['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((title) => ({ title, dueInDays: 2 })),
    { title: 'Tomorrow', dueInDays: 1 },
    { title: 'Late', dueInDays: -1 },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'calTab', kind: 'calendar' }] }] }] }],
}

const calendar = (page: Page) => page.locator('[data-calendar-widget="calTab"]')

/** The `data-day` cell of today + `n` days (the page's time zone). */
async function day(page: Page, n: number): Promise<Locator> {
  const key = await page.evaluate((n) => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, n)
  return calendar(page).locator(`[data-day="${key}"]`)
}

/** The computed colour of `value` (a CSS colour or `var(…)`) as `property` on a probe inside the calendar. */
async function resolved(page: Page, property: 'backgroundColor' | 'color', value: string): Promise<string> {
  return calendar(page).evaluate((root, [property, value]) => {
    const probe = document.createElement('span')
    probe.style[property as 'color'] = value
    root.appendChild(probe)
    const out = getComputedStyle(probe)[property as 'color']
    probe.remove()
    return out
  }, [property, value] as const)
}

const bg = (cell: Locator) => cell.evaluate((el) => getComputedStyle(el).backgroundColor)

test('titles off: the month is a heat map; Titles brings the bars back and survives a reload', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(calendar(page)).toHaveAttribute('data-mode', 'month')
  await expect(calendar(page).locator('[data-cal-grid="month"]')).toHaveAttribute('data-heat-map', 'true')
  await expect(calendar(page).locator('[data-cal-entry]')).toHaveCount(0)

  // Six due in two days: the top step, its count in the corner, the step's fill.
  const busy = await day(page, 2)
  await expect(busy).toHaveAttribute('data-heat', '3')
  await expect(busy).toHaveAccessibleName(/, 6 due$/)
  await expect(busy).toContainText('6')
  expect(await bg(busy)).toBe(await resolved(page, 'backgroundColor', 'var(--cal-heat-due-3)'))
  const quiet = await day(page, 1)
  await expect(quiet).toHaveAttribute('data-heat', '1')
  expect(await bg(quiet)).toBe(await resolved(page, 'backgroundColor', 'var(--cal-heat-due-1)'))
  await expect(calendar(page).locator('[data-cal-legend]')).toContainText('Due and follow-ups')

  // Yesterday is still open: its number in the late colour (`--cal-late-due`, 4.5:1 on every step) (when it's on the grid).
  const late = await day(page, -1)
  if (await late.count()) {
    await expect(late).toHaveAttribute('data-late', 'due')
    const number = late.locator('div').first()
    expect(await number.evaluate((el) => getComputedStyle(el).color)).toBe(await resolved(page, 'color', 'var(--cal-late-due)'))
  }

  // Hover names the count; a click opens the day with its tasks.
  await busy.hover()
  await expect(page.getByRole('tooltip')).toHaveText('6 due')
  await busy.click()
  const popover = page.getByTestId('calendar-day-popover')
  await expect(popover.locator('[data-cal-entry]')).toHaveCount(6)
  await expect(busy).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)

  // Titles on: the bars; view state, so the layout stays saved and a reload keeps it.
  const titles = calendar(page).getByRole('button', { name: 'Titles' })
  await expect(titles).toHaveAttribute('aria-pressed', 'false')
  await titles.click()
  await expect(titles).toHaveAttribute('aria-pressed', 'true')
  await expect((await day(page, 1)).locator('[data-cal-entry]')).toContainText('Tomorrow')
  await expect(calendar(page).locator('[data-cal-legend]')).toHaveCount(0)
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
  await page.reload()
  await expect(calendar(page).getByRole('button', { name: 'Titles' })).toHaveAttribute('aria-pressed', 'true')
  await expect((await day(page, 1)).locator('[data-cal-entry]')).toContainText('Tomorrow')

  await calendar(page).getByRole('button', { name: 'Titles' }).click()
  await expect(await day(page, 2)).toHaveAttribute('data-heat', '3')
})
