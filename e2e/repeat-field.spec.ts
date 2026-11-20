import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'
import { pickInReview, seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A task's repeat is typed (schema v84, board R1): the Due cell's `Repeat
 * every [2w]` in the task editor and the review card. ⏎ or a blur writes it
 * — the stored rule an interval, a month's day of the month kept —, the
 * read-back says it with the next due date, an empty field removes it, a
 * text that doesn't read says how to write one and is never written, Esc
 * puts the stored text back without closing what is around it. The rows say
 * it in words (`Every 2 weeks`) in the due date's tooltip.
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
  const field = due.getByRole('textbox', { name: 'Repeat every' })
  const readBack = due.locator('[data-repeat-readback]')
  // The stored weekly repeat (v84: 1w), read back with its weekday and next date.
  await expect(field).toHaveValue('1w')
  await expect(readBack).toHaveText(`Every ${new Date(Date.now() + 4 * 86_400_000).toLocaleDateString('en-US', { weekday: 'short' })} · next ${nextWords(11)}`)

  // ⏎ writes a typed interval.
  await field.fill('2w')
  await expect(readBack).toHaveText(`Every 2 weeks · next ${nextWords(18)}`)
  await field.press('Enter')
  await expect(field).not.toBeFocused()
  await expect.poll(() => storedRepeat(page)).toBe('2w')

  // A text that doesn't read: its hint, nothing written — ⏎ and a blur alike.
  await field.fill('2x')
  await expect(due.getByRole('alert')).toHaveText('Use a number and d, w, m or y: 3d, 2w, 1m, 1y')
  await field.press('Enter')
  await expect(field).toBeFocused()
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  expect(await storedRepeat(page)).toBe('2w')

  // Esc puts the stored text back and closes nothing around it.
  await field.press('Escape')
  await expect(field).toHaveValue('2w')
  await expect(due.getByRole('alert')).toHaveCount(0)
  await expect(host).toBeVisible()

  // A blur writes it too; emptied, the repeat goes.
  await field.fill('3m')
  await field.blur()
  await expect.poll(() => storedRepeat(page)).toBe('3m')
  await field.fill('')
  await field.press('Enter')
  await expect(readBack).toHaveText('No repeat')
  await expect.poll(() => storedRepeat(page)).toBeUndefined()
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

  test('the review card: the same field', async ({ page }) => {
    await seedWorkspace(page, REVIEW_SEED)
    await pickInReview(page, 'rv1', 'Aisha')
    const card = page.locator('[data-review-widget="rv1"] [data-review-card]')
    await expect(card.getByTestId('review-card-title')).toHaveValue(TITLE)
    await exerciseRepeat(page, card)
  })
})
