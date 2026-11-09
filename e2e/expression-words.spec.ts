import { expect, test, type Locator } from '@playwright/test'
import { seedWorkspace, wsListWidget, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A list whose filter is an expression reads it back in words on its filter
 * line (D26 board BF): names as chips, joining words muted, dates as a chip
 * words them; the tooltip holds the exact expression and a click opens Edit
 * list. Too long for its space, the line fades at its end and says `+N more`,
 * N the top-level terms that start past what shows.
 */

const before = (days: number) => ({ match: 'range', start: null, end: { kind: 'offset', days: -days } })

// People, tags and statuses are numbered from 1 in the seed's order.
const CHASE = {
  kind: 'and',
  items: [
    { kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'and', items: [{ kind: 'tag', id: 1 }, { kind: 'not', item: { kind: 'status', id: 1 } }] }] },
    { kind: 'date', field: 'lastFollowup', match: before(7) },
  ],
}

const LONG = {
  kind: 'and',
  items: [
    { kind: 'person', id: 1 },
    { kind: 'tag', id: 1 },
    { kind: 'not', item: { kind: 'status', id: 1 } },
    { kind: 'priority', value: 'urgent' },
    { kind: 'date', field: 'deadline', match: { match: 'range', start: { kind: 'relative', token: 'today' }, end: { kind: 'offset', days: 14 } } },
    { kind: 'text', text: 'invoice' },
    { kind: 'date', field: 'created', match: { match: 'range', start: { kind: 'offset', days: -30 }, end: { kind: 'relative', token: 'today' } } },
    { kind: 'tag', id: 2 },
  ],
}

function seed(expression: unknown, columns: WorkspaceSeed['layouts'][number]['columns']): WorkspaceSeed {
  return {
    people: ['Ann', 'Bob'],
    tags: ['q4', 'Ops'],
    statuses: ['Waiting', 'Active'],
    listDefinitions: [{ name: 'Chase', predicate: { expression } }],
    tasks: [{ title: 'Ann task', people: ['Ann'] }],
    layouts: [{ name: 'Main', columns }],
  }
}

const listColumn = { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens' as const, listDefIdx: 0 }] })] }

const texts = (loc: Locator) => loc.evaluateAll((els) => els.map((el) => el.textContent ?? ''))

test.use({ viewport: { width: 1400, height: 800 } })

test('the filter line reads an expression in words; its tooltip is the exact text; a click opens Edit list', async ({ page }) => {
  await seedWorkspace(page, seed(CHASE, [listColumn]))
  const line = wsListWidget(page, 't1').getByTestId('list-filter-expression')
  await expect(line).toHaveText('(Ann or #q4 but not Waiting) · last follow-up 7+ days ago')
  expect(await texts(line.locator('[data-piece="name"]'))).toEqual(['Ann', '#q4', 'Waiting'])
  expect(await texts(line.locator('[data-piece="joiner"]'))).toEqual(['(', 'or', 'but not', ')', '·'])
  expect(await texts(line.locator('[data-piece="word"]'))).toEqual(['last follow-up 7+ days ago'])
  // Joiners are muted, names on the Graphical chip's plate.
  const colour = (sel: string) => line.locator(sel).first().evaluate((el) => getComputedStyle(el).color)
  expect(await colour('[data-piece="joiner"]')).not.toBe(await colour('[data-piece="word"]'))
  expect(await line.locator('[data-piece="name"]').first().evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await expect(line.getByTestId('list-filter-expression-more')).toHaveCount(0)

  await line.hover()
  await expect(page.getByRole('tooltip')).toContainText('(@Ann or (#q4 and not !Waiting)) and followed by 7 days ago')

  await line.click()
  await expect(page.getByTestId('edit-list').getByRole('textbox', { name: 'Filter expression' })).toHaveValue('(@Ann or (#q4 and not !Waiting)) and followed by 7 days ago')
})

test('too long for its space: the line fades at its end and counts the terms not shown; a click still opens Edit list', async ({ page }) => {
  await seedWorkspace(page, seed(LONG, [
    { ...listColumn, weight: 1 },
    { id: 'c2', weight: 2, rows: [wsRow({ id: 'k2', tabs: [{ id: 't2', kind: 'notes' }] })] },
  ]))
  const line = wsListWidget(page, 't1').getByTestId('list-filter-expression')
  await expect(line).toContainText('Ann · #q4 · not Waiting · Urgent · due within the next 14 days')
  const more = line.getByTestId('list-filter-expression-more')
  await expect(more).toHaveText(/^\+\d+ more$/)

  // The count is the terms whose first piece starts in or past the fade; the clip fades.
  const measured = await line.evaluate((el) => {
    const clip = el.firstElementChild as HTMLElement
    const edge = clip.getBoundingClientRect().right - 28
    const firsts = new Map<string, Element>()
    for (const piece of clip.querySelectorAll('[data-term]')) {
      const term = (piece as HTMLElement).dataset.term ?? ''
      if (!firsts.has(term)) firsts.set(term, piece)
    }
    const hidden = [...firsts.values()].filter((p) => p.getBoundingClientRect().left >= edge).length
    return { hidden, terms: firsts.size, mask: getComputedStyle(clip).maskImage, fits: el.getBoundingClientRect().right <= (el.parentElement?.getBoundingClientRect().right ?? 0) + 1 }
  })
  expect(measured.terms).toBe(8)
  expect(measured.hidden).toBeGreaterThan(0)
  expect(measured.hidden).toBeLessThan(8)
  await expect(more).toHaveText(`+${measured.hidden} more`)
  expect(measured.mask).toContain('linear-gradient')
  // The line stays inside the filter line's space (it shrinks; nothing scrolls).
  expect(measured.fits).toBe(true)

  await line.click()
  await expect(page.getByTestId('edit-list')).toBeVisible()
})
