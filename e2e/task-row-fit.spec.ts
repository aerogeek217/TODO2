import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed, type WsTabSeed } from './fixtures/workspace'

/**
 * Task rows fit their container at every width: a row is never wider than
 * the list widget, Eisenhower quadrant or dashboard panel it sits in, and its
 * pills, status and ⋯ stay inside it — the chips and the title give way
 * instead. Layout-dependent, so a real browser is the authoritative surface.
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
      for (const el of Array.from(row.querySelectorAll<HTMLElement>('*'))) {
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

test.describe('task rows fit their container', () => {
  for (const width of [300, 330, 380, 455, 560]) {
    test(`list widget column ${width}px`, async ({ page }) => {
      await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, width))
      await expect(page.locator('[data-todo-id]')).toHaveCount(TASKS.length)
      const { problems } = await rowOverflow(page)
      expect(problems).toEqual([])
      // The row's controls are all there: the ⋯ and status of the busiest row.
      const busiest = page.locator('[data-todo-id]').first()
      await busiest.hover()
      await expect(busiest.getByRole('button', { name: 'Task actions' })).toBeInViewport()
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
