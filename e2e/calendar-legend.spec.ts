import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The month heat map's legend (`Due and follow-ups: 0 1–2 3–5 6+`) in a real
 * browser (UX review defect 4). In a 220px strip at 1440 × 900 — the dev
 * seed's Planning layout — six rows at their least plus the legend didn't
 * fit: the grid scrolled by a few px, its last week cut at the grid's edge
 * with the legend right under it, which read as the legend lying on that
 * week. The legend now shows only while every row gets its least beside it;
 * else the rows take its room.
 */

function seed(rowPx: number): WorkspaceSeed {
  return {
    listDefinitions: [{ name: 'Everything' }],
    tasks: Array.from({ length: 30 }, (_, i) => ({ title: `Task ${i}`, dueInDays: i - 10 })),
    layouts: [{
      name: 'Main',
      table: {
        areas: ['a b', 'cal e'],
        cells: [
          { id: 'a', tabs: [{ id: 'na', kind: 'notes' }] },
          { id: 'b', tabs: [{ id: 'nb', kind: 'notes' }] },
          { id: 'cal', tabs: [{ id: 'calTab', kind: 'calendar' }] },
          { id: 'e', tabs: [{ id: 'ne', kind: 'notes' }] },
        ],
        cols: [750, 250],
        rows: [1000, { px: rowPx }],
      },
    }],
  }
}

/** The month's geometry: the grid's box, each week row's, the legend's (or null). */
async function geometry(page: Page) {
  return page.locator('[data-calendar-widget="calTab"]').evaluate((root) => {
    const grid = root.querySelector<HTMLElement>('[data-cal-grid="month"]')!
    const legend = root.querySelector('[data-cal-legend]')
    const box = (el: Element) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom } }
    return {
      scrolls: grid.dataset.scrolls === 'true',
      scrollable: grid.scrollHeight > grid.clientHeight,
      grid: box(grid),
      weeks: Array.from(grid.children).filter((_, i) => i % 7 === 0).map(box),
      legend: legend ? box(legend) : null,
      widget: box(root),
    }
  })
}

test.use({ viewport: { width: 1440, height: 900 } })

test('a 220px strip: every week row whole and no legend over or under a cut week', async ({ page }) => {
  await seedWorkspace(page, seed(220))
  const grid = page.locator('[data-calendar-widget="calTab"] [data-cal-grid="month"]')
  await expect(grid).toHaveAttribute('data-heat-map', 'true')
  const g = await geometry(page)
  // The rows take the legend's room and fit: nothing scrolls, nothing is cut.
  expect(g.legend).toBeNull()
  expect(g.scrolls).toBe(false)
  expect(g.scrollable).toBe(false)
  expect(g.weeks).toHaveLength(6)
  for (const w of g.weeks) expect(w.bottom).toBeLessThanOrEqual(g.grid.bottom + 0.5)
  expect(g.grid.bottom).toBeLessThanOrEqual(g.widget.bottom + 0.5)
})

test('a taller strip: the legend shows under the last week, apart from it', async ({ page }) => {
  await seedWorkspace(page, seed(300))
  await expect(page.locator('[data-calendar-widget="calTab"] [data-cal-legend]')).toBeVisible()
  const g = await geometry(page)
  expect(g.scrolls).toBe(false)
  expect(g.scrollable).toBe(false)
  const last = g.weeks.at(-1)!
  expect(last.bottom).toBeLessThanOrEqual(g.grid.bottom + 0.5)
  expect(g.legend!.top).toBeGreaterThanOrEqual(last.bottom)
  expect(g.legend!.bottom).toBeLessThanOrEqual(g.widget.bottom + 0.5)
})
