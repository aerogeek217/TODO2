import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { expectLayoutStep, expectLayoutStored, openCellMenu, pickInReview, pickWidgetKind, reviewField, seedWorkspace, wsCell, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Item 12 · the Review widget (boards BK / BM) in the real browser: added
 * from the cell's ⋯, its prompt row — the kind as the row's label (a small
 * menu, saved with the layout) and a field typed in like a list's Prompt for
 * (several picks, temporary: gone with a reload) —, a follow-up from the
 * widget (⏎ in the update line), the live queue dropping a task that leaves
 * the picks, and its faces by the cell's size (large: rail + card; medium:
 * the card's essentials; small: the picks and what's left, a click opening
 * the whole widget over the cell). With `REVIEW_SHOTS=<folder>` it also
 * saves screenshots (dark, 1440 × 900) for the design review.
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
  people: [{ name: 'Aisha', color: '#c8743a' }, { name: 'Ben', color: '#5a8fd8' }],
  tags: ['legal'],
  statuses: ['Waiting'],
  tasks: TASKS,
}

const widget = (page: Page, tabId: string) => page.locator(`[data-review-widget="${tabId}"]`)
const cardTitle = (page: Page, tabId: string) => widget(page, tabId).getByTestId('review-card-title')
const railRows = (page: Page, tabId: string) => widget(page, tabId).locator('[data-review-row]')
const chips = (w: Locator) => w.locator('[data-prompt-row]').getByRole('button', { name: /^Remove / })
const panel = (page: Page) => page.locator('[data-prompt-panel]')

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

/** A Review widget (by Person, saved) beside a Notes cell. */
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

test('added from the cell’s ⋯: by Person, nothing picked — “Pick a person to review”; two people typed, a task followed up', async ({ page }) => {
  await seedWorkspace(page, {
    ...BASE,
    layouts: [{ name: 'Main', table: { areas: ['a'], cells: [{ id: 'a', tabs: [{ id: 'n1', kind: 'notes' }] }] } }],
  })
  await openCellMenu(page, 'a')
  await pickWidgetKind(page, 'Change widget', 'Review')
  const w = page.locator('[data-review-widget]')
  await expect(w).toHaveAttribute('data-review-by', 'person')
  // Its own top line (alone in the cell): the name — no progress, no lens switch yet — over the prompt row.
  await expect(w.locator('[data-widget-top-line]')).toContainText('Review')
  await expect(w.getByTestId('review-widget-progress')).toHaveCount(0)
  await expect(w.getByTestId('review-by')).toHaveText('Person')
  const empty = w.getByTestId('review-empty')
  await expect(empty).toContainText('Pick a person to review')
  await expect(empty).toContainText('Type in the Person field above. The pick is temporary and isn’t saved.')
  await expect(page.getByText(/pick someone/i)).toHaveCount(0)
  const field = w.getByRole('combobox', { name: 'People to review' })
  await expect(field).toHaveAttribute('placeholder', 'Pick a person…')
  await page.mouse.move(0, 0)
  await shot(page, 'bm-empty')

  // The empty state's button focuses the field; its options open under it, each person with their open tasks.
  await empty.getByRole('button', { name: 'Pick a person' }).click()
  await expect(field).toBeFocused()
  const options = panel(page).getByRole('option')
  await expect(options).toHaveText([/Aisha\s*4$/, /Ben\s*2$/])
  // The panel hangs under the field, its left edge on the field's.
  const fieldBox = await w.locator('[data-prompt-row] > div').first().boundingBox()
  const panelBox = await panel(page).boundingBox()
  if (!fieldBox || !panelBox) throw new Error('the field and its panel have boxes')
  expect(panelBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height)
  expect(panelBox.y - (fieldBox.y + fieldBox.height)).toBeLessThanOrEqual(12)
  expect(Math.abs(panelBox.x - fieldBox.x)).toBeLessThanOrEqual(2)

  // Type to match; ⏎ takes the first.
  await field.fill('ais')
  await expect(options).toHaveText([/Aisha/])
  await field.press('Enter')
  await expect(chips(w)).toHaveCount(1)
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  await expect(w.getByTestId('review-widget-progress')).toHaveText('0 followed up')
  await expect(w.locator('[data-review-row]')).toHaveCount(4)
  await expect(w.locator('[data-review-row]').first()).toHaveAttribute('aria-current', 'true')
  await field.fill('be')
  await shot(page, 'bm-typing')
  await field.press('Enter')
  await expect(chips(w)).toHaveCount(2)
  // Aisha or Ben: every open task of either, each once.
  await expect(w.getByTestId('review-widget-progress')).toHaveText('0 followed up')
  await expect(w.locator('[data-review-row]')).toHaveCount(5)
  await field.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  const tabId = await w.getAttribute('data-review-widget') ?? ''
  await expect(railRows(page, tabId)).toHaveCount(5)
  await page.mouse.move(0, 0)
  await shot(page, 'bm-two-people')

  // A follow-up from the widget: ⏎ in the update line.
  const line = w.getByLabel('Status update · today')
  await line.click()
  await line.fill('Legal signed off the clause')
  await page.keyboard.press('Enter')
  await expect(cardTitle(page, tabId)).toHaveText('Q4 headcount plan')
  await expect(railRows(page, tabId).nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(w.getByTestId('review-widget-progress')).toHaveText('1 followed up')
  await expect.poll(async () => isToday((await storedTask(page, 'Vendor contract renewal'))?.lastFollowupAt)).toBe(true)
})

test('the kind from the row’s label: Tag — the picks go, the kind is saved at once (an undo step); a reload keeps the kind, not the picks', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const w = widget(page, 'rev1')
  await pickInReview(page, 'rev1', 'Aisha')
  await expect(chips(w)).toHaveCount(1)
  await expect(railRows(page, 'rev1')).toHaveCount(4)
  // Picking writes nothing to the layout: no undo step, and its stored row holds no pick.
  await expect(page.locator('[data-snackbar-live]').getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
  expect((await storedReviewTab(page, 'rev1'))?.config).toEqual({ by: 'person' })

  await w.getByTestId('review-by').click()
  const menu = page.getByRole('menu', { name: 'Review by' })
  await expect(menu.getByRole('menuitemradio')).toHaveText([/Person/, /Tag/, /Status/, /List/])
  await expect(menu.getByRole('menuitemradio', { name: 'Person' })).toHaveAttribute('aria-checked', 'true')
  await page.mouse.move(0, 0)
  await shot(page, 'bm-kind-menu')
  await menu.getByRole('menuitemradio', { name: 'Tag' }).click()
  await expect(w).toHaveAttribute('data-review-by', 'tag')
  await expect(w.getByTestId('review-by')).toHaveText('Tag')
  // The menu hands the focus back to the label; Tab goes on to the field.
  await expect(w.getByTestId('review-by')).toBeFocused()
  await expect(chips(w)).toHaveCount(0)
  await expect(w.getByTestId('review-empty')).toContainText('Pick a tag to review')
  await expect(w.getByRole('button', { name: 'Pick a tag' })).toBeVisible()
  // The kind is the widget's setting: layout config, saved at once as one undo step.
  await expectLayoutStep(page, 'Review by Tag')
  await expect.poll(async () => (await storedReviewTab(page, 'rev1'))?.config).toEqual({ by: 'tag' })

  await pickInReview(page, 'rev1', 'legal')
  await expect(railRows(page, 'rev1')).toHaveText([/Vendor contract/, /Hiring scorecard/])
  // Skip one, so the review has a place and a mark.
  await w.getByRole('button', { name: /^Skip/ }).click()
  await expect(cardTitle(page, 'rev1')).toHaveText('Hiring scorecard')

  await page.reload()
  await expect(w).toHaveAttribute('data-review-by', 'tag')
  await expect(chips(w)).toHaveCount(0)
  await expect(w.getByTestId('review-empty')).toContainText('Pick a tag to review')
  await expectLayoutStored(page)
  const stored = await storedReviewTab(page, 'rev1')
  expect(stored?.config).toEqual({ by: 'tag' })
  expect(stored?.viewState?.currentId).toBeUndefined()
  expect(stored?.viewState?.skipped).toBeUndefined()
  // Picked again, the review starts over: no – mark from before.
  await pickInReview(page, 'rev1', 'legal')
  await expect(cardTitle(page, 'rev1')).toHaveText('Vendor contract renewal')
  await expect(railRows(page, 'rev1').first()).not.toHaveAttribute('data-mark')
})

test('the field’s keyboard: Tab from the label, ↓ and ⏎ pick, Backspace takes the last chip back, × clears all, Esc closes', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const w = widget(page, 'rev1')
  const field = reviewField(page, 'rev1')
  await w.getByTestId('review-by').focus()
  await page.keyboard.press('Tab')
  await expect(field).toBeFocused()
  await expect(panel(page)).toBeVisible()
  // ↓ highlights the first option; ⏎ picks it and keeps the focus (and the list) there.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(chips(w)).toHaveCount(1)
  await expect(w.locator('[data-prompt-row]')).toContainText('Aisha')
  await expect(field).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(chips(w)).toHaveCount(2)
  await expect(railRows(page, 'rev1')).toHaveCount(5)
  // Backspace in the empty text removes the last chip.
  await page.keyboard.press('Backspace')
  await expect(chips(w)).toHaveCount(1)
  await expect(railRows(page, 'rev1')).toHaveCount(4)
  // Esc closes the list and leaves the field.
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await expect(field).not.toBeFocused()
  // The × at the field's end clears every pick: back to the prompt.
  await w.getByRole('button', { name: 'Clear Person' }).click()
  await expect(chips(w)).toHaveCount(0)
  await expect(w.getByTestId('review-empty')).toContainText('Pick a person to review')
  await expect(field).toBeFocused()
})

test('large face: the rail and the deck’s card; ⏎ in the update line follows up and opens the next card; ← / → step from the rail', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const w = widget(page, 'rev1')
  await pickInReview(page, 'rev1', 'Aisha')
  await expect(w).toHaveAttribute('data-review-face', 'large')
  await expect(railRows(page, 'rev1')).toHaveText([/Vendor contract/, /Q4 headcount/, /Onboarding checklist/, /Hiring scorecard/])
  await expect(cardTitle(page, 'rev1')).toHaveText('Vendor contract renewal')
  await shot(page, 'review-widget-large', page.locator('[data-ws-area]'))

  const line = w.getByLabel('Status update · today')
  await line.click()
  await line.fill('Legal signed off the clause')
  await page.keyboard.press('Enter')
  await expect(cardTitle(page, 'rev1')).toHaveText('Q4 headcount plan')
  await expect(railRows(page, 'rev1').first()).toHaveAttribute('data-mark', 'done')
  await expect(railRows(page, 'rev1').nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(w.getByTestId('review-widget-progress')).toHaveText('1 followed up')
  await expect.poll(async () => isToday((await storedTask(page, 'Vendor contract renewal'))?.lastFollowupAt)).toBe(true)
  // In the widget the focus moves on to the next card's update line.
  await expect(w.getByLabel('Status update · today')).toBeFocused()

  await railRows(page, 'rev1').nth(1).focus()
  await page.keyboard.press('ArrowRight')
  await expect(cardTitle(page, 'rev1')).toHaveText('Onboarding checklist')
  await expect(railRows(page, 'rev1').nth(1)).toHaveAttribute('data-mark', 'skipped')
  await page.keyboard.press('ArrowLeft')
  await expect(cardTitle(page, 'rev1')).toHaveText('Q4 headcount plan')

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
  await expect(w).toHaveAttribute('data-review-face', 'large')
  await expect(w.locator('[data-review-queue-button]')).toHaveCount(0)
  const top = w.locator('[data-widget-top-line]')
  await expect(top.getByTestId('review-widget-progress')).toHaveText('0 followed up')
  await expect(top).not.toHaveText(/[0-9]+ of [0-9]+/)
  for (const next of ['Q4 headcount plan', 'Onboarding checklist', 'Hiring scorecard']) {
    await w.getByRole('button', { name: /^Skip/ }).click()
    await expect(cardTitle(page, 'rev1')).toHaveText(next)
  }
  await w.getByRole('button', { name: /^Skip/ }).click()
  await expect(top.getByTestId('review-widget-progress')).toHaveText('All 4 reviewed · 0 followed up')
  await expect(top.getByTestId('review-widget-progress').locator('strong')).toHaveText('All 4 reviewed')
})

test('the live queue: a task leaving the picks leaves the rail — the current one stays until the review moves on', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const w = widget(page, 'rev1')
  await pickInReview(page, 'rev1', 'Aisha')
  await expect(cardTitle(page, 'rev1')).toHaveText('Vendor contract renewal')
  // Completing the current task (its box): it stays on as the current card…
  await w.locator('[data-review-card]').getByRole('checkbox', { name: 'Mark complete' }).click()
  await expect(cardTitle(page, 'rev1')).toHaveText('Vendor contract renewal')
  await expect(railRows(page, 'rev1')).toHaveCount(4)
  // …and leaves the rail once the review moves on.
  await w.getByRole('button', { name: /^Skip/ }).click()
  await expect(cardTitle(page, 'rev1')).toHaveText('Q4 headcount plan')
  await expect(railRows(page, 'rev1')).toHaveText([/Q4 headcount/, /Onboarding checklist/, /Hiring scorecard/])
})

test('the widget’s lens switch: quiet while the top bar’s lens hides tasks of the picks (2A); off, all of them', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const control = page.locator('header').getByRole('button', { name: /^Lens:/ })
  await control.click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: /^Urgent/ }).click()
  const w = widget(page, 'rev1')
  // Nothing picked: no switch.
  await expect(w.getByTestId('lens-switch')).toHaveCount(0)
  await pickInReview(page, 'rev1', 'Aisha', 'Ben')
  await expect(railRows(page, 'rev1')).toHaveCount(1)
  const sw = w.getByTestId('lens-switch')
  await expect(sw).toHaveAttribute('data-lens-hides', '4')
  // Quiet (2A): shown on the cell's hover.
  await w.hover()
  await sw.click()
  await expect(sw).toHaveAttribute('aria-pressed', 'false')
  await expect(railRows(page, 'rev1')).toHaveCount(5)
})

test('a config an earlier build saved (one pick): opens by that pick’s kind, the layout saved, nothing picked', async ({ page }) => {
  await seedWorkspace(page, {
    ...BASE,
    layouts: [{ name: 'Main', table: { areas: ['a'], cells: [{ id: 'a', tabs: [{ id: 'old', kind: 'review', review: { legacyPick: { tag: 'legal' } } }] }] } }],
  })
  const w = widget(page, 'old')
  await expect(w).toHaveAttribute('data-review-by', 'tag')
  await expect(w.getByTestId('review-empty')).toContainText('Pick a tag to review')
  await expectLayoutStored(page)
  await expect(page.getByText(/Repaired layout/)).toHaveCount(0)
})

test('in a cell of several widgets: no top line — the prompt row comes first and ends with the progress', async ({ page }) => {
  await seedWorkspace(page, {
    ...BASE,
    layouts: [{ name: 'Main', table: { areas: ['a'], cells: [{ id: 'a', tabs: [{ id: 'rt', kind: 'review' }, { id: 'n1', kind: 'notes' }] }] } }],
  })
  const w = widget(page, 'rt')
  await expect(w.locator('[data-widget-top-line]')).toHaveCount(0)
  await pickInReview(page, 'rt', 'Aisha')
  const row = w.locator('[data-prompt-row]')
  await expect(row.getByTestId('review-widget-progress')).toHaveText('0 followed up')
  // The row is the widget's first; the progress sits at its right end, after the field.
  const rowBox = await row.boundingBox()
  const hostBox = await w.boundingBox()
  const progressBox = await row.getByTestId('review-widget-progress').boundingBox()
  const fieldBox = await reviewField(page, 'rt').boundingBox()
  if (!rowBox || !hostBox || !progressBox || !fieldBox) throw new Error('the prompt row has boxes')
  expect(Math.abs(rowBox.y - hostBox.y)).toBeLessThanOrEqual(1)
  expect(progressBox.x).toBeGreaterThan(fieldBox.x + fieldBox.width)
  await shot(page, 'bm-tabbed', wsCell(page, 'a'))
})

test('faces by size: medium — the card’s essentials and the update line; small — the picks and what’s left, a click opens it whole with the field', async ({ page }) => {
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
  await shot(page, 'bm-medium-empty', wsCell(page, 'med'))
  await pickInReview(page, 'rm', 'Aisha')
  await expect(med.getByTestId('review-card-title')).toHaveText('Vendor contract renewal')
  await expect(med.getByTestId('review-widget-progress')).toHaveText('0 followed up')
  await expect(med.locator('[data-widget-top-line]')).not.toHaveText(/[0-9]+ of [0-9]+/)
  await expect(med.getByTestId('review-facts')).toContainText('Waiting')
  await expect(med.locator('[data-review-row]')).toHaveCount(0)
  await shot(page, 'review-widget-medium', wsCell(page, 'med'))

  // Small, nothing picked: what to do, in the kind's words.
  const small = widget(page, 'rs')
  await expect(small).toHaveAttribute('data-review-face', 'small')
  await expect(small.getByTestId('review-small-face')).toHaveText('Review · Pick a person')
  await shot(page, 'review-widget-small', wsCell(page, 'small'))

  // A click opens the whole widget over the cell; its field works there.
  await small.click()
  const popover = page.getByTestId('widget-face-popover')
  await expect(popover).toBeVisible()
  const whole = popover.locator('[data-review-widget="rs"]')
  await expect(whole).toHaveAttribute('data-review-face', 'large')
  const field = whole.getByRole('combobox', { name: 'People to review' })
  await field.fill('ais')
  await field.press('Enter')
  await field.fill('ben')
  await field.press('Enter')
  await expect(popover).toBeVisible()
  // The popover is under 820px wide: the queue folds into a Queue button before the progress, which opens it (task layout A).
  await expect(whole.locator('[data-review-rail]')).toHaveCount(0)
  await expect(whole.getByTestId('review-widget-progress')).toHaveText('Queue · 0 followed up')
  await expect(whole.locator('[data-prompt-row]')).not.toHaveText(/[0-9]+ of [0-9]+/)
  const queueButton = whole.getByRole('button', { name: 'Queue', exact: true })
  await expect(queueButton).toHaveAttribute('data-review-queue-button', '')
  await queueButton.click()
  await expect(queueButton).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('[data-review-queue-popover] [data-review-row]')).toHaveCount(5)
  await expect(page.locator('[data-review-queue-popover] [data-review-row]').first()).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-review-queue-popover]')).toHaveCount(0)
  await expect(popover).toBeVisible()
  await shot(page, 'review-widget-small-open')
  // Esc leaves the field first, then closes the popover.
  await field.press('Escape')
  await expect(popover).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(small.getByTestId('review-small-face')).toContainText('Review · Aisha or Ben')
  await expect(small.getByTestId('review-small-caption')).toHaveText('5 left · 0 followed up')

  // ⏎ in the medium face's update line follows up there too; the small face counts it.
  await med.getByLabel('Status update · today').fill('Signed')
  await page.keyboard.press('Enter')
  await expect(med.getByTestId('review-card-title')).toHaveText('Q4 headcount plan')
  await expect(small.getByTestId('review-small-caption')).toHaveText('4 left · 1 followed up')
})

test.describe('screenshots', () => {
  test.skip(!SHOTS, 'set REVIEW_SHOTS=<folder> to take the screenshots')

  test('the deck with its sort and lens switch', async ({ page }) => {
    await seedWorkspace(page, {
      ...BASE,
      tags: ['q4'],
      tasks: TASKS.map((t, i) => (i < 3 ? { ...t, tags: ['q4'] } : { ...t, tags: [] })),
      lenses: [{ id: 'lens-q4', name: 'Q4', predicate: { tags: [1] } }],
      listDefinitions: [{ name: 'Aisha 1:1', grouping: 'none', sort: 'manual', people: ['Aisha'], predicate: { personIds: [] } }],
      layouts: [{ name: 'Main', table: { areas: ['a'], cells: [{ id: 'a', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] } }],
    })
    const control = page.locator('header').getByRole('button', { name: /^Lens:/ })
    await control.click()
    await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: /^Q4/ }).click()
    await page.locator('[data-ws-tab="t1"]').click({ button: 'right' })
    await page.getByRole('menu').getByRole('menuitem', { name: /Review these/ }).click()
    const deck = page.locator('[data-review-deck]')
    await deck.getByTestId('review-sort').click()
    await page.getByRole('menu', { name: 'Sort the queue' }).getByRole('menuitemradio', { name: /^Next follow-up/ }).click()
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `${SHOTS}/review-deck-sort-lens.png` })
  })
})
