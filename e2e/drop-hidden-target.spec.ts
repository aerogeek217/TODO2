import { expect, test, type Page } from '@playwright/test'
import { drag, seedWorkspace, wsCell } from './fixtures/workspace'
import { box } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * A task drop target scrolled out of view — a calendar day in a short,
 * scrolling month — is never `over`: dnd-kit measures droppables unclipped,
 * so a hidden day's rect can lie over the list below it (cr31 W1). Dragging a
 * row within that list must not light the day, open the date chooser or set
 * a date.
 */

test.use({ viewport: { width: 1280, height: 800 } })

const FILLERS = Array.from({ length: 12 }, (_, n) => ({ title: `Filler ${n + 1}` }))

async function dueOf(page: Page, title: string): Promise<number | null> {
  const t = (await readStore<{ title: string; dueDate?: Date }>(page, 'todos')).find((x) => x.title === title)
  return t?.dueDate ? new Date(t.dueDate).getTime() : null
}

test('a calendar day scrolled out of view takes no drop from the list over it', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Everything' }],
    tasks: [{ title: 'Mover', dueInDays: 1 }, ...FILLERS],
    layouts: [{
      name: 'Main',
      columns: [{ id: 'c1', cells: [{ id: 'a1', tabs: [{ id: 'lensTab', kind: 'lens', listDefIdx: 0 }] }] }],
      top: { id: 'band', height: 160, tabs: [{ id: 'calTab', kind: 'calendar', titles: true }] },
    }],
  })
  const grid = page.locator('[data-calendar-widget="calTab"] [data-cal-grid="month"]')
  await expect(grid).toHaveAttribute('data-scrolls', 'true')
  const list = wsCell(page, 'a1')
  const mover = list.locator('[data-row-key]').filter({ hasText: 'Mover' })
  await expect(mover).toBeVisible()

  // A day below the grid's visible part, whose (unclipped) box lies over the list.
  const listBox = await box(list)
  const hidden = await grid.evaluate((g, lb) => {
    const visibleBottom = g.getBoundingClientRect().bottom
    for (const d of Array.from(g.querySelectorAll<HTMLElement>('[data-day]'))) {
      const r = d.getBoundingClientRect()
      const cy = r.top + r.height / 2
      if (r.top >= visibleBottom && cy > lb.y + 40 && cy < lb.y + lb.height - 10) {
        return { key: d.dataset.day ?? '', x: r.left + r.width / 2, y: cy }
      }
    }
    return null
  }, listBox)
  expect(hidden, 'a hidden day over the list').not.toBeNull()
  if (!hidden) return
  const day = grid.locator(`[data-day="${hidden.key}"]`)
  const before = await dueOf(page, 'Mover')

  const m = await box(mover)
  await drag(page, { x: m.x + 40, y: m.y + m.height / 2 }, { x: hidden.x, y: hidden.y }, {
    during: async () => {
      await expect(day).not.toHaveAttribute('data-drop-target', 'true')
    },
  })
  await expect(page.getByRole('menu', { name: 'Set which date' })).toHaveCount(0)
  expect(await dueOf(page, 'Mover')).toBe(before)
})
