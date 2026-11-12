import { expect, test, type Locator, type Page } from '@playwright/test'
import { box } from './fixtures/geometry'
import { taskRowByTitle } from './fixtures/seed'
import { expectOpenLayout, reviewField, seedWorkspace, wsListWidget, wsRow, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Boards BJ, BL, task layout A · the one task layout in a real browser: the
 * task editor at 760px with the facts rail (268px) on the left — Priority,
 * Status, People, Tags, Due, each under a plain heading — and the writing on
 * the right — Notes and Subtasks, then the dock: Status updates and the
 * follow-up rows (Next, Last) —; the rail and the dock stay put while Notes
 * and Subtasks scroll, so the follow-up rows and the add line are in view
 * without scrolling for a typical task and after the writing of a long one
 * is scrolled; an empty task still shows the Notes box and every heading;
 * under 600px of body the rail goes above the writing, its facts two up.
 * The header's ⋯ (Duplicate, Make subtask of…, Delete); the footer's Mark
 * followed up and Done. The review card in the same layout (the Review
 * widget, reached by a list's Review these N tasks): queue (300px), facts,
 * writing left to right; Next follow-up's quick row is 1w 2w 1m 3m (no None
 * — its × clears it); ⏎ in the update line still follows up. The person task
 * dialog's Review button (a jump; no check-in buttons, widget feedback 2B).
 * Board BL's own checks are `reviewer-layout.spec.ts`; the sizes and the
 * overlaps of task layout A, `task-layout-a.spec.ts`.
 */

const TAB = 'l1'
const MANY_SUBTASKS = Array.from({ length: 14 }, (_, i) => ({ title: `Step ${i + 1}`, done: i < 3 }))
const MANY_UPDATES = Array.from({ length: 9 }, (_, i) => ({ text: `Update ${i + 1}`, inDays: -(9 - i) }))
const RAIL_ORDER = ['priority', 'status', 'people', 'tags', 'due']

const SEED: WorkspaceSeed = {
  people: ['Aisha', 'Ben'],
  tags: ['Project: Atlas', 'legal'],
  statuses: ['Waiting', 'In progress'],
  tasks: [
    {
      // A typical task (the board's): 4 subtasks, 3 updates, 2 people, 2 tags.
      title: 'Vendor contract renewal',
      people: ['Aisha', 'Ben'],
      tags: ['Project: Atlas', 'legal'],
      status: 'Waiting',
      urgent: true,
      dueInDays: -3,
      followupInDays: 7,
      lastFollowupInDays: -14,
      notes: 'Legal wants the indemnity clause reworded before we sign.\n- Ask Ben for the 2025 terms\n- Check auto-renew notice (60 days?)',
      subtasks: [
        { title: 'Get 2025 terms from Ben', done: true },
        { title: 'Redline indemnity clause', done: true },
        { title: 'Vendor sign-off' },
        { title: 'File signed copy' },
      ],
      statusUpdates: [
        { text: 'Sent redlines to vendor; waiting on their legal.', inDays: -6 },
        { text: 'Ben confirmed budget for another 12 months.', inDays: -14 },
        { text: 'Renewal notice received.', inDays: -28 },
      ],
    },
    {
      title: 'Long running migration',
      people: ['Aisha'],
      followupInDays: 0,
      notes: Array.from({ length: 24 }, (_, i) => `Line ${i + 1} of the plan`).join('\n'),
      subtasks: MANY_SUBTASKS,
      statusUpdates: MANY_UPDATES,
    },
    { title: 'Empty task', people: ['Aisha'] },
  ],
  listDefinitions: [{ name: 'Aisha 1:1', grouping: 'none', sort: 'manual' }],
  layouts: [{
    name: 'Main',
    columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: TAB, kind: 'lens', listDefIdx: 0 }] })] }],
  }, {
    // Where a Review button jumps: a Review widget filling the window (its large face).
    name: 'Review',
    columns: [{ id: 'r1', rows: [wsRow({ id: 'rk', tabs: [{ id: 'rv', kind: 'review' }] })] }],
  }],
}

const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit task' })

async function openEditor(page: Page, title = 'Vendor contract renewal'): Promise<Locator> {
  await taskRowByTitle(page, title).locator(`span[data-task-title="${title}"]`).dblclick()
  await expect(editor(page)).toBeVisible()
  // Measure once the open animation has settled.
  await editor(page).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
  return editor(page)
}

/** The scroll state of `el`: whether it overflows, and whether it sits at its bottom. */
async function scrollState(el: Locator) {
  return el.evaluate((node) => ({
    overflows: node.scrollHeight > node.clientHeight + 1,
    atBottom: Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) <= 2,
  }))
}

/** `inner` lies wholly inside `outer`'s box (½px of rounding). */
async function expectWithin(inner: Locator, outer: Locator) {
  const [i, o] = [await box(inner), await box(outer)]
  expect(i.y).toBeGreaterThanOrEqual(o.y - 0.5)
  expect(i.y + i.height).toBeLessThanOrEqual(o.y + o.height + 0.5)
}

test.describe('the task editor', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the header: the checkbox, the title and the ⋯ / × share one centre line', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page)
    const centre = async (el: Locator) => { const b = await box(el); return b.y + b.height / 2 }
    const check = await centre(dialog.getByRole('checkbox', { name: 'Mark complete' }))
    expect(Math.abs(await centre(dialog.getByRole('textbox').first()) - check)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(await centre(dialog.getByRole('button', { name: 'More actions' })) - check)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(await centre(dialog.getByRole('button', { name: 'Close' })) - check)).toBeLessThanOrEqual(0.5)
  })

  test('760px: the facts rail (268px) left in its order, the writing right; the follow-up rows in view without scrolling', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page)
    expect(await dialog.evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(760)

    const rail = dialog.locator('[data-task-rail]')
    const writing = dialog.locator('[data-task-writing]')
    const [r, w] = [await box(rail), await box(writing)]
    expect(Math.round(r.width)).toBe(268)
    expect(r.x + r.width).toBeLessThanOrEqual(w.x + 0.5)
    // The writing column keeps room to write in (the card stays 760px).
    expect(w.width).toBeGreaterThanOrEqual(460)
    // The rail's facts, top to bottom, each header in the one muted label colour (board BL).
    const facts = rail.locator('[data-fact]')
    expect(await facts.evaluateAll((els) => els.map((el) => el.getAttribute('data-fact')))).toEqual(RAIL_ORDER)
    const colours = await facts.evaluateAll((els) => els.map((el) => getComputedStyle(el.querySelector('[id]')!).color))
    expect(new Set(colours).size).toBe(1)
    // The writing: Notes, Subtasks, Status updates.
    const notes = writing.locator('[data-task-notes]')
    const subtasks = writing.locator('[data-subtasks]')
    const updates = writing.locator('[data-status-updates]')
    expect((await box(notes)).y).toBeLessThan((await box(subtasks)).y)
    expect((await box(subtasks)).y).toBeLessThan((await box(updates)).y)

    // A typical task: nothing scrolls, the follow-up rows (in the dock) and Mark followed up (the footer's) are in view.
    expect((await scrollState(rail)).overflows).toBe(false)
    const followup = dialog.locator('[data-task-followup]')
    await expectWithin(followup, dialog.locator('[data-task-dock]'))
    await expect(followup).toBeInViewport({ ratio: 1 })
    await expect(dialog.getByRole('button', { name: 'Mark followed up' })).toBeInViewport({ ratio: 1 })
    // One date look: the rows' words, the full date in the tooltip.
    await expect(rail.locator('[data-fact="due"]')).toContainText('3 days late')
    await expect(followup.getByRole('textbox', { name: 'Last follow-up' })).toHaveValue(/.+/)
    await expect(followup).toContainText('2 weeks ago')
    await page.screenshot({ path: test.info().outputPath('editor-bj.png') })
  })

  test('a long task: Notes and Subtasks scroll above the dock, the rail stays put; the checklist and the log scroll inside', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, 'Long running migration')
    const writing = dialog.locator('[data-task-writing]')
    const scroll = writing.locator('[data-task-writing-scroll]')
    expect((await scrollState(scroll)).overflows).toBe(true)
    const followup = dialog.locator('[data-task-followup]')
    const addLine = dialog.getByRole('textbox', { name: 'New status update' })
    const [before, lineBefore] = [await box(followup), await box(addLine)]
    await scroll.evaluate((node) => { node.scrollTop = node.scrollHeight })
    expect((await box(followup)).y).toBe(before.y)
    await expect(followup).toBeInViewport({ ratio: 1 })
    await expect(dialog.getByRole('button', { name: 'Mark followed up' })).toBeInViewport({ ratio: 1 })
    // The dock doesn't scroll with the writing: its add line stays where it was, in view.
    expect((await box(addLine)).y).toBe(lineBefore.y)
    await expect(addLine).toBeInViewport({ ratio: 1 })

    // A follow-up due today reads as a row's: `Today`, in the follow-up colour.
    await expect(followup.locator('[data-tone="followup-today"]')).toHaveText('Today')

    const checklistScroll = writing.locator('[data-subtasks] > div').last()
    expect((await scrollState(checklistScroll)).overflows).toBe(true)
    const list = dialog.getByRole('list', { name: 'Status updates' })
    await expect(list.locator('[data-status-update]').first()).toContainText('Update 1')
    await expect(list.locator('[data-status-update]').last()).toContainText('Update 9')
    expect((await scrollState(list)).atBottom).toBe(true)
    await page.screenshot({ path: test.info().outputPath('editor-bj-long.png') })
  })

  test('an empty task: the Notes box and every heading are there; a click in the box types into it', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, 'Empty task')
    const writing = dialog.locator('[data-task-writing]')
    // No one-line sections any more (board BL): the Notes box with its placeholder, and each label drawn.
    await expect(writing.getByRole('button', { name: 'Add notes' })).toHaveCount(0)
    const notes = writing.locator('[data-task-notes] .cm-content')
    await expect(notes).toBeVisible()
    await expect(writing.locator('[data-task-notes] .cm-placeholder')).toHaveText('Add notes…')
    for (const label of ['Notes', 'Subtasks', 'Status updates']) {
      expect((await box(writing.getByText(label, { exact: true }))).height).toBeGreaterThanOrEqual(10)
    }
    for (const line of [writing.getByPlaceholder('Add subtask'), writing.getByRole('textbox', { name: 'New status update' })]) {
      expect((await box(line)).height).toBeLessThanOrEqual(36)
    }
    // The writing column fills the body; Notes is one line, the room to spare stays above the dock (task layout A).
    const [rail, body, column] = [await box(dialog.locator('[data-task-rail]')), await box(dialog.locator('[data-task-body]')), await box(writing)]
    expect(Math.abs(rail.height - body.height)).toBeLessThan(2)
    expect(Math.abs(column.height - body.height)).toBeLessThan(2)
    expect((await box(writing.locator('[data-task-notes-box]'))).height).toBeLessThan(40)
    await page.screenshot({ path: test.info().outputPath('editor-bl-empty.png') })

    await notes.click()
    await expect(notes).toBeFocused()
    await page.keyboard.type('First note')
    await expect(notes).toContainText('First note')
    await expect(writing.locator('[data-task-notes] .cm-placeholder')).toHaveCount(0)
  })

  test('the people picker opens under the chips, picks, and closes on Esc without closing the editor', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, 'Empty task')
    const add = dialog.getByRole('button', { name: 'Add person' })
    await add.click()
    const picker = page.locator('[data-anchored-picker]')
    await expect(picker).toBeVisible()
    expect((await box(picker)).y).toBeGreaterThan((await box(add)).y)
    await picker.getByText('Ben', { exact: true }).click()
    await expect(dialog.locator('[data-task-people]')).toContainText('Ben')
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(dialog).toBeVisible()
  })

  test('the header’s ⋯: Duplicate, Make subtask of…, Delete; the footer is Mark followed up and Done', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page)
    const footer = dialog.locator('button', { hasText: 'Done' })
    await expect(footer).toBeVisible()
    const mark = dialog.getByRole('button', { name: 'Mark followed up' })
    expect((await box(mark)).x + (await box(mark)).width).toBeLessThanOrEqual((await box(footer)).x)
    expect(Math.abs((await box(mark)).y + (await box(mark)).height / 2 - ((await box(footer)).y + (await box(footer)).height / 2))).toBeLessThan(2)
    await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Duplicate', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'More actions' }).click()
    const menu = page.getByRole('menu', { name: 'Task actions' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Duplicate', 'Make subtask of…', 'Delete'])
    await menu.getByRole('menuitem', { name: 'Delete' }).click()
    // The same confirm as the task menu's Delete.
    await page.getByRole('dialog', { name: 'Delete task' }).getByRole('button', { name: 'Delete' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(taskRowByTitle(page, 'Vendor contract renewal')).toHaveCount(0)
  })

  test('under 600px of body the rail goes above the writing, its facts two up; the dock with the follow-up rows last', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await openEditor(page)
    await page.setViewportSize({ width: 580, height: 900 })
    // The resize swaps the card's open animation for the sheet's: one it cancels settles too.
    await editor(page).evaluate((el) => Promise.allSettled(el.getAnimations({ subtree: true }).map((a) => a.finished)))
    const rail = editor(page).locator('[data-task-rail]')
    const writing = editor(page).locator('[data-task-writing]')
    const [r, w] = [await box(rail), await box(writing)]
    expect(w.y).toBeGreaterThanOrEqual(r.y + r.height - 1)
    // The dock is the writing's last part there, in the one scroll.
    const [s, d] = [await box(writing.locator('[data-task-writing-scroll]')), await box(writing.locator('[data-task-dock]'))]
    expect(d.y).toBeGreaterThanOrEqual(s.y + s.height - 1)
    const [line, next] = [await box(writing.getByRole('textbox', { name: 'New status update' })), await box(writing.getByRole('textbox', { name: 'Next follow-up' }))]
    expect(next.y).toBeGreaterThan(line.y + line.height)
    const [priority, status] = [await box(rail.locator('[data-fact="priority"]')), await box(rail.locator('[data-fact="status"]'))]
    expect(Math.abs(priority.y - status.y)).toBeLessThan(2)
    expect(status.x).toBeGreaterThan(priority.x + priority.width - 1)
    await page.screenshot({ path: test.info().outputPath('editor-bj-narrow.png') })
  })
})

test.describe('the review card', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('queue, facts and writing left to right; Next’s quick row has no None; × clears it; ⏎ follows up', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await wsListWidget(page, TAB).waitFor({ state: 'visible' })
    await wsTab(page, TAB).click({ button: 'right' })
    await page.getByRole('menu').getByRole('menuitem', { name: /Review these 3 tasks/ }).click()
    await expectOpenLayout(page, 'Review')
    const deck = page.locator('[data-review-widget="rv"]')
    await expect(deck.getByTestId('review-card-title')).toHaveText('Vendor contract renewal')
    await deck.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
    const card = deck.locator('[data-review-card]')
    const [queue, rail, writing] = [
      await box(deck.locator('[data-review-rail]')),
      await box(card.locator('[data-task-rail]')),
      await box(card.locator('[data-task-writing]')),
    ]
    expect(Math.round(queue.width)).toBe(300)
    expect(Math.round(rail.width)).toBe(268)
    expect(queue.x + queue.width).toBeLessThanOrEqual(rail.x + 0.5)
    expect(rail.x + rail.width).toBeLessThanOrEqual(writing.x + 0.5)
    expect(await card.locator('[data-task-rail] [data-fact]').evaluateAll((els) => els.map((el) => el.getAttribute('data-fact')))).toEqual(RAIL_ORDER)

    const followup = card.locator('[data-task-followup]')
    await expect(followup.getByRole('group', { name: 'Quick follow-up intervals' }).getByRole('button')).toHaveText(['1w', '2w', '1m', '3m'])
    await expect(deck.getByRole('button', { name: 'No next follow-up' })).toHaveCount(0)
    await expect(followup.getByRole('button', { name: 'Mark followed up' })).toHaveCount(0)
    await expect(deck.getByRole('button', { name: 'Mark followed up' })).toHaveCount(1)
    await expect(followup).toBeInViewport({ ratio: 1 })
    const updateLine = deck.getByLabel('Status update · today')
    await expect(updateLine).toBeFocused()
    await expect(updateLine).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: test.info().outputPath('review-card-bj.png') })

    // The field's × (shown on its hover and focus): no next follow-up (Mark followed up then leaves none).
    await followup.getByRole('textbox', { name: 'Next follow-up' }).focus()
    await followup.getByRole('button', { name: 'Clear next follow-up' }).click()
    await expect(followup.getByRole('textbox', { name: 'Next follow-up' })).toHaveValue('')
    // No hint over the footer any more: the field's own help says it.
    await expect(deck.getByTestId('review-hint')).toHaveCount(0)
    await expect(followup.locator('[data-followup-row="next"] [aria-live]')).toHaveText('No next follow-up')

    // ⏎ keeps its meaning: the update and the follow-up, then the next card, its line focused.
    await updateLine.fill('Legal is on it')
    await updateLine.press('Enter')
    await expect(deck.getByTestId('review-card-title')).toHaveText('Long running migration')
    await expect(deck.getByLabel('Status update · today')).toBeFocused()
  })
})

test.describe('the person task dialog', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Review alone under the title (no check-ins); Review closes the dialog and jumps to the Review widget with @<name>', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await wsListWidget(page, TAB).waitFor({ state: 'visible' })
    const avatar = taskRowByTitle(page, 'Vendor contract renewal').locator('[data-person-avatar="Aisha"]')
    await avatar.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Show tasks' }).click()
    const dialog = page.locator('[data-task-dialog]')
    await expect(dialog).toBeVisible()
    const actions = dialog.getByRole('group', { name: 'Actions for Aisha' })
    await expect(actions.getByRole('button')).toHaveText(['Review'])
    await expect(dialog.getByRole('button', { name: /Check-in|Paste reply/ })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Close Esc' })).toBeVisible()

    await actions.getByRole('button', { name: 'Review with Aisha' }).click()
    await expect(dialog).toHaveCount(0)
    await expectOpenLayout(page, 'Review')
    await expect(reviewField(page, 'rv')).toHaveValue('@Aisha')
    await expect(page.locator('[data-review-widget="rv"]').getByLabel('Status update · today')).toBeFocused()
  })
})
