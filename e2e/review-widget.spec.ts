import { expect, test, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { openCellMenu, pickWidgetKind, seedWorkspace, wsCell, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Item 12 · the Review widget (board BK) in the real browser: added from
 * the cell's ⋯, a person picked on its top line, a follow-up from the
 * widget (⏎ in the update line), the live queue dropping a task that leaves
 * the pick, and its faces by the cell's size (large: rail + card; medium:
 * the card's essentials; small: the pick and what's left, a click opening
 * the whole widget over the cell). With `REVIEW_SHOTS=<folder>` it also
 * saves screenshots (dark, 1440 × 900) for the design review.
 */

const SHOTS = process.env.REVIEW_SHOTS

test.use({ viewport: { width: 1440, height: 900 } })

const TASKS: NonNullable<WorkspaceSeed['tasks']> = [
  { title: 'Vendor contract renewal', people: ['Aisha'], dueInDays: -3, followupInDays: 4, lastFollowupInDays: -14, urgent: true, notes: 'Legal wants the indemnity clause reworded before we sign.', statusUpdates: [{ text: 'Sent redlines; waiting on their legal.', inDays: -6 }], subtasks: [{ title: 'Draft redlines', done: true }, { title: 'Vendor sign-off' }, { title: 'File signed copy' }], status: 'Waiting' },
  { title: 'Q4 headcount plan', people: ['Aisha'], dueInDays: 6, followupInDays: 1 },
  { title: 'Onboarding checklist', people: ['Aisha', 'Ben'], followupInDays: 0, important: true },
  { title: 'Hiring scorecard', people: ['Aisha'], dueInDays: 9 },
  { title: 'Ben’s own task', people: ['Ben'] },
]

const BASE: Omit<WorkspaceSeed, 'layouts'> = {
  people: ['Aisha', 'Ben'],
  statuses: ['Waiting'],
  tasks: TASKS,
}

const widget = (page: Page, tabId: string) => page.locator(`[data-review-widget="${tabId}"]`)
const cardTitle = (page: Page, tabId: string) => widget(page, tabId).getByTestId('review-card-title')
const railRows = (page: Page, tabId: string) => widget(page, tabId).locator('[data-review-row]')

async function storedTask(page: Page, title: string) {
  return (await readStore<{ id: number; title: string; lastFollowupAt?: Date }>(page, 'todos')).find((t) => t.title === title)
}

const isToday = (d: Date | undefined) => !!d && new Date(d).toDateString() === new Date().toDateString()

async function shot(page: Page, name: string, target = page.locator('[data-ws-area]')) {
  if (!SHOTS) return
  await target.screenshot({ path: `${SHOTS}/${name}.png` })
}

test('added from the cell’s ⋯ with nothing picked: “Who do you want to review?”; a person picked on its top line', async ({ page }) => {
  await seedWorkspace(page, {
    ...BASE,
    layouts: [{ name: 'Main', table: { areas: ['a'], cells: [{ id: 'a', tabs: [{ id: 'n1', kind: 'notes' }] }] } }],
  })
  await openCellMenu(page, 'a')
  await pickWidgetKind(page, 'Change widget', 'Review')
  const w = page.locator('[data-review-widget]')
  await expect(w.getByTestId('review-empty')).toContainText('Who do you want to review?')
  await w.getByRole('button', { name: 'Pick someone…' }).click()
  const picker = page.getByRole('dialog', { name: 'What to review' })
  await expect(picker.getByRole('radio', { name: 'Person' })).toHaveAttribute('aria-checked', 'true')
  // Each person with their open tasks.
  await expect(picker.getByRole('option', { name: /Aisha/ })).toContainText('4')
  await shot(page, 'review-picker')
  await picker.getByPlaceholder('Search people…').fill('ais')
  await page.keyboard.press('Enter')
  await expect(picker).toHaveCount(0)
  await expect(w.getByTestId('review-pick')).toHaveText(/Aisha/)
  await expect(w.getByTestId('review-widget-progress')).toHaveText('1 of 4 · 0 followed up')
  await expect(railRows(page, await w.getAttribute('data-review-widget') ?? '')).toHaveCount(4)
  // The pick is layout config: unsaved until Save.
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName(/unsaved|Save/i)
})

function largeSeed(): WorkspaceSeed {
  return {
    ...BASE,
    tags: ['legal'],
    lenses: [{ id: 'lens-urgent', name: 'Urgent', predicate: { markers: [{ values: ['urgent'] }] } }],
    layouts: [{
      name: 'Main',
      table: {
        areas: ['rv list'],
        cols: [1000, 420],
        cells: [
          { id: 'rv', tabs: [{ id: 'rev1', kind: 'review', review: { person: 'Aisha' } }] },
          { id: 'list', tabs: [{ id: 'n1', kind: 'notes' }] },
        ],
      },
    }],
  }
}

test('large face: the rail and the deck’s card; ⏎ in the update line follows up and opens the next card; ← / → step from the rail', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const w = widget(page, 'rev1')
  await expect(w).toHaveAttribute('data-review-face', 'large')
  await expect(railRows(page, 'rev1')).toHaveText([/Vendor contract/, /Q4 headcount/, /Onboarding checklist/, /Hiring scorecard/])
  await expect(cardTitle(page, 'rev1')).toHaveText('Vendor contract renewal')
  await shot(page, 'review-widget-large')

  const line = w.getByLabel('Status update · today')
  await line.click()
  await line.fill('Legal signed off the clause')
  await page.keyboard.press('Enter')
  await expect(cardTitle(page, 'rev1')).toHaveText('Q4 headcount plan')
  await expect(railRows(page, 'rev1').first()).toHaveAttribute('data-mark', 'done')
  await expect(w.getByTestId('review-widget-progress')).toHaveText('2 of 4 · 1 followed up')
  await expect.poll(async () => isToday((await storedTask(page, 'Vendor contract renewal'))?.lastFollowupAt)).toBe(true)
  // In the widget the focus moves on to the next card's update line.
  await expect(w.getByLabel('Status update · today')).toBeFocused()

  await railRows(page, 'rev1').nth(1).focus()
  await page.keyboard.press('ArrowRight')
  await expect(cardTitle(page, 'rev1')).toHaveText('Onboarding checklist')
  await expect(railRows(page, 'rev1').nth(1)).toHaveAttribute('data-mark', 'skipped')
  await page.keyboard.press('ArrowLeft')
  await expect(cardTitle(page, 'rev1')).toHaveText('Q4 headcount plan')

  // Where it stands outlasts a reload (view state, saved at once).
  await page.reload()
  await expect(cardTitle(page, 'rev1')).toHaveText('Q4 headcount plan')
  await expect(railRows(page, 'rev1').nth(1)).toHaveAttribute('data-mark', 'skipped')
})

test('the live queue: a task leaving the pick leaves the rail — the current one stays until the review moves on', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const w = widget(page, 'rev1')
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

test('the widget’s lens switch: −N while the top bar’s lens hides tasks of the pick; off, the whole pick', async ({ page }) => {
  await seedWorkspace(page, largeSeed())
  const control = page.locator('header').getByRole('button', { name: /^Lens:/ })
  await control.click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: /^Urgent/ }).click()
  const w = widget(page, 'rev1')
  await expect(railRows(page, 'rev1')).toHaveCount(1)
  const sw = w.getByTestId('lens-switch')
  await expect(sw).toHaveText('−3')
  await sw.click()
  await expect(sw).toHaveAttribute('aria-pressed', 'false')
  await expect(railRows(page, 'rev1')).toHaveCount(4)
})

test('faces by size: medium — the card’s essentials and the update line; small — the pick and what’s left, a click opens it whole', async ({ page }) => {
  await seedWorkspace(page, {
    ...BASE,
    layouts: [{
      name: 'Faces',
      table: {
        areas: ['med notes', 'small notes'],
        cols: [480, 1000],
        rows: [{ px: 300 }, { px: 80 }],
        cells: [
          { id: 'med', tabs: [{ id: 'rm', kind: 'review', review: { person: 'Aisha' } }] },
          { id: 'small', tabs: [{ id: 'rs', kind: 'review', review: { person: 'Aisha' } }] },
          { id: 'notes', tabs: [{ id: 'n1', kind: 'notes' }] },
        ],
      },
    }],
  })
  const med = widget(page, 'rm')
  await expect(med).toHaveAttribute('data-review-face', 'medium')
  await expect(med.getByTestId('review-card-title')).toHaveText('Vendor contract renewal')
  await expect(med.getByTestId('review-facts')).toContainText('Waiting')
  await expect(med.getByTestId('review-newest-update')).toContainText('Sent redlines')
  await expect(med.locator('[data-review-row]')).toHaveCount(0)
  await shot(page, 'review-widget-medium', wsCell(page, 'med'))

  const small = widget(page, 'rs')
  await expect(small).toHaveAttribute('data-review-face', 'small')
  await expect(small.getByTestId('review-small-caption')).toHaveText('4 left · 0 followed up')
  await shot(page, 'review-widget-small', wsCell(page, 'small'))

  // ⏎ in the medium face's update line follows up there too; the small face counts it.
  await med.getByLabel('Status update · today').fill('Signed')
  await page.keyboard.press('Enter')
  await expect(med.getByTestId('review-card-title')).toHaveText('Q4 headcount plan')
  await expect(small.getByTestId('review-small-caption')).toHaveText('3 left · 1 followed up')

  await small.click()
  const popover = page.getByTestId('widget-face-popover')
  await expect(popover).toBeVisible()
  await expect(popover.locator('[data-review-widget="rs"]')).toHaveAttribute('data-review-face', 'large')
  await shot(page, 'review-widget-small-open')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
})

test.describe('screenshots', () => {
  test.skip(!SHOTS, 'set REVIEW_SHOTS=<folder> to take the screenshots')

  test('the deck with its sort and lens switch', async ({ page }) => {
    await seedWorkspace(page, {
      ...BASE,
      tags: ['q4'],
      tasks: TASKS.map((t, i) => (i < 3 ? { ...t, tags: ['q4'] } : t)),
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
