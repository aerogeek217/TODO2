import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { expectLayoutStored, openCellMenu, pickInReview, pickWidgetKind, reviewField, seedWorkspace, wsCell, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Item 12 · the Review widget in the real browser (widget feedback 2A, board
 * Review-field): added from the cell's ⋯; one field that takes a filter
 * expression — no kind — temporary (gone with a reload, never in the
 * layout); a click lists people, tags and statuses with their open tasks
 * under the field, bare letters match all three and ⏎ takes the first, a
 * second pick joins with `or` (the same sort) or `and`; `@` still opens the
 * expression popup; a filter that doesn't read keeps the queue on the last
 * one that did, Esc putting its text back; the check-in buttons while the
 * filter names only people; the default Priority sort and a row's
 * double-click; a follow-up from the widget, the live queue, the lens
 * switch, and its faces by the cell's size. With `REVIEW_SHOTS=<folder>` it
 * also saves screenshots (dark, 1440 × 900) for the design review.
 */

const SHOTS = process.env.REVIEW_SHOTS

test.use({ viewport: { width: 1440, height: 900 } })

const TASKS: NonNullable<WorkspaceSeed['tasks']> = [
  { title: 'Vendor contract renewal', people: ['Aisha'], tags: ['legal'], dueInDays: -3, followupInDays: 4, lastFollowupInDays: -14, urgent: true, notes: 'Legal wants the indemnity clause reworded before we sign.', statusUpdates: [{ text: 'Sent redlines; waiting on their legal.', inDays: -6 }], subtasks: [{ title: 'Draft redlines', done: true }, { title: 'Vendor sign-off' }, { title: 'File signed copy' }], status: 'Waiting' },
  { title: 'Q4 headcount plan', people: ['Aisha'], dueInDays: 6, followupInDays: 1 },
  { title: 'Onboarding checklist', people: ['Aisha', 'Ben'], followupInDays: 0, important: true },
  { title: 'Hiring scorecard', people: ['Aisha'], tags: ['legal'], dueInDays: 9 },
  { title: 'Ben’s own task', people: ['Ben'] },
]

const BASE: Omit<WorkspaceSeed, 'layouts'> = {
  people: [{ name: 'Aisha', color: '#c8743a' }, { name: 'Ben', color: '#5a8fd8' }, { name: 'Marcus Chen', color: '#8fbf6a' }],
  tags: ['legal'],
  statuses: ['Waiting'],
  tasks: TASKS,
}

const widget = (page: Page, tabId: string) => page.locator(`[data-review-widget="${tabId}"]`)
const cardTitle = (page: Page, tabId: string) => widget(page, tabId).getByTestId('review-card-title')
const railRows = (page: Page, tabId: string) => widget(page, tabId).locator('[data-review-row]')
const popup = (page: Page) => page.locator('[data-nlp-popup]')

async function storedTask(page: Page, title: string) {
  return (await readStore<{ id: number; title: string; lastFollowupAt?: Date }>(page, 'todos')).find((t) => t.title === title)
}

async function storedReviewTab(page: Page, tabId: string) {
  const layouts = await readStore<{ cells: Array<{ tabs: Array<{ id: string; config: Record<string, unknown>; viewState?: Record<string, unknown> }> }> }>(page, 'layouts')
  return layouts.flatMap((l) => l.cells.flatMap((c) => c.tabs)).find((t) => t.id === tabId)
}

const isToday = (d: Date | undefined) => !!d && new Date(d).toDateString() === new Date().toDateString()

async function shot(page: Page, name: string, target: Locator | Page = page) {
  if (!SHOTS) return
  await target.screenshot({ path: `${SHOTS}/${name}.png` })
}

/** A Review widget beside a Notes cell. */
function largeSeed(): WorkspaceSeed {
  return {
    ...BASE,
    lenses: [{ id: 'lens-urgent', name: 'Urgent', predicate: { markers: [{ values: ['urgent'] }] } }],
    layouts: [{
      name: 'Main',
      table: {
        areas: ['rv list'],
        cols: [1000, 420],
        cells: [
          { id: 'rv', tabs: [{ id: 'rev1', kind: 'review' }] },
          { id: 'list', tabs: [{ id: 'n1', kind: 'notes' }] },
        ],
      },
    }],
  }
}

test('added from the cell’s ⋯: nothing to review; a click lists who or what under the field; picks join; a task followed up', async ({ page }) => {
  await seedWorkspace(page, {
    ...BASE,
    layouts: [{ name: 'Main', table: { areas: ['a'], cells: [{ id: 'a', tabs: [{ id: 'n1', kind: 'notes' }] }] } }],
  })
  await openCellMenu(page, 'a')
  await pickWidgetKind(page, 'Change widget', 'Review')
  const w = page.locator('[data-review-widget]')
  const tabId = await w.getAttribute('data-review-widget') ?? ''
  // Its own top line (alone in the cell): the name — no progress, no lens switch yet — over the field's row; no kind.
  await expect(w.locator('[data-widget-top-line]')).toContainText('Review')
  await expect(w.getByTestId('review-widget-progress')).toHaveCount(0)
  await expect(w.getByTestId('review-by')).toHaveCount(0)
  const empty = w.getByTestId('review-empty')
  await expect(empty).toContainText('Pick who or what to review')
  await expect(empty).toContainText('Click the field, or type @person, #tag, !status or any filter. It is temporary and isn’t saved.')
  const field = reviewField(page, tabId)
  await expect(field).toHaveAttribute('placeholder', 'Who or what to review…')
  await page.mouse.move(0, 0)
  await shot(page, 'rf-empty')

  // Pick focuses the field and lists people, tags and statuses, each with its open tasks.
  await empty.getByRole('button', { name: 'Pick' }).click()
  await expect(field).toBeFocused()
  await expect(popup(page)).toBeVisible()
  await expect(popup(page)).toContainText('People')
  await expect(popup(page)).toContainText('Tags')
  await expect(popup(page)).toContainText('Status')
  const options = popup(page).getByRole('option')
  await expect(options).toHaveText([/Aisha\s*4$/, /Ben\s*2$/, /Marcus Chen\s*0$/, /legal\s*2$/, /Waiting\s*1$/])
  // The list hangs under the field.
  const fieldBox = await w.locator('[data-prompt-row]').boundingBox()
  const popupBox = await popup(page).boundingBox()
  if (!fieldBox || !popupBox) throw new Error('the field and its list have boxes')
  expect(popupBox.y).toBeGreaterThanOrEqual(fieldBox.y + 20)
  expect(popupBox.y).toBeLessThanOrEqual(fieldBox.y + fieldBox.height + 12)
  await shot(page, 'rf-click')

  // A click adds the name; the queue is its open tasks.
  await options.filter({ hasText: 'Aisha' }).click()
  await expect(field).toHaveValue('@Aisha ')
  await expect(popup(page)).toHaveCount(0)
  await expect(w.getByTestId('review-widget-progress')).toHaveText('0 followed up')
  await expect(railRows(page, tabId)).toHaveCount(4)

  // Bare letters match people, tags and statuses at once; ⏎ takes the first — a second person joins with or.
  await field.press('End')
  await field.pressSequentially('be')
  await expect(options).toHaveText([/Ben\s*2$/])
  await shot(page, 'rf-typing')
  await field.press('Enter')
  await expect(field).toHaveValue('@Aisha or @Ben ')
  await expect(railRows(page, tabId)).toHaveCount(5)
  await expect(w.getByRole('button', { name: 'Email check-in' })).toBeVisible()
  await page.mouse.move(0, 0)
  await shot(page, 'rf-two-people')

  // A follow-up from the widget: ⏎ in the update line.
  const line = w.getByLabel('Status update · today')
  await line.click()
  await line.fill('Legal signed off the clause')
  await page.keyboard.press('Enter')
  await expect(w.getByTestId('review-widget-progress')).toHaveText('1 followed up')
})

test('a tag joins with and; @ still opens the expression popup; the field is temporary — nothing in the layout, gone with a reload', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const w = widget(page, 'rev1')
  const field = reviewField(page, 'rev1')
  await field.click()
  await field.pressSequentially('@Ai')
  await expect(popup(page)).toContainText('People')
  await field.press('Enter')
  await expect(field).toHaveValue('@Aisha ')
  // A click where a term may go lists everything; the tag joins with and.
  await field.click()
  await field.press('End')
  await popup(page).getByRole('option').filter({ hasText: 'legal' }).click()
  await expect(field).toHaveValue('@Aisha and #legal ')
  await expect(railRows(page, 'rev1')).toHaveText([/Vendor contract/, /Hiring scorecard/])
  // Not only people: no check-in buttons.
  await expect(w.getByRole('button', { name: 'Email check-in' })).toHaveCount(0)
  // Nothing written to the layout: no undo step, and the stored row holds no filter (and no kind).
  await expect(page.locator('[data-snackbar-live]').getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
  expect((await storedReviewTab(page, 'rev1'))?.config).toEqual({})
  // Skip one, so the review has a place and a mark.
  await w.getByRole('button', { name: /^Skip/ }).click()
  await expect(railRows(page, 'rev1').first()).toHaveAttribute('data-mark', 'skipped')

  await page.reload()
  await expect(field).toHaveValue('')
  await expect(w.getByTestId('review-empty')).toContainText('Pick who or what to review')
  await expectLayoutStored(page)
  await pickInReview(page, 'rev1', 'Aisha')
  await expect(railRows(page, 'rev1').first()).not.toHaveAttribute('data-mark')
})

test('a filter that doesn’t read: the error under the field, the queue on the last one that read; Esc puts its text back; × clears', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const w = widget(page, 'rev1')
  const field = reviewField(page, 'rev1')
  await pickInReview(page, 'rev1', 'Ben')
  await expect(field).toHaveValue('@Ben')
  await expect(railRows(page, 'rev1')).toHaveCount(2)
  await field.click()
  await field.press('End')
  await field.pressSequentially(' and')
  await field.press('Enter')
  const error = w.getByTestId('review-field-error')
  await expect(error).toBeVisible()
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(railRows(page, 'rev1')).toHaveCount(2)
  await shot(page, 'rf-error', wsCell(page, 'rv'))
  await field.press('Escape')
  await expect(field).toHaveValue('@Ben')
  await expect(error).toHaveCount(0)
  // The × clears the field and the review; the focus stays in the field.
  await w.getByRole('button', { name: 'Clear the filter' }).click()
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  await expect(w.getByTestId('review-empty')).toContainText('Pick who or what to review')
})

test('names with a space round-trip: a pick writes them quoted, the queue reads them', async ({ page }) => {
  await seedWorkspace(page, { ...largeSeed(), tasks: [...TASKS, { title: 'Marcus’s plan', people: ['Marcus Chen'] }] })
  const field = reviewField(page, 'rev1')
  await field.click()
  await field.pressSequentially('mar')
  await field.press('Enter')
  await expect(field).toHaveValue('@"Marcus Chen" ')
  await expect(railRows(page, 'rev1')).toHaveText([/Marcus’s plan/])
  await field.blur()
  await expect(field).toHaveValue('@"Marcus Chen"')
})

test('check-ins: two quiet buttons while the filter names only people — several people, Email opens a menu of them; Paste reply opens the import', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const w = widget(page, 'rev1')
  await pickInReview(page, 'rev1', 'Aisha', 'Ben')
  const email = w.getByRole('button', { name: 'Email check-in' })
  await expect(email).toBeVisible()
  await email.click()
  const menu = page.getByRole('menu', { name: 'Email check-in' })
  await expect(menu.getByRole('menuitem')).toHaveText(['Email check-in to Aisha', 'Email check-in to Ben'])
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await w.getByRole('button', { name: 'Paste reply' }).click()
  await expect(page.getByLabel('Paste the reply here')).toBeVisible()
})

test('large face: sorted by Priority unless a sort is stored; a double-click on a row opens the task; ⏎ in the update line follows up; ← / → step', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const w = widget(page, 'rev1')
  await pickInReview(page, 'rev1', 'Aisha')
  await expect(w).toHaveAttribute('data-review-face', 'large')
  await expect(w.getByTestId('review-sort')).toContainText('Priority')
  // Priority: the urgent task, then the important one, then the rest in the queue's order.
  await expect(railRows(page, 'rev1')).toHaveText([/Vendor contract/, /Onboarding checklist/, /Q4 headcount/, /Hiring scorecard/])
  await expect(cardTitle(page, 'rev1')).toHaveText('Vendor contract renewal')
  await shot(page, 'review-widget-large', page.locator('[data-ws-area]'))

  // A single click shows the card; a double-click opens the task's editor.
  await railRows(page, 'rev1').nth(2).click()
  await expect(cardTitle(page, 'rev1')).toHaveText('Q4 headcount plan')
  await railRows(page, 'rev1').nth(2).dblclick()
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('textbox').first()).toHaveValue('Q4 headcount plan')
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)

  await railRows(page, 'rev1').first().click()
  const line = w.getByLabel('Status update · today')
  await line.click()
  await line.fill('Legal signed off the clause')
  await page.keyboard.press('Enter')
  await expect(cardTitle(page, 'rev1')).toHaveText('Onboarding checklist')
  await expect(railRows(page, 'rev1').first()).toHaveAttribute('data-mark', 'done')
  await expect(w.getByTestId('review-widget-progress')).toHaveText('1 followed up')
  await expect.poll(async () => isToday((await storedTask(page, 'Vendor contract renewal'))?.lastFollowupAt)).toBe(true)
  await expect(w.getByLabel('Status update · today')).toBeFocused()

  await railRows(page, 'rev1').nth(1).focus()
  await page.keyboard.press('ArrowRight')
  await expect(cardTitle(page, 'rev1')).toHaveText('Q4 headcount plan')
  await expect(railRows(page, 'rev1').nth(1)).toHaveAttribute('data-mark', 'skipped')
  await page.keyboard.press('ArrowLeft')
  await expect(cardTitle(page, 'rev1')).toHaveText('Onboarding checklist')

  // The rail's sort is view state, saved at once — the layout stays saved, and a reload keeps it.
  await w.getByTestId('review-sort').click()
  await page.getByRole('menu', { name: 'Sort the queue' }).getByRole('menuitemradio', { name: /^Title/ }).click()
  await expectLayoutStored(page)
  await expect.poll(async () => (await storedReviewTab(page, 'rev1'))?.viewState).toEqual({ sort: 'title' })
  await page.reload()
  await pickInReview(page, 'rev1', 'Aisha')
  await expect(w.getByTestId('review-sort')).toContainText('Title')
})

test('no place in the queue: the large face says how many are followed up; once every task has a mark, all reviewed', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const w = widget(page, 'rev1')
  await pickInReview(page, 'rev1', 'Aisha')
  await expect(w.locator('[data-review-queue-button]')).toHaveCount(0)
  const top = w.locator('[data-widget-top-line]')
  await expect(top.getByTestId('review-widget-progress')).toHaveText('0 followed up')
  await expect(top).not.toHaveText(/[0-9]+ of [0-9]+/)
  for (let i = 0; i < 4; i++) await w.getByRole('button', { name: /^Skip/ }).click()
  await expect(top.getByTestId('review-widget-progress')).toHaveText('All 4 reviewed · 0 followed up')
})

test('the live queue: a task leaving the filter leaves the rail — the current one stays until the review moves on', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const w = widget(page, 'rev1')
  await pickInReview(page, 'rev1', 'Aisha')
  await expect(cardTitle(page, 'rev1')).toHaveText('Vendor contract renewal')
  await w.locator('[data-review-card]').getByRole('checkbox', { name: 'Mark complete' }).click()
  await expect(cardTitle(page, 'rev1')).toHaveText('Vendor contract renewal')
  await expect(railRows(page, 'rev1')).toHaveCount(4)
  await w.getByRole('button', { name: /^Skip/ }).click()
  await expect(cardTitle(page, 'rev1')).toHaveText('Onboarding checklist')
  await expect(railRows(page, 'rev1')).toHaveCount(3)
})

test('the widget’s lens switch: quiet while the top bar’s lens hides tasks of the filter; off, all of them', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const control = page.locator('header').getByRole('button', { name: /^Lens:/ })
  await control.click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: /^Urgent/ }).click()
  const w = widget(page, 'rev1')
  await expect(w.getByTestId('lens-switch')).toHaveCount(0)
  await pickInReview(page, 'rev1', 'Aisha', 'Ben')
  await expect(railRows(page, 'rev1')).toHaveCount(1)
  const sw = w.getByTestId('lens-switch')
  await expect(sw).toHaveAttribute('data-lens-hides', '4')
  await w.hover()
  await sw.click()
  await expect(sw).toHaveAttribute('aria-pressed', 'false')
  await expect(railRows(page, 'rev1')).toHaveCount(5)
})

test('a tab an earlier build saved with a kind or a pick opens clean: no repair, nothing to review', async ({ page }) => {
  await seedWorkspace(page, {
    ...BASE,
    layouts: [{
      name: 'Main',
      table: {
        areas: ['a b'],
        cells: [
          { id: 'a', tabs: [{ id: 'old', kind: 'review', review: { legacyPick: { tag: 'legal' } } }] },
          { id: 'b', tabs: [{ id: 'kind', kind: 'review', review: { legacyBy: 'tag' } }] },
        ],
      },
    }],
  })
  await expect(widget(page, 'old').getByTestId('review-empty')).toContainText('Pick who or what to review')
  await expect(widget(page, 'kind').getByTestId('review-empty')).toContainText('Pick who or what to review')
  await expectLayoutStored(page)
  await expect(page.getByText(/Repaired layout|Fixed \d+ layout/)).toHaveCount(0)
  await pickInReview(page, 'kind', 'Ben')
  await expect(cardTitle(page, 'kind')).toBeVisible()
  await expect(widget(page, 'kind').getByTestId('review-widget-progress')).toContainText('0 followed up')
})

test('in a cell of several widgets: no top line — the field’s row comes first and ends with the progress', async ({ page }) => {
  await seedWorkspace(page, {
    ...BASE,
    layouts: [{ name: 'Main', table: { areas: ['a'], cells: [{ id: 'a', tabs: [{ id: 'rt', kind: 'review' }, { id: 'n1', kind: 'notes' }] }] } }],
  })
  const w = widget(page, 'rt')
  await expect(w.locator('[data-widget-top-line]')).toHaveCount(0)
  await pickInReview(page, 'rt', 'Aisha')
  const row = w.locator('[data-prompt-row]')
  await expect(row.getByTestId('review-widget-progress')).toHaveText('0 followed up')
  const rowBox = await row.boundingBox()
  const hostBox = await w.boundingBox()
  const progressBox = await row.getByTestId('review-widget-progress').boundingBox()
  const fieldBox = await reviewField(page, 'rt').boundingBox()
  if (!rowBox || !hostBox || !progressBox || !fieldBox) throw new Error('the row has boxes')
  expect(Math.abs(rowBox.y - hostBox.y)).toBeLessThanOrEqual(1)
  expect(progressBox.x).toBeGreaterThan(fieldBox.x + fieldBox.width)
  await shot(page, 'rf-tabbed', wsCell(page, 'a'))
})

test('faces by size: medium — the card’s essentials; small — the filter and what’s left, a click opens it whole with the field', async ({ page }) => {
  await seedWorkspace(page, {
    ...BASE,
    layouts: [{
      name: 'Faces',
      table: {
        areas: ['med notes', 'small notes'],
        cols: [480, 1000],
        rows: [{ px: 300 }, { px: 80 }],
        cells: [
          { id: 'med', tabs: [{ id: 'rm', kind: 'review' }] },
          { id: 'small', tabs: [{ id: 'rs', kind: 'review' }] },
          { id: 'notes', tabs: [{ id: 'n1', kind: 'notes' }] },
        ],
      },
    }],
  })
  const med = widget(page, 'rm')
  await expect(med).toHaveAttribute('data-review-face', 'medium')
  await pickInReview(page, 'rm', 'Aisha')
  await expect(med.getByTestId('review-card-title')).toHaveText('Vendor contract renewal')
  await expect(med.getByTestId('review-widget-progress')).toHaveText('0 followed up')
  await expect(med.getByTestId('review-facts')).toContainText('Waiting')
  await expect(med.locator('[data-review-row]')).toHaveCount(0)
  await shot(page, 'review-widget-medium', wsCell(page, 'med'))

  const small = widget(page, 'rs')
  await expect(small).toHaveAttribute('data-review-face', 'small')
  await expect(small.getByTestId('review-small-face')).toHaveText('Review · Pick who or what')

  // A click opens the whole widget over the cell; its field works there, its list over the popover.
  await small.click()
  const popover = page.getByTestId('widget-face-popover')
  await expect(popover).toBeVisible()
  const whole = popover.locator('[data-review-widget="rs"]')
  await expect(whole).toHaveAttribute('data-review-face', 'large')
  const field = whole.getByRole('textbox', { name: 'Review filter' })
  await field.click()
  await expect(popup(page)).toBeVisible()
  await field.pressSequentially('ais')
  await field.press('Enter')
  await field.pressSequentially('ben')
  await field.press('Enter')
  await expect(field).toHaveValue('@Aisha or @Ben ')
  await expect(popover).toBeVisible()
  await expect(whole.getByTestId('review-widget-progress')).toHaveText('Queue · 0 followed up')
  // Leaving the field, then Esc closes the popover.
  await field.blur()
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(small.getByTestId('review-small-face')).toContainText('Review · @Aisha or @Ben')
  await expect(small.getByTestId('review-small-caption')).toHaveText('5 left · 0 followed up')
})
