import { expect, test, type Locator, type Page } from '@playwright/test'
import { box } from './fixtures/geometry'
import { taskRowByTitle } from './fixtures/seed'
import { pickInReview, seedWorkspace, wsCell, wsListWidget, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Board BL · the reviewer, revised — the one task layout in the task
 * editor, the review dialog and the Review widget, in a real browser:
 * plain fact headings (the standard section label, no colour, no icon);
 * the Notes box always there with room for four lines; the Status updates
 * heading always there; the updates dock at the bottom of the writing,
 * straight above the footer; one left edge in the writing; the dialog
 * 1200px wide and as tall as the task (700px for a light one, up to the
 * window for a heavy one, where the writing scrolls above the dock); the
 * queue's two-line rows; the header's dot per task and its counts; the
 * widget's faces. With `REVIEWER_SHOTS=<folder>` it also saves screenshots
 * (1440 × 900, the dark theme, and a few of the light one).
 */

const SHOTS = process.env.REVIEWER_SHOTS

test.use({ viewport: { width: 1440, height: 900 } })

const LIST = 'l1'
const HEAVY_NOTES = Array.from({ length: 24 }, (_, i) => `Line ${i + 1} of the plan`).join('\n')

const TASKS: NonNullable<WorkspaceSeed['tasks']> = [
  { title: 'Q4 headcount plan', people: ['Aisha'], followupInDays: 29, dueInDays: 10, lastFollowupInDays: 0 },
  { title: 'Onboarding checklist', people: ['Aisha'], followupInDays: 0 },
  {
    // The board's typical task: notes, 4 subtasks, 3 updates, 2 people, 2 tags.
    title: 'Vendor contract renewal',
    people: ['Aisha', 'Ben'],
    tags: ['Project: Atlas', 'legal'],
    status: 'Waiting',
    urgent: true,
    dueInDays: -4,
    followupInDays: 6,
    lastFollowupInDays: -15,
    notes: 'Legal wants the indemnity clause reworded before we sign.\n- Ask Ben for the 2025 terms\n- Check auto-renew notice (60 days?)',
    subtasks: [
      { title: 'Get 2025 terms from Ben', done: true },
      { title: 'Redline indemnity clause', done: true },
      { title: 'Vendor sign-off' },
      { title: 'File signed copy' },
    ],
    statusUpdates: [
      { text: 'Sent redlines to vendor; waiting on their legal.', inDays: -7 },
      { text: 'Ben confirmed budget for another 12 months.', inDays: -15 },
      { text: 'Renewal notice received.', inDays: -29 },
    ],
  },
  { title: 'Hiring scorecard template', people: ['Aisha'], followupInDays: 1, dueInDays: 8 },
  // Light: a little of everything, less than the facts column is tall.
  { title: 'Offsite agenda', people: ['Aisha'], followupInDays: 29, notes: 'Book the room.', subtasks: [{ title: 'Ask for dates' }], statusUpdates: [{ text: 'Venue shortlisted.', inDays: -3 }] },
  { title: 'Support escalation path', people: ['Aisha'], urgent: true, followupInDays: 10, dueInDays: 3 },
  // Heavy: more written than a window holds.
  {
    title: 'Long running migration',
    people: ['Aisha'],
    followupInDays: 14,
    notes: HEAVY_NOTES,
    subtasks: Array.from({ length: 14 }, (_, i) => ({ title: `Step ${i + 1}`, done: i < 3 })),
    statusUpdates: Array.from({ length: 9 }, (_, i) => ({ text: `Update ${9 - i}`, inDays: -(i + 1) })),
  },
  { title: 'Empty task', people: ['Aisha'], followupInDays: 21 },
]

const SEED: WorkspaceSeed = {
  people: [{ name: 'Aisha', color: '#c8743a' }, { name: 'Ben', color: '#6c9bd2' }],
  tags: [{ name: 'Project: Atlas', color: '#7ec4bc' }, { name: 'legal', color: '#d8a35a' }],
  statuses: ['Waiting'],
  tasks: TASKS,
  listDefinitions: [{ name: 'Aisha 1:1', grouping: 'none', sort: 'manual' }],
  layouts: [{
    name: 'Main',
    columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: LIST, kind: 'lens', listDefIdx: 0 }] })] }],
  }],
}

async function setTheme(page: Page, mode: 'dark' | 'light') {
  await page.evaluate(async (m) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
      useSettingsStore: { getState: () => { setThemeMode: (mode: 'dark' | 'light') => Promise<void> } }
    }
    await mod.useSettingsStore.getState().setThemeMode(m)
  }, mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
}

async function settle(el: Locator) {
  await el.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((a) => a.finished)))
}

async function shot(page: Page, name: string, target?: Locator) {
  if (!SHOTS) return
  await page.mouse.move(2, 2)
  await (target ?? page).screenshot({ path: `${SHOTS}/${name}.png` })
}

const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit task' })

async function openEditor(page: Page, title: string): Promise<Locator> {
  await taskRowByTitle(page, title).locator(`span[data-task-title="${title}"]`).dblclick()
  await expect(editor(page)).toBeVisible()
  await settle(editor(page))
  return editor(page)
}

const deck = (page: Page) => page.locator('[data-review-deck]')
const deckRow = (page: Page, title: string) => deck(page).locator('[data-review-row]').filter({ hasText: title })
const cardTitle = (page: Page) => deck(page).getByTestId('review-card-title')
const updateLine = (page: Page) => deck(page).getByLabel('Status update · today')

/** Opens the deck on Aisha's open tasks (her avatar's menu), sorted by next follow-up. */
async function openDeck(page: Page, seed: WorkspaceSeed = SEED): Promise<Locator> {
  await seedWorkspace(page, seed)
  await wsListWidget(page, LIST).waitFor({ state: 'visible' })
  await taskRowByTitle(page, 'Empty task').locator('[data-person-avatar="Aisha"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Review with Aisha…' }).click()
  await expect(deck(page)).toBeVisible()
  await settle(deck(page))
  return deck(page)
}

async function goTo(page: Page, title: string) {
  await deckRow(page, title).click()
  await expect(cardTitle(page)).toHaveText(title)
}

/** The layout's facts: each heading's computed look. */
async function headingLooks(scope: Locator) {
  return scope.locator('[data-task-rail] [data-fact]').evaluateAll((facts) => facts.map((fact) => {
    const heading = fact.querySelector('[id]') as HTMLElement
    const cs = getComputedStyle(heading)
    return { text: heading.textContent, size: cs.fontSize, weight: cs.fontWeight, color: cs.color, transform: cs.textTransform, icons: heading.querySelectorAll('svg').length }
  }))
}

test.describe('the task editor (board BL)', () => {
  test('fact headings are the standard section label; rail 268px; the dock sits at the bottom, above the footer; one left edge', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, 'Vendor contract renewal')
    expect(await dialog.evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(760)
    const rail = dialog.locator('[data-task-rail]')
    expect(Math.round((await box(rail)).width)).toBe(268)

    // The headings: the Notes label's look — 11px bold caps, one muted colour, no icon.
    const notesLabel = await dialog.locator('[data-task-notes] > div').first().evaluate((el) => {
      const cs = getComputedStyle(el)
      return { size: cs.fontSize, weight: cs.fontWeight, color: cs.color, transform: cs.textTransform }
    })
    expect(notesLabel).toEqual({ size: '11px', weight: '700', color: notesLabel.color, transform: 'uppercase' })
    const looks = await headingLooks(dialog)
    expect(looks.map((l) => l.text)).toEqual(['Priority', 'Status', 'People', 'Tags', 'Due', 'Follow-up'])
    for (const look of looks) {
      expect({ size: look.size, weight: look.weight, color: look.color, transform: look.transform }).toEqual(notesLabel)
      expect(look.icons).toBe(0)
    }

    // The writing: Notes and Subtasks in what scrolls, Status updates in the dock under it.
    const scroll = dialog.locator('[data-task-writing-scroll]')
    const dock = dialog.locator('[data-task-dock]')
    await expect(scroll.locator('[data-task-notes]')).toBeVisible()
    await expect(scroll.locator('[data-subtasks]')).toBeVisible()
    await expect(dock.locator('[data-status-updates]')).toBeVisible()
    const [s, d, b, f] = [await box(scroll), await box(dock), await box(dialog.locator('[data-task-body]')), await box(dialog.getByRole('button', { name: 'Done' }))]
    expect(Math.abs(s.y + s.height - d.y)).toBeLessThan(1)
    // The dock ends where the body ends: straight above the footer.
    expect(Math.abs(d.y + d.height - (b.y + b.height))).toBeLessThan(1)
    expect(f.y).toBeGreaterThan(d.y + d.height)
    expect(f.y - (d.y + d.height)).toBeLessThan(24)
    // Its own darker ground and a hairline over it.
    const dockLook = await dock.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { bg: cs.backgroundColor, border: cs.borderTopWidth }
    })
    expect(dockLook.bg).not.toBe('rgba(0, 0, 0, 0)')
    expect(dockLook.border).toBe('1px')

    // One left edge: the labels, the notes box, the checkboxes, the add line's plus, the update dates.
    const left = async (l: Locator) => Math.round((await box(l)).x)
    const edge = await left(dialog.locator('[data-task-notes] > div').first())
    expect(await left(dialog.locator('[data-task-notes-box]'))).toBe(edge)
    expect(await left(dialog.locator('[data-subtasks] > div').first())).toBe(edge)
    for (const check of await dialog.locator('[data-subtasks]').getByRole('checkbox').all()) expect(await left(check)).toBe(edge)
    // The add line's plus sits in the checkboxes' column (15px wide, the 13px glyph centred).
    const plus = await left(dialog.locator('[data-subtasks] svg').last())
    expect(plus).toBeGreaterThanOrEqual(edge)
    expect(plus).toBeLessThanOrEqual(edge + 2)
    expect(await left(dialog.locator('[data-status-updates] > div').first())).toBe(edge)
    for (const date of await dialog.locator('[data-status-update] button > span:first-child').all()) expect(await left(date)).toBe(edge)
    expect(await left(dialog.getByRole('textbox', { name: 'New status update' }))).toBe(edge)
    await shot(page, 'task-details')

    // A row's grip hangs in the gutter left of that edge, inside the writing (not clipped).
    const item = dialog.locator('[data-subtasks] li').nth(2)
    await item.hover()
    const grip = await box(item.getByRole('button', { name: /^Move / }))
    expect(grip.x + grip.width).toBeLessThanOrEqual(edge)
    expect(grip.x).toBeGreaterThan((await box(scroll)).x)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/task-details-subtask-hover.png` })
    await dialog.locator('[data-status-update]').nth(1).hover()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/task-details-update-hover.png` })
  })

  test('an empty task: the Notes box is there with room for four lines; the Subtasks and Status updates headings show', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, 'Empty task')
    await expect(dialog.getByRole('button', { name: 'Add notes' })).toHaveCount(0)
    const notesBox = dialog.locator('[data-task-notes-box]')
    await expect(notesBox.locator('.cm-content')).toBeVisible()
    await expect(notesBox.locator('.cm-placeholder')).toHaveText('Add notes…')
    await expect(notesBox.getByRole('toolbar', { name: 'Notes formatting' })).toBeVisible()
    await expect(notesBox.getByRole('button', { name: 'Bullet list' })).toBeVisible()
    // Four lines of the editor (13px at 1.7) under the toolbar.
    const lineHeight = await notesBox.locator('.cm-line').first().evaluate((el) => el.getBoundingClientRect().height)
    expect((await box(notesBox.locator('.cm-content'))).height).toBeGreaterThanOrEqual(4 * lineHeight - 0.5)
    expect((await box(notesBox)).height).toBeGreaterThanOrEqual(4 * lineHeight + 40)

    // The headings are drawn, with no count beside them.
    for (const label of ['Notes', 'Subtasks', 'Status updates']) {
      const heading = dialog.locator('[data-task-writing]').getByText(label, { exact: true })
      await expect(heading).toBeVisible()
      expect((await box(heading)).height).toBeGreaterThanOrEqual(10)
    }
    await expect(dialog.locator('[data-status-update-count]')).toHaveCount(0)
    await expect(dialog.locator('[data-subtask-count-text]')).toHaveCount(0)
    await expect(dialog.getByPlaceholder('Add subtask')).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'New status update' })).toBeVisible()

    // The dock is still at the bottom; what is to spare went to Notes (no gap over the dock).
    const [scroll, dock, body] = [await box(dialog.locator('[data-task-writing-scroll]')), await box(dialog.locator('[data-task-dock]')), await box(dialog.locator('[data-task-body]'))]
    expect(Math.abs(dock.y + dock.height - (body.y + body.height))).toBeLessThan(1)
    const subtasks = await box(dialog.locator('[data-subtasks]'))
    expect(scroll.y + scroll.height - (subtasks.y + subtasks.height)).toBeLessThan(24)

    await shot(page, 'task-details-empty')
  })

  test('the Notes box grows with its text to 300px, then scrolls inside; the dock follows the writing', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, 'Vendor contract renewal')
    const notesBox = dialog.locator('[data-task-notes-box]')
    const dock = dialog.locator('[data-task-dock]')
    // More written than the facts column is tall: the box is as tall as its text (four lines at the least).
    const [before, dockBefore] = [await box(notesBox), await box(dock)]
    await notesBox.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\nfive\nsix\nseven')
    await expect.poll(async () => (await box(notesBox)).height).toBeGreaterThan(before.height + 40)
    // The card grew with it: the dock moved down, still straight above the footer.
    expect((await box(dock)).y).toBeGreaterThan(dockBefore.y + 40)
    const body = await box(dialog.locator('[data-task-body]'))
    const d = await box(dock)
    expect(Math.abs(d.y + d.height - (body.y + body.height))).toBeLessThan(1)

    // Past 300px the box stops growing and its text scrolls inside.
    await page.keyboard.type('\n8\n9\n10\n11\n12\n13\n14\n15\n16\n17\n18\n19\n20')
    await expect.poll(async () => Math.round((await box(notesBox)).height)).toBe(300)
    expect(await notesBox.locator('.cm-scroller').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    await shot(page, 'task-details-typed')
  })
})

test.describe('the review dialog (board BL)', () => {
  test('1200px wide, the queue 300px, the facts 268px; its height fits the task and the update line stays put on light tasks', async ({ page }) => {
    const dialog = await openDeck(page)
    const size = async () => { const b = await box(dialog); return { w: Math.round(b.width), h: Math.round(b.height), y: Math.round(b.y) } }

    await goTo(page, 'Empty task')
    await expect(updateLine(page)).toBeFocused()
    expect(await size()).toMatchObject({ w: 1200, h: 700 })
    expect(Math.round((await box(dialog.locator('[data-review-rail]'))).width)).toBe(300)
    expect(Math.round((await box(dialog.locator('[data-task-rail]'))).width)).toBe(268)
    const emptyLine = await box(updateLine(page))
    // The dock straight above the footer; the Notes box took the room to spare.
    const dockBottom = async () => { const d = await box(dialog.locator('[data-task-dock]')); return d.y + d.height }
    const footerTop = async () => (await box(dialog.locator('[data-review-footer]'))).y
    expect(Math.abs(await dockBottom() - await footerTop())).toBeLessThan(1)
    const [scroll, subtasks] = [await box(dialog.locator('[data-task-writing-scroll]')), await box(dialog.locator('[data-subtasks]'))]
    expect(scroll.y + scroll.height - (subtasks.y + subtasks.height)).toBeLessThan(24)
    await shot(page, 'dialog-empty')

    // A light task (notes, a subtask, an update): the same height, the line typed into in the same place.
    await goTo(page, 'Offsite agenda')
    expect(await size()).toMatchObject({ w: 1200, h: 700 })
    const lightLine = await box(updateLine(page))
    expect(Math.abs(lightLine.y - emptyLine.y)).toBeLessThan(1)
    expect(Math.abs(lightLine.x - emptyLine.x)).toBeLessThan(1)

    // A typical task: as tall as what is written, nothing scrolls.
    await goTo(page, 'Vendor contract renewal')
    const typical = await size()
    expect(typical.h).toBeGreaterThanOrEqual(700)
    expect(typical.h).toBeLessThan(868)
    expect(await dialog.locator('[data-task-writing-scroll]').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
    expect(Math.abs(await dockBottom() - await footerTop())).toBeLessThan(1)
    await shot(page, 'dialog-typical')

    // A heavy task: up to the window (16px clear each side), the writing scrolling above the dock.
    await goTo(page, 'Long running migration')
    const heavy = await size()
    expect(heavy).toMatchObject({ w: 1200, h: 868, y: 16 })
    expect(await dialog.locator('[data-task-writing-scroll]').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(20)
    expect(Math.abs(await dockBottom() - await footerTop())).toBeLessThan(1)
    await expect(updateLine(page)).toBeInViewport({ ratio: 1 })
    await expect(dialog.getByRole('button', { name: 'Mark followed up' })).toBeInViewport({ ratio: 1 })
    await expect(dialog.locator('[data-task-followup]')).toBeInViewport({ ratio: 1 })
    // The log keeps its own scroll, open at its newest.
    const log = dialog.getByRole('list', { name: 'Status updates' })
    expect(await log.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThanOrEqual(2)
    await expect(log.locator('[data-status-update]').last()).toContainText('Update 9')
    await shot(page, 'dialog-heavy')

    // Back to a light one: 700 again, nothing left over from the tall card.
    await goTo(page, 'Empty task')
    expect(await size()).toMatchObject({ w: 1200, h: 700 })
    expect(Math.abs((await box(updateLine(page))).y - emptyLine.y)).toBeLessThan(1)
  })

  test('the queue’s rows are two lines: mark · box · title, then the follow-up (flag) and the due date (clock) under the title', async ({ page }) => {
    const dialog = await openDeck(page)
    await dialog.getByTestId('review-sort').click()
    await page.getByRole('menu', { name: 'Sort the queue' }).getByRole('menuitemradio', { name: /^Next follow-up/ }).click()
    await goTo(page, 'Vendor contract renewal')

    const row = deckRow(page, 'Vendor contract renewal')
    const [title, dates] = [await box(row.locator('[data-review-row-title]')), await box(row.locator('[data-review-row-dates]'))]
    expect(dates.y).toBeGreaterThanOrEqual(title.y + title.height - 1)
    expect(Math.abs(dates.x - title.x)).toBeLessThan(1)
    // The follow-up after a flag, the due date after a clock; a late due date in the deadline colour.
    await expect(row.locator('[data-review-row-dates] svg')).toHaveCount(2)
    const colours = await row.locator('[data-review-row-dates] > span').evaluateAll((els) => els.map((el) => getComputedStyle(el).color))
    expect(colours[0]).not.toBe(colours[1])
    await expect(row.locator('[data-due-past]')).toBeVisible()
    // The whole title: not cut in a 300px rail.
    expect(await row.locator('[data-review-row-title]').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    // A row with one date has just that one; its name still says it.
    const emptyRow = deckRow(page, 'Empty task')
    await expect(emptyRow.locator('[data-review-row-dates] svg')).toHaveCount(1)
    await expect(emptyRow).toHaveAccessibleName(/^Empty task, follow-up /)

    // The current row: the accent's tint and a 2px accent edge on its left.
    const look = (l: Locator) => l.evaluate((el) => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, shadow: cs.boxShadow } })
    const current = await look(row)
    expect(current.bg).not.toBe('rgba(0, 0, 0, 0)')
    expect(current.shadow).toMatch(/2px 0px 0px 0px inset/)
    expect((await look(emptyRow)).shadow).toBe('none')

    // Followed up today (✓): its title is dimmer than a row still to do.
    const done = deckRow(page, 'Q4 headcount plan')
    await expect(done).toHaveAttribute('data-mark', 'done')
    const titleColour = (l: Locator) => l.locator('[data-review-row-title]').evaluate((el) => getComputedStyle(el).color)
    expect(await titleColour(done)).not.toBe(await titleColour(emptyRow))

    // The keys still step: → on a row skips, ← goes back.
    await row.focus()
    await page.keyboard.press('ArrowRight')
    await expect(row).toHaveAttribute('data-mark', 'skipped')
    await page.keyboard.press('ArrowLeft')
    await expect(cardTitle(page)).toHaveText('Vendor contract renewal')
    await shot(page, 'dialog-queue')
  })

  test('the header: who is reviewed, a dot per task, `k of N`, the counts, ×', async ({ page }) => {
    const dialog = await openDeck(page)
    await expect(dialog.getByRole('heading', { name: 'Aisha' })).toBeVisible()
    await expect(dialog.getByTestId('review-description')).toHaveText('Review · 8 open tasks')
    await expect(dialog).toHaveAccessibleDescription('Review · 8 open tasks')

    const dots = dialog.getByTestId('review-dots')
    await expect(dots).toHaveAttribute('aria-hidden', 'true')
    await expect(dots.locator('[data-dot]')).toHaveCount(8)
    await expect(dialog.getByRole('progressbar')).toHaveCount(0)
    const states = () => dots.locator('[data-dot]').evaluateAll((els) => els.map((el) => el.getAttribute('data-dot')))
    const order = await dialog.locator('[data-review-row]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')?.split(',')[0]))
    const at = (title: string) => order.indexOf(title)
    // One task was followed up today before the review; the first card is current.
    const start = await states()
    expect(start[0]).toBe('current')
    expect(start.filter((s) => s === 'done')).toHaveLength(at('Q4 headcount plan') === 0 ? 0 : 1)
    await expect(dialog.getByTestId('review-position')).toHaveText('1 of 8')
    await expect(dialog.getByTestId('review-skipped')).toHaveCount(0)

    // Skip one, follow one up: its dot grey, the other's the accent; the counts say so.
    await goTo(page, 'Onboarding checklist')
    await dialog.getByRole('button', { name: /^Skip/ }).click()
    await goTo(page, 'Hiring scorecard template')
    await updateLine(page).fill('Template drafted')
    await page.keyboard.press('Enter')
    await expect(deckRow(page, 'Hiring scorecard template')).toHaveAttribute('data-mark', 'done')
    await goTo(page, 'Empty task')
    const now = await states()
    expect(now[at('Onboarding checklist')]).toBe('skipped')
    expect(now[at('Hiring scorecard template')]).toBe('done')
    expect(now[at('Q4 headcount plan')]).toBe('done')
    expect(now[at('Empty task')]).toBe('current')
    expect(now.filter((s) => s === 'todo')).toHaveLength(4)
    await expect(dialog.getByTestId('review-position')).toHaveText(`${at('Empty task') + 1} of 8`)
    await expect(dialog.getByTestId('review-followed-up')).toHaveText('2 followed up')
    await expect(dialog.getByTestId('review-skipped')).toHaveText('· 1 skipped')
    // The four looks differ.
    const looks = await dots.locator('[data-dot]').evaluateAll((els) => Object.fromEntries(els.map((el) => {
      const cs = getComputedStyle(el)
      return [el.getAttribute('data-dot'), `${cs.backgroundColor} | ${cs.boxShadow}`]
    })))
    expect(new Set(Object.values(looks)).size).toBe(4)

    await dialog.getByRole('button', { name: 'Close review' }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('past 20 tasks the dots give way to a thin progress bar', async ({ page }) => {
    const many = Array.from({ length: 22 }, (_, i) => ({ title: `Task ${String(i + 1).padStart(2, '0')}`, people: ['Aisha'] }))
    const dialog = await openDeck(page, { ...SEED, tasks: [...many, { title: 'Empty task', people: ['Aisha'] }] })
    await expect(dialog.getByTestId('review-dots')).toHaveCount(0)
    const bar = dialog.getByRole('progressbar', { name: 'Followed up' })
    await expect(bar).toHaveAttribute('aria-valuemax', '23')
    await expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect((await box(bar)).height).toBeLessThanOrEqual(4)
    await expect(dialog.getByTestId('review-position')).toHaveText('1 of 23')
    // The queue scrolls; the dialog stays as tall as its (empty) task, not as its queue.
    expect(Math.round((await box(dialog)).height)).toBe(700)
    expect(await dialog.locator('[data-review-rail] ol').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  })

  test('the light theme reads: plain headings, the dock’s ground, the dots', async ({ page }) => {
    const dialog = await openDeck(page)
    await setTheme(page, 'light')
    await goTo(page, 'Vendor contract renewal')
    const looks = await headingLooks(dialog)
    expect(new Set(looks.map((l) => l.color)).size).toBe(1)
    const dock = await dialog.locator('[data-task-dock]').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(dock).not.toBe('rgba(0, 0, 0, 0)')
    // The headings read on the light ground: the muted text colour, darker there than in the dark theme.
    const [r, g, b] = (looks[0]?.color.match(/\d+/g) ?? []).map(Number)
    expect(Math.max(r ?? 255, g ?? 255, b ?? 255)).toBeLessThan(130)
    // A dot still to do and the current one are told apart there too.
    const dots = await dialog.getByTestId('review-dots').locator('[data-dot]').evaluateAll((els) => Object.fromEntries(els.map((el) => [el.getAttribute('data-dot'), getComputedStyle(el).boxShadow])))
    expect(dots.todo).not.toBe(dots.current)
    await shot(page, 'dialog-typical-light')
    if (!SHOTS) return
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await openEditor(page, 'Vendor contract renewal')
    await shot(page, 'task-details-light')
  })
})

test.describe('the Review widget’s faces (boards BL, BM)', () => {
  const widget = (page: Page, tabId: string) => page.locator(`[data-review-widget="${tabId}"]`)

  test('medium face: the Status updates heading, the latest two entries and the update line', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      tasks: TASKS.filter((t) => t.title === 'Vendor contract renewal' || t.title === 'Empty task'),
      layouts: [{
        name: 'Faces',
        table: {
          areas: ['med notes'],
          cols: [460, 980],
          rows: [{ px: 330 }],
          cells: [
            { id: 'med', tabs: [{ id: 'rm', kind: 'review', review: { by: 'person' } }] },
            { id: 'notes', tabs: [{ id: 'n1', kind: 'notes' }] },
          ],
        },
      }],
    })
    const med = widget(page, 'rm')
    await pickInReview(page, 'rm', 'Aisha')
    await expect(med).toHaveAttribute('data-review-face', 'medium')
    await expect(med.getByTestId('review-card-title')).toHaveText('Vendor contract renewal')
    const dock = med.locator('[data-review-dock]')
    const heading = dock.getByRole('heading', { name: /Status updates/ })
    await expect(heading).toBeVisible()
    await expect(heading.locator('[data-status-update-count]')).toHaveText('3')
    // The latest two of three, oldest first; the newest in the primary colour.
    const entries = dock.locator('[data-status-update]')
    await expect(entries).toHaveCount(2)
    await expect(entries.nth(0)).toContainText('Ben confirmed budget')
    await expect(entries.nth(1)).toContainText('Sent redlines to vendor')
    await expect(entries.nth(1)).toHaveAttribute('data-newest', 'true')
    for (const entry of await entries.all()) await expect(entry).toBeVisible()
    // Heading, entries, update line: top to bottom, the line last, over the footer.
    const line = med.getByLabel('Status update · today')
    const ys = [await box(heading), await box(entries.nth(0)), await box(entries.nth(1)), await box(line)].map((b) => b.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
    const [d, f] = [await box(dock), await box(med.locator('[data-review-footer]'))]
    expect(Math.abs(d.y + d.height - f.y)).toBeLessThan(1)
    await shot(page, 'widget-medium', wsCell(page, 'med'))
    if (SHOTS) await shot(page, 'widget-medium-page')

    // A task with none: the heading still shows, no count, no entries.
    await med.getByRole('button', { name: /^Skip/ }).click()
    await expect(med.getByTestId('review-card-title')).toHaveText('Empty task')
    await expect(dock.getByRole('heading', { name: 'Status updates' })).toBeVisible()
    await expect(dock.locator('[data-status-update]')).toHaveCount(0)
    await expect(dock.locator('[data-status-update-count]')).toHaveCount(0)
  })

  for (const { name, cols, queue, facts } of [
    { name: 'a wide cell: the queue 300px, the facts 268px', cols: [1160, 280], queue: [300, 300], facts: [268, 268] },
    { name: 'a small cell: both give way (220px at the least)', cols: [940, 500], queue: [220, 260], facts: [220, 240] },
  ]) {
    test(`large face, ${name}; the dock above the footer, which spans the widget`, async ({ page }) => {
      await seedWorkspace(page, {
        ...SEED,
        layouts: [{
          name: 'Large',
          table: {
            areas: ['rv notes'],
            cols,
            cells: [
              { id: 'rv', tabs: [{ id: 'rev1', kind: 'review', review: { by: 'person' } }] },
              { id: 'notes', tabs: [{ id: 'n1', kind: 'notes' }] },
            ],
          },
        }],
      })
      const w = widget(page, 'rev1')
      await pickInReview(page, 'rev1', 'Aisha')
      await expect(w).toHaveAttribute('data-review-face', 'large')
      await w.locator('[data-review-row]').filter({ hasText: 'Vendor contract renewal' }).click()
      await expect(w.getByTestId('review-card-title')).toHaveText('Vendor contract renewal')
      const [q, r, wr, whole] = [
        await box(w.locator('[data-review-rail]')),
        await box(w.locator('[data-task-rail]')),
        await box(w.locator('[data-task-writing]')),
        await box(w),
      ]
      expect(q.width).toBeGreaterThanOrEqual(queue[0]! - 0.5)
      expect(q.width).toBeLessThanOrEqual(queue[1]! + 0.5)
      expect(r.width).toBeGreaterThanOrEqual(facts[0]! - 0.5)
      expect(r.width).toBeLessThanOrEqual(facts[1]! + 0.5)
      // Queue, facts, writing: left to right, the writing still the widest part.
      expect(q.x + q.width).toBeLessThanOrEqual(r.x + 0.5)
      expect(r.x + r.width).toBeLessThanOrEqual(wr.x + 0.5)
      expect(wr.width).toBeGreaterThan(r.width)
      // The dock at the bottom of the card, the footer under queue and card alike.
      const [d, f] = [await box(w.locator('[data-task-dock]')), await box(w.locator('[data-review-footer]'))]
      expect(Math.abs(d.y + d.height - f.y)).toBeLessThan(1)
      expect(Math.abs(f.x - whole.x)).toBeLessThan(1)
      expect(Math.abs(f.width - whole.width)).toBeLessThan(1)
      // Notes takes the room the cell has to spare: no gap between Subtasks and the dock.
      const [scroll, subtasks] = [await box(w.locator('[data-task-writing-scroll]')), await box(w.locator('[data-subtasks]'))]
      expect(scroll.y + scroll.height - (subtasks.y + subtasks.height)).toBeLessThan(24)
      // The queue's rows are the dialog's: two lines.
      const row = w.locator('[data-review-row]').filter({ hasText: 'Vendor contract renewal' })
      const [title, dates] = [await box(row.locator('[data-review-row-title]')), await box(row.locator('[data-review-row-dates]'))]
      expect(dates.y).toBeGreaterThanOrEqual(title.y + title.height - 1)
      await shot(page, cols[0] === 1160 ? 'widget-large' : 'widget-large-small-cell')
    })
  }
})
