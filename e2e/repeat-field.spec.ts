import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'
import { pickInReview, seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A task's repeat is typed (schema v84, board R1) behind its due date: in the
 * task editor and the review card the Due cell's date opens a small popover
 * whose `Repeat every [2w]` ⏎ or a blur writes — the stored rule an
 * interval, a month's day of the month kept —, ⏎ closing the popover with
 * the focus back on the date; the read-back says it with the next due date,
 * an empty field removes it, a text that doesn't read says how to write one
 * and is never written, Esc puts the stored text back and keeps the popover
 * open, a second Esc closes it (and nothing around it), and a press outside
 * keeps what was typed. The cell shows the rows' repeat glyph, named by the
 * rule; the rows say it in words (`Every 2 weeks`) in the due date's tooltip.
 */

const TITLE = 'Team sync'

const SEED: WorkspaceSeed = {
  people: [{ name: 'Aisha', color: '#c8743a' }],
  tasks: [{ title: TITLE, people: ['Aisha'], dueInDays: 4, recurrence: 'weekly' }],
  listDefinitions: [{ name: 'Everything', grouping: 'none', sort: 'manual' }],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'l1', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

const REVIEW_SEED: WorkspaceSeed = {
  ...SEED,
  layouts: [{ name: 'Review', table: { areas: ['rv'], cells: [{ id: 'rv', tabs: [{ id: 'rv1', kind: 'review' }] }] } }],
}

/** The stored repeat of the task, as `2w` (or undefined). */
async function storedRepeat(page: Page): Promise<string | undefined> {
  const todo = (await readStore<{ title: string; recurrenceRule?: { every?: { count: number; unit: string }; type?: string } }>(page, 'todos'))
    .find((t) => t.title === TITLE)
  const every = todo?.recurrenceRule?.every
  return every ? `${every.count}${every.unit}` : undefined
}

/** `Mon, Dec 7`: the read-back's next date, `days` from today. */
function nextWords(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

async function exerciseRepeat(page: Page, host: Locator) {
  const due = host.locator('[data-fact="due"]')
  const date = due.getByRole('button', { name: /^Due date:/ })
  const glyph = due.getByRole('img')
  const popover = page.getByRole('dialog', { name: 'Due date' })
  const field = popover.getByRole('textbox', { name: 'Repeat every' })
  const readBack = popover.locator('[data-repeat-readback]')
  // No standing field in the band: the rows' glyph names the stored weekly repeat.
  await expect(due.getByRole('textbox')).toHaveCount(0)
  await expect(glyph).toHaveAccessibleName(/^Every (Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)

  // The date opens the popover: the stored weekly repeat (v84: 1w), read back with its weekday and next date.
  await date.click()
  await expect(field).toHaveValue('1w')
  await expect(readBack).toHaveText(`Every ${new Date(Date.now() + 4 * 86_400_000).toLocaleDateString('en-US', { weekday: 'short' })} · next ${nextWords(11)}`)

  // ⏎ writes a typed interval and closes the popover, the focus back on the date.
  await field.fill('2w')
  await expect(readBack).toHaveText(`Every 2 weeks · next ${nextWords(18)}`)
  await field.press('Enter')
  await expect(popover).toBeHidden()
  await expect(date).toBeFocused()
  await expect.poll(() => storedRepeat(page)).toBe('2w')
  await expect(glyph).toHaveAccessibleName('Every 2 weeks')

  // A text that doesn't read: its hint, nothing written — ⏎ and a blur alike. Enter on the date opens it.
  await date.press('Enter')
  await field.fill('2x')
  await expect(popover.getByRole('alert')).toHaveText('Use a number and d, w, m or y: 3d, 2w, 1m, 1y')
  await field.press('Enter')
  await expect(field).toBeFocused()
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  expect(await storedRepeat(page)).toBe('2w')

  // Esc puts the stored text back and keeps the popover; a second Esc closes it, and nothing around it.
  await field.press('Escape')
  await expect(field).toHaveValue('2w')
  await expect(popover.getByRole('alert')).toHaveCount(0)
  await expect(popover).toBeVisible()
  await field.press('Escape')
  await expect(popover).toBeHidden()
  await expect(host).toBeVisible()
  await expect(date).toBeFocused()

  // A press outside keeps what was typed.
  await date.click()
  await field.fill('3m')
  await due.getByText('Due', { exact: true }).click()
  await expect(popover).toBeHidden()
  await expect.poll(() => storedRepeat(page)).toBe('3m')

  // Emptied, the repeat goes, and the glyph with it.
  await date.click()
  await field.fill('')
  await expect(readBack).toHaveText('No repeat')
  await field.press('Enter')
  await expect.poll(() => storedRepeat(page)).toBeUndefined()
  await expect(glyph).toHaveCount(0)
}

test.describe('the typed repeat', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the task editor: typed, read back, written; Undo brings the last repeat back; the row says it in words', async ({ page }) => {
    await seedWorkspace(page, SEED)
    // The row's due tooltip says the stored weekly repeat in words.
    const dueCell = taskRowByTitle(page, TITLE).locator('[data-row-cell="due"]')
    await dueCell.hover()
    await expect(page.getByRole('tooltip')).toContainText(/Every (Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)
    await page.mouse.move(0, 0)

    await taskRowByTitle(page, TITLE).locator(`span[data-task-title="${TITLE}"]`).dblclick()
    const dialog = page.getByRole('dialog', { name: 'Edit task' })
    await expect(dialog).toBeVisible()
    await exerciseRepeat(page, dialog)

    // One undo step per write: Ctrl+Z brings back the 3-month repeat.
    await dialog.getByRole('button', { name: /^Close/ }).first().click()
    await expect(dialog).toBeHidden()
    await page.keyboard.press('Control+z')
    await expect.poll(() => storedRepeat(page)).toBe('3m')
    await dueCell.hover()
    await expect(page.getByRole('tooltip')).toContainText('Every 3 months')
  })

  test('the review card: the same popover', async ({ page }) => {
    await seedWorkspace(page, REVIEW_SEED)
    await pickInReview(page, 'rv1', 'Aisha')
    const card = page.locator('[data-review-widget="rv1"] [data-review-card]')
    await expect(card.getByTestId('review-card-title')).toHaveValue(TITLE)
    await exerciseRepeat(page, card)
  })
})
