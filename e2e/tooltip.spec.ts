import { expect, test, type Locator, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, wsListWidget } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * The app tooltip (`useTooltip` → `TooltipBubble`, placed by
 * `usePopoverAnchor`): opens 400 ms after hover, centred 6px below its
 * trigger, above it near the bottom edge, kept inside the viewport near the
 * side edges; Escape and a scroll close it. Placement is layout-dependent, so
 * a real browser is the authoritative surface.
 */

const MARGIN = 8
const FILLERS = Array.from({ length: 30 }, (_, n) => ({ title: `Filler task ${n + 1}` }))

/** One list, in the right-hand of `columns` columns. */
async function open(page: Page, tasks: Parameters<typeof seedWorkspace>[1]['tasks'], columns = 1): Promise<Locator> {
  const filler = Array.from({ length: columns - 1 }, (_, n) => ({ id: `c${n}`, cells: [{ id: `n${n}`, tabs: [{ id: `notes${n}`, kind: 'notes' as const }] }] }))
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Tasks' }],
    tasks,
    layouts: [{ name: 'Main', columns: [...filler, { id: 'list', cells: [{ id: 'cell', tabs: [{ id: 'tasks', kind: 'lens', listDefIdx: 0 }] }] }] }],
  })
  const widget = wsListWidget(page, 'tasks')
  await widget.waitFor({ state: 'visible' })
  return widget
}

async function hoverForTooltip(page: Page, trigger: Locator): Promise<Locator> {
  await trigger.hover()
  const tip = page.getByRole('tooltip')
  await expect(tip).toBeVisible()
  await expect(tip).toHaveAttribute('data-placed', 'true')
  return tip
}

test('centred 6px below its trigger', async ({ page }) => {
  await open(page, [{ title: 'Alpha', urgent: true }], 2)
  const marker = taskRowByTitle(page, 'Alpha').getByRole('button', { name: 'Markers: Urgent' })
  const tip = await hoverForTooltip(page, marker)
  const m = await box(marker)
  const t = await box(tip)
  expect(Math.abs(t.x + t.width / 2 - (m.x + m.width / 2))).toBeLessThan(1)
  expect(Math.round(t.y - (m.y + m.height))).toBe(6)
})

test('near the bottom it opens above its trigger', async ({ page }) => {
  await open(page, [...FILLERS, { title: 'Last', followupInDays: 3 }], 2)
  const row = taskRowByTitle(page, 'Last')
  await row.scrollIntoViewIfNeeded()
  const pill = row.locator('[data-row-cell="followup"]')
  const tip = await hoverForTooltip(page, pill)
  const p = await box(pill)
  const t = await box(tip)
  expect(Math.round(p.y - (t.y + t.height))).toBe(6)
  expect(t.y).toBeGreaterThanOrEqual(MARGIN - 0.5)
})

test('near the left edge it stays inside the window', async ({ page }) => {
  // Due tomorrow: urgent by its date, so the marker gutter has a two-line tooltip.
  await open(page, [{ title: 'Alpha', dueInDays: 1 }])
  const clock = taskRowByTitle(page, 'Alpha').getByRole('button', { name: /^Markers: Urgent/ })
  const tip = await hoverForTooltip(page, clock)
  const c = await box(clock)
  const t = await box(tip)
  // Centred on the clock it would have crossed the left edge.
  expect(c.x + c.width / 2 - t.width / 2).toBeLessThan(MARGIN)
  expect(Math.round(t.x)).toBe(MARGIN)
  expect(Math.round(t.y - (c.y + c.height))).toBe(6)
})

test('Escape and a scroll close it', async ({ page }) => {
  await open(page, [{ title: 'Alpha', urgent: true }, ...FILLERS])
  const marker = taskRowByTitle(page, 'Alpha').getByRole('button', { name: 'Markers: Urgent' })
  let tip = await hoverForTooltip(page, marker)
  await page.keyboard.press('Escape')
  await expect(tip).toHaveCount(0)

  await page.mouse.move(0, 0)
  tip = await hoverForTooltip(page, marker)
  await page.mouse.wheel(0, 120)
  await expect(tip).toHaveCount(0)
})
