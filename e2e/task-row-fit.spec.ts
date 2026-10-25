import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed, type WsTabSeed } from './fixtures/workspace'

/**
 * Task rows fit their container at every width: a row is never wider than
 * the list widget, Eisenhower quadrant or dashboard panel it sits in, and its
 * cells and status stay inside it — the people / tags, the dates (to icons)
 * and the title give way instead. Layout-dependent, so a real browser is the
 * authoritative surface.
 */

const PEOPLE = ['Alice Chen', 'Ben Ortiz', 'Carla Diaz']
const TAGS = ['customer', 'budget', 'q4-planning']

/** Rows with everything a row can show (all markers, notes, progress, three tags and people, both dates, a status). */
const TASKS: NonNullable<WorkspaceSeed['tasks']> = [
  {
    title: 'Prepare the quarterly business review deck for Northwind',
    urgent: true, important: true, focus: true,
    notes: 'Numbers from finance first', progress: '50% drafted',
    tags: TAGS, people: PEOPLE, dueInDays: 1, followupInDays: 2, status: 'Waiting',
  },
  {
    title: 'Chase the signed vendor contract',
    urgent: true, important: true,
    notes: 'Legal has it', tags: TAGS.slice(0, 2), people: PEOPLE.slice(0, 2),
    dueInDays: 5, followupInDays: -3, status: 'Waiting',
  },
  { title: 'Book flights', important: true, urgent: true, followupInDays: -10, people: PEOPLE, tags: TAGS },
  { title: 'Short one', urgent: true, important: true },
]

function seed(tab: Omit<WsTabSeed, 'id'>, width: number): WorkspaceSeed {
  // Two columns at a 1280px viewport: the widget's column gets `width` of it.
  return {
    people: PEOPLE,
    tags: TAGS,
    statuses: ['Waiting'],
    listDefinitions: [{ name: 'Everything' }],
    tasks: TASKS,
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'w', weight: width, cells: [{ id: 'cell', tabs: [{ id: 'tab', ...tab }] }] },
        { id: 'rest', weight: 1280 - width, cells: [{ id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] }] },
      ],
    }],
  }
}

/** Every visible task row, with what sticks out of it or of its clipping ancestor. */
async function rowOverflow(page: Page): Promise<{ rows: number; widths: number[]; problems: string[] }> {
  return page.evaluate(() => {
    const problems: string[] = []
    const widths = new Set<number>()
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-todo-id]'))
      .filter((r) => r.getBoundingClientRect().width > 0)
    for (const row of rows) {
      const box = row.getBoundingClientRect()
      widths.add(Math.round(box.width))
      const name = `${row.dataset.todoId}@${Math.round(box.width)}`
      if (row.scrollWidth > row.clientWidth + 1) problems.push(`${name}: scrolls ${row.scrollWidth}`)
      // An element clipped by a box inside the row (the title's ellipsis box
      // clips its text) is that box's to fit: the box itself is checked.
      const clippedInside = (el: HTMLElement) => {
        for (let p = el.parentElement; p && p !== row; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== 'visible') return true
        }
        return false
      }
      for (const el of Array.from(row.querySelectorAll<HTMLElement>('*'))) {
        if (clippedInside(el)) continue
        const b = el.getBoundingClientRect()
        if (b.width > 0 && b.right > box.right + 0.5 && getComputedStyle(el).position !== 'absolute') {
          problems.push(`${name}: ${el.getAttribute('aria-label') ?? el.className} ends at ${Math.round(b.right - box.left)}`)
        }
      }
      let clip = row.parentElement
      while (clip && getComputedStyle(clip).overflowX === 'visible') clip = clip.parentElement
      if (clip && box.right > clip.getBoundingClientRect().right + 0.5) problems.push(`${name}: past its container`)
    }
    return { rows: rows.length, widths: [...widths], problems }
  })
}

/**
 * A row's due and follow-up parts in `tier`: a shown date is its `MM/DD`
 * text alone, a dropped one its icon (the clock, the flag) — in view either way.
 */
async function expectDateParts(row: Locator, tier: string): Promise<void> {
  const date = /^\d\d\/\d\d$/
  const due = row.locator('[data-row-cell="due"]')
  const followup = row.locator('[data-row-cell="followup"]')
  await expect(due).toBeInViewport()
  await expect(followup).toBeInViewport()
  if (tier === 'icons') await expect(due.locator('svg')).toHaveCount(1)
  else await expect(due).toHaveText(date)
  if (tier === 'both') await expect(followup).toHaveText(date)
  else await expect(followup.locator('svg')).toHaveCount(1)
}

/** Which dates the rows show, per column width: the narrower, the fewer. */
const DATES_TIER: Record<number, string> = { 300: 'icons', 330: 'due', 345: 'due', 380: 'both', 455: 'both', 560: 'both' }

test.describe('task rows fit their container', () => {
  for (const width of [300, 330, 345, 380, 455, 560]) {
    test(`list widget column ${width}px`, async ({ page }) => {
      await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, width))
      await expect(page.locator('[data-todo-id]')).toHaveCount(TASKS.length)
      const { problems } = await rowOverflow(page)
      expect(problems).toEqual([])
      // The row's controls are all there: the busiest row's status, its last column.
      const busiest = page.locator('[data-todo-id]').first()
      await busiest.locator('[data-task-title]').hover()
      await expect(busiest.locator('[data-row-cell="status"]')).toBeInViewport()
      // Narrow columns drop the follow-up date first, then the due date; a dropped date shows as its icon.
      await expect(busiest.locator('[data-row-cell="dates"]')).toHaveAttribute('data-dates-tier', DATES_TIER[width]!)
      await expectDateParts(busiest, DATES_TIER[width]!)
    })
  }

  test('Eisenhower quadrants', async ({ page }) => {
    await seedWorkspace(page, seed({ kind: 'eisenhower' }, 600))
    await expect(page.locator('[data-todo-id]')).toHaveCount(TASKS.length)
    const { problems } = await rowOverflow(page)
    expect(problems).toEqual([])
  })

  test('dashboard panels', async ({ page }) => {
    await seedWorkspace(page, seed({ kind: 'dashboard', dashboard: { sections: [{ id: 'hot' }, { id: 'followup' }] } }, 380))
    await expect(page.locator('[data-todo-id]').first()).toBeVisible()
    const { rows, problems } = await rowOverflow(page)
    expect(rows).toBeGreaterThan(0)
    expect(problems).toEqual([])
  })
})

test('narrowing the details by the divider: people and tags shrink, the dates go to icons, then tags, then people go', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, 760))
  await expect(page.locator('[data-todo-id]')).toHaveCount(TASKS.length)
  const busiest = page.locator('[data-todo-id]').first()
  await expect(busiest.locator('[data-person-avatar]').first()).toBeVisible()
  const divider = page.locator('[data-task-row-divider]').first()
  await expect(divider).toHaveAttribute('aria-valuenow', '300')
  const handle = await divider.boundingBox()
  if (!handle) throw new Error('no divider')
  const from = { x: handle.x + handle.width / 2, y: handle.y + 14 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // Dragging right narrows the details: [details, dates tier, people column, tags column].
  const steps: Array<[number, string, boolean, boolean]> = [
    [240, 'both', true, true],
    [200, 'due', true, true],
    [160, 'icons', true, true],
    [130, 'icons', true, false],
    [90, 'icons', false, false],
  ]
  for (const [details, tier, people, tags] of steps) {
    await page.mouse.move(from.x + (300 - details), from.y, { steps: 4 })
    await expect(divider).toHaveAttribute('aria-valuenow', String(details))
    await expect(busiest.locator('[data-row-cell="dates"]')).toHaveAttribute('data-dates-tier', tier)
    await expect(busiest.locator('[data-row-cell="people"]')).toHaveCount(people ? 1 : 0)
    await expect(busiest.locator('[data-row-cell="tags"]')).toHaveCount(tags ? 1 : 0)
    await expectDateParts(busiest, tier)
    expect((await rowOverflow(page)).problems).toEqual([])
  }
  await page.mouse.up()
  // Back to the default: both dates again.
  await divider.dblclick()
  await expect(divider).toHaveAttribute('aria-valuenow', '300')
  await expect(busiest.locator('[data-row-cell="dates"]')).toHaveAttribute('data-dates-tier', 'both')
})
