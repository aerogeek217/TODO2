import { expect, test, type Locator } from '@playwright/test'
import { openSettings, seedTaskList } from './fixtures/workspace'

/**
 * D25 D1 · a task row's dates in words — `Today`, the next six days'
 * weekday (tomorrow too), `11/20` in this calendar year (an overdue date
 * too, bold), `01/15/27` in another — or `MM/DD` under Settings ›
 * Appearance › Dates; each word fits its date part at the 11.5px meta.
 * D2 · the checklist pie before a row's `2/5`: a 12px ring filled by the
 * share done, the accent once every subtask is done. Fit and paint are the
 * real browser's.
 */

// Friday 6 Nov 2026, mid-morning: the words below are this day's.
const NOW = new Date(2026, 10, 6, 10, 30)

const TASKS = [
  { title: 'Due today', dueInDays: 0 },
  { title: 'Due tomorrow', dueInDays: 1 },
  { title: 'Follow up Tuesday', followupInDays: 4 },
  { title: 'Due in two weeks', dueInDays: 14 },
  { title: 'Overdue', dueInDays: -10 },
  { title: 'Follow-up late', followupInDays: -3 },
  { title: 'Due next year', dueInDays: 70 },
  { title: 'Wide words', dueInDays: 5, followupInDays: 28, recurrence: 'weekly' as const },
  { title: 'Checklist none', subtasks: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] },
  { title: 'Checklist some', subtasks: [{ title: 'a', done: true }, { title: 'b' }, { title: 'c' }] },
  { title: 'Checklist all', subtasks: [{ title: 'a', done: true }, { title: 'b', done: true }, { title: 'c', done: true }] },
]

const row = (widget: Locator, title: string) => widget.locator('[data-todo-id]', { has: widget.page().locator(`span[data-task-title="${title}"]`) })
const due = (widget: Locator, title: string) => row(widget, title).locator('[data-row-cell="due"]')
const followup = (widget: Locator, title: string) => row(widget, title).locator('[data-row-cell="followup"]')

/** How far a date part's text sticks out of its button, px (0 = it fits). */
async function overflow(part: Locator): Promise<number> {
  return part.evaluate((button) => {
    const text = button.querySelector('span')
    if (!text) return 0
    const b = button.getBoundingClientRect()
    const t = text.getBoundingClientRect()
    return Math.max(0, b.left - t.left, t.right - b.right, text.scrollWidth - text.clientWidth)
  })
}

test.describe('row dates in words and the checklist pie (D25 D1, D2)', () => {
  test.use({ viewport: { width: 1100, height: 800 } })

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW)
  })

  test('each kind of date reads as its word, fits its part, and keeps the full date in its name', async ({ page }) => {
    const widget = await seedTaskList(page, { tasks: TASKS })
    await expect(due(widget, 'Due today')).toHaveText('Today')
    await expect(due(widget, 'Due tomorrow')).toHaveText('Sat')
    await expect(followup(widget, 'Follow up Tuesday')).toHaveText('Tue')
    await expect(due(widget, 'Due in two weeks')).toHaveText('11/20')
    await expect(due(widget, 'Overdue')).toHaveText('10/27')
    await expect(followup(widget, 'Follow-up late')).toHaveText('11/03')
    await expect(due(widget, 'Due next year')).toHaveText('01/15/27')
    await expect(due(widget, 'Wide words')).toHaveText('Wed')
    await expect(followup(widget, 'Wide words')).toHaveText('12/04')

    // The names keep the full date; overdue stays bold in the deadline colour.
    await expect(due(widget, 'Due tomorrow')).toHaveAccessibleName('Due Sat 7 Nov')
    await expect(due(widget, 'Due next year')).toHaveAccessibleName('Due Fri 15 Jan 2027')
    await expect(followup(widget, 'Follow up Tuesday')).toHaveAccessibleName('Follow-up: Tue 10')
    expect(await due(widget, 'Overdue').evaluate((el) => getComputedStyle(el).fontWeight)).toBe('700')

    // Every word fits its part at the 11.5px meta — the overdue bold and another year's MM/DD/YY too.
    for (const [title, part] of [
      ['Due today', due], ['Due tomorrow', due], ['Due in two weeks', due], ['Overdue', due],
      ['Due next year', due], ['Wide words', due], ['Wide words', followup], ['Follow-up late', followup],
    ] as const) {
      expect(await overflow(part(widget, title)), `${title}`).toBeLessThanOrEqual(0.5)
    }
  })

  test('Settings › Appearance › Dates: MM/DD writes every row date as MM/DD, Relative brings the words back', async ({ page }) => {
    const widget = await seedTaskList(page, { tasks: TASKS })
    await expect(due(widget, 'Due tomorrow')).toHaveText('Sat')
    const settings = await openSettings(page, 'Appearance')
    const dates = settings.getByRole('radiogroup', { name: 'Dates' })
    await expect(dates.getByRole('radio', { name: 'Relative' })).toHaveAttribute('aria-checked', 'true')
    await dates.getByRole('radio', { name: 'MM/DD' }).click()
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()
    await expect(due(widget, 'Due today')).toHaveText('11/06')
    await expect(due(widget, 'Due tomorrow')).toHaveText('11/07')
    await expect(due(widget, 'Due next year')).toHaveText('01/15')
    await expect(followup(widget, 'Follow up Tuesday')).toHaveText('11/10')

    await openSettings(page, 'Appearance')
    await dates.getByRole('radio', { name: 'Relative' }).click()
    await page.keyboard.press('Escape')
    await expect(due(widget, 'Due today')).toHaveText('Today')
  })

  test('the pie fills by the share done and turns the accent when all are done', async ({ page }) => {
    const widget = await seedTaskList(page, { tasks: TASKS })
    const pie = (title: string) => row(widget, title).locator('[data-subtask-pie]')
    await expect(pie('Checklist none')).toHaveAttribute('data-subtask-pie', '0')
    await expect(pie('Checklist some')).toHaveAttribute('data-subtask-pie', '33')
    await expect(pie('Checklist all')).toHaveAttribute('data-subtask-pie', '100')
    await expect(row(widget, 'Checklist some').locator('[data-subtask-count]')).toHaveText('1/3')

    const look = (title: string) => pie(title).evaluate((el) => {
      const cs = getComputedStyle(el)
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-accent)'
      document.body.append(probe)
      const accent = getComputedStyle(probe).color
      probe.remove()
      const box = el.getBoundingClientRect()
      // The ring: an inset shadow (`<color> 0px 0px 0px 1.5px inset`) — a border would snap to 1px.
      return { size: [box.width, box.height], ring: cs.boxShadow, fill: cs.backgroundImage, count: getComputedStyle(el.parentElement!).color, accent }
    })
    const none = await look('Checklist none')
    expect(none.size).toEqual([12, 12])
    expect(none.ring).toBe(`${none.count} 0px 0px 0px 1.5px inset`)
    expect(none.fill).toBe(`conic-gradient(${none.count} 0%, rgba(0, 0, 0, 0) 0deg)`)
    const some = await look('Checklist some')
    expect(some.ring).toBe(`${some.count} 0px 0px 0px 1.5px inset`)
    expect(some.fill).toBe(`conic-gradient(${some.count} 33%, rgba(0, 0, 0, 0) 0deg)`)
    expect(some.count).not.toBe(some.accent)
    const all = await look('Checklist all')
    expect(all.ring).toBe(`${all.accent} 0px 0px 0px 1.5px inset`)
    expect(all.fill).toBe(`conic-gradient(${all.accent} 100%, rgba(0, 0, 0, 0) 0deg)`)
  })
})
