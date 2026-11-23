import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The task layout's Due and Planned are typed date fields like the
 * follow-ups' (the task editor here; the review card shares them): one
 * click on a field's calendar opens the browser's picker on that field's
 * date input, and a day set there is written — Due's as the due date,
 * Planned's as the plan (from today on: the input's `min`). Due's ↻ opens
 * its repeat popover, which sets and stops a repeat. Planned's × clears the
 * plan, a held task's Unplanned too.
 */

const DUE_TASK = 'Quarterly report'
const HELD_TASK = 'Vendor follow-up'

const SEED: WorkspaceSeed = {
  people: [{ name: 'Aisha', color: '#c8743a' }],
  tasks: [
    { title: DUE_TASK, people: ['Aisha'], dueInDays: 4, doInDays: 2 },
    { title: HELD_TASK, people: ['Aisha'], unplanned: true },
  ],
  listDefinitions: [{ name: 'Everything', grouping: 'none', sort: 'manual' }],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'l1', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

interface StoredTask {
  title: string
  dueDate?: string
  doDate?: string
  unplanned?: boolean
  recurrenceRule?: { every?: { count: number; unit: string } }
}

async function stored(page: Page, title: string): Promise<StoredTask> {
  const todo = (await readStore<StoredTask>(page, 'todos')).find((t) => t.title === title)
  if (!todo) throw new Error(`no task ${title}`)
  return todo
}

/** A stored date as the date input's value (`YYYY-MM-DD`, local). */
function dayValueOf(date: string | undefined): string | undefined {
  if (!date) return undefined
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Today + `days` as the date input's value. */
async function dayValue(page: Page, days: number): Promise<string> {
  return page.evaluate((n) => {
    const d = new Date()
    d.setDate(d.getDate() + n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, days)
}

async function openEditor(page: Page, title: string): Promise<Locator> {
  await taskRowByTitle(page, title).locator(`span[data-task-title="${title}"]`).dblclick()
  const dialog = page.getByRole('dialog', { name: 'Edit task' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** The date inputs `showPicker` was called on, by their field (its `aria-label`), in order. */
const pickers = (page: Page) => page.evaluate(() => (window as unknown as { __pickers: string[] }).__pickers)

test.describe('Due and Planned as date fields', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(async ({ page }) => {
    // The browser's own picker can't be seen: record which field's date input each call opens.
    await page.addInitScript(() => {
      const w = window as unknown as { __pickers: string[] }
      w.__pickers = []
      HTMLInputElement.prototype.showPicker = function (this: HTMLInputElement) {
        const field = this.closest('[data-fact]')?.getAttribute('data-fact') ?? '?'
        w.__pickers.push(`${field}:${this.type}`)
      }
    })
    await seedWorkspace(page, SEED)
  })

  test('one click on a calendar opens that field’s picker; a day set there is written', async ({ page }) => {
    const dialog = await openEditor(page, DUE_TASK)
    const due = dialog.locator('[data-fact="due"]')
    const planned = dialog.locator('[data-fact="planned"]')

    // Due: one click, the picker opens on the due date's own input, on the stored day.
    await due.getByRole('button', { name: 'Pick due date' }).click()
    await expect.poll(() => pickers(page)).toEqual(['due:date'])
    const dueInput = due.locator('input[type="date"]')
    await expect(dueInput).toHaveValue(dayValueOf((await stored(page, DUE_TASK)).dueDate)!)
    const nextWeek = await dayValue(page, 7)
    await dueInput.fill(nextWeek, { force: true })
    await expect.poll(async () => dayValueOf((await stored(page, DUE_TASK)).dueDate)).toBe(nextWeek)

    // Planned: one click, its own input, which starts at today.
    await planned.getByRole('button', { name: 'Pick planned day' }).click()
    await expect.poll(() => pickers(page)).toEqual(['due:date', 'planned:date'])
    const plannedInput = planned.locator('input[type="date"]')
    await expect(plannedInput).toHaveAttribute('min', await dayValue(page, 0))
    const inThree = await dayValue(page, 3)
    await plannedInput.fill(inThree, { force: true })
    await expect.poll(async () => dayValueOf((await stored(page, DUE_TASK)).doDate)).toBe(inThree)
    const full = await page.evaluate(() => {
      const d = new Date()
      d.setDate(d.getDate() + 3)
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    })
    await expect(planned.locator('[data-fact-date-field]')).toHaveAttribute('data-tooltip', full)
  })

  test('typed: an interval in Due is written, a past day in Planned refused', async ({ page }) => {
    const dialog = await openEditor(page, DUE_TASK)
    const due = dialog.locator('[data-fact="due"]')
    const dueField = due.getByRole('textbox', { name: 'Due date' })
    await dueField.click()
    await dueField.fill('2w')
    await expect(due.locator('[data-date-under]')).toContainText('in 2 weeks')
    await dueField.press('Enter')
    const inTwoWeeks = await dayValue(page, 14)
    await expect.poll(async () => dayValueOf((await stored(page, DUE_TASK)).dueDate)).toBe(inTwoWeeks)

    const planned = dialog.locator('[data-fact="planned"]')
    const before = dayValueOf((await stored(page, DUE_TASK)).doDate)
    const plannedField = planned.getByRole('textbox', { name: 'Planned' })
    await plannedField.click()
    await plannedField.fill('yesterday')
    await expect(planned.locator('[data-date-under]')).toHaveText('Plan a day from today on')
    await expect(plannedField).toHaveAttribute('aria-invalid', 'true')
    await plannedField.press('Enter')
    expect(dayValueOf((await stored(page, DUE_TASK)).doDate)).toBe(before)
  })

  test('the ↻ popover sets and stops a repeat', async ({ page }) => {
    const dialog = await openEditor(page, DUE_TASK)
    const due = dialog.locator('[data-fact="due"]')
    const button = due.getByRole('button', { name: /^Repeat/ })
    await expect(button).toHaveAccessibleName('Repeat')
    await button.click()
    const popover = page.getByRole('dialog', { name: 'Repeat' })
    await popover.getByRole('textbox', { name: 'Repeat every' }).fill('2w')
    await popover.getByRole('textbox', { name: 'Repeat every' }).press('Enter')
    await expect(popover).toBeHidden()
    await expect.poll(async () => (await stored(page, DUE_TASK)).recurrenceRule?.every).toEqual({ count: 2, unit: 'w' })
    await expect(button).toHaveAccessibleName('Repeat: Every 2 weeks')
    await expect(button).toHaveAttribute('data-on', '')

    await button.click()
    await popover.getByRole('button', { name: 'Stop repeating' }).click()
    await expect(popover).toBeHidden()
    await expect.poll(async () => (await stored(page, DUE_TASK)).recurrenceRule).toBeUndefined()
    await expect(button).toHaveAccessibleName('Repeat')
  })

  test('× on Planned clears the plan: a planned day, and a held task’s Unplanned', async ({ page }) => {
    let dialog = await openEditor(page, DUE_TASK)
    let planned = dialog.locator('[data-fact="planned"]')
    await planned.locator('[data-fact-date-field]').hover()
    await planned.getByRole('button', { name: 'Clear plan' }).click()
    await expect.poll(async () => (await stored(page, DUE_TASK)).doDate).toBeUndefined()
    await expect(planned.locator('[data-fact-date-field]')).toContainText('Not planned')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    dialog = await openEditor(page, HELD_TASK)
    planned = dialog.locator('[data-fact="planned"]')
    await expect(planned.locator('[data-fact-date-field]')).toContainText('Unplanned')
    await planned.locator('[data-fact-date-field]').hover()
    await planned.getByRole('button', { name: 'Clear plan' }).click()
    await expect.poll(async () => (await stored(page, HELD_TASK)).unplanned).toBeUndefined()
    await expect(planned.locator('[data-fact-date-field]')).toContainText('Not planned')
  })
})
