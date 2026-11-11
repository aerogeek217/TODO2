import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { box, type Box } from './fixtures/geometry'
import { taskRowByTitle } from './fixtures/seed'
import { pickInReview, seedWorkspace, wsListWidget, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { expectDeckAt } from './fixtures/review'

/**
 * Task layout A (2026-11-10) in a real browser — the task editor, the review
 * dialog and the Review widget, by geometry, at the sizes the plan lists:
 * the update line, the Next and Last follow-up fields and Mark followed up
 * are in view without scrolling, on a heavy task (long notes, eight
 * subtasks, six updates) and on an empty one; the rail, Notes, Subtasks, the
 * dock and the footer never overlap, nor do the parts of the dock or of a
 * follow-up row; empty Notes is one line; the card's rail is always left of
 * its writing; under 820px a widget (and the deck) folds its queue into the
 * progress, which opens it. Then the behaviour: Last is a field in review
 * (⏎ writes it, one undo step, a future day refused), Next ⏎ hands the focus
 * back to the update line, the Tab order, and the editor footer's Mark
 * followed up. With `TASK_LAYOUT_SHOTS=<folder>` it saves screenshots.
 */

const SHOTS = process.env.TASK_LAYOUT_SHOTS
const LIST = 'l1'
const HEAVY = 'Vendor contract renewal'
const EMPTY = 'Empty task'

const LONG_NOTES = [
  'Legal wants the indemnity clause reworded before we sign.',
  ...Array.from({ length: 22 }, (_, i) => `- Point ${i + 1} to raise with the vendor's counsel`),
].join('\n')

const TASKS: NonNullable<WorkspaceSeed['tasks']> = [
  { title: 'Q4 headcount plan', people: ['Aisha'], followupInDays: 29, dueInDays: 10 },
  { title: 'Onboarding checklist', people: ['Aisha'], followupInDays: 0 },
  {
    title: HEAVY,
    people: ['Aisha', 'Ben'],
    tags: ['Project: Atlas', 'legal'],
    status: 'Waiting',
    urgent: true,
    dueInDays: -4,
    followupInDays: 6,
    lastFollowupInDays: -15,
    notes: LONG_NOTES,
    subtasks: Array.from({ length: 8 }, (_, i) => ({ title: `Step ${i + 1} of the renewal`, done: i < 2 })),
    statusUpdates: Array.from({ length: 6 }, (_, i) => ({ text: `Update ${6 - i}: the vendor's legal team replied about clause ${6 - i}`, inDays: -(i + 1) * 3 })),
  },
  { title: 'Hiring scorecard template', people: ['Aisha'], followupInDays: 1, dueInDays: 8 },
  { title: EMPTY, people: ['Aisha'] },
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

/** One cell holding a Review widget (`rv1`) and nothing else: its size is the window's. */
const WIDGET_SEED: WorkspaceSeed = {
  ...SEED,
  layouts: [{
    name: 'Review',
    table: { areas: ['rv'], cells: [{ id: 'rv', tabs: [{ id: 'rv1', kind: 'review' }] }] },
  }],
}

async function settle(el: Locator) {
  await el.evaluate((node) => Promise.allSettled(node.getAnimations({ subtree: true }).map((a) => a.finished)))
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return
  await page.mouse.move(2, 2)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

/** Two boxes overlap (by more than a pixel of rounding each way). */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1
}

/** `a` clipped to `clip` (what of it is drawn inside a scroller), or null when nothing is. */
function clipTo(a: Box, clip: Box): Box | null {
  const x = Math.max(a.x, clip.x)
  const y = Math.max(a.y, clip.y)
  const r = Math.min(a.x + a.width, clip.x + clip.width)
  const btm = Math.min(a.y + a.height, clip.y + clip.height)
  return r > x && btm > y ? { x, y, width: r - x, height: btm - y } : null
}

function expectNoOverlaps(named: Record<string, Box | null>) {
  const entries = Object.entries(named).filter((e): e is [string, Box] => e[1] != null)
  for (const [i, [an, a]] of entries.entries()) {
    for (const [bn, b] of entries.slice(i + 1)) {
      expect(overlaps(a, b), `${an} overlaps ${bn}: ${JSON.stringify(a)} / ${JSON.stringify(b)}`).toBe(false)
    }
  }
}

/** The element is drawn and reachable where it is: inside the viewport and the topmost thing at its centre. */
async function expectReachable(page: Page, el: Locator, what: string) {
  const vp = page.viewportSize()!
  const b = await box(el)
  expect(b.y, `${what} top`).toBeGreaterThanOrEqual(-0.5)
  expect(b.x, `${what} left`).toBeGreaterThanOrEqual(-0.5)
  expect(b.y + b.height, `${what} bottom`).toBeLessThanOrEqual(vp.height + 0.5)
  expect(b.x + b.width, `${what} right`).toBeLessThanOrEqual(vp.width + 0.5)
  const hit = await el.evaluate((node) => {
    const r = node.getBoundingClientRect()
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return at != null && (node === at || node.contains(at) || at.contains(node))
  })
  expect(hit, `${what} is the topmost thing at its centre (not clipped or covered)`).toBe(true)
}

/**
 * The layout's checks inside `host` (the editor, the deck, a widget): the four routine controls
 * reachable without scrolling, the regions apart, the dock's parts apart, each follow-up row's parts
 * apart, the rail left of the writing.
 */
async function expectLayoutA(page: Page, host: Locator, { last = true, footer }: { last?: boolean; footer: Locator }) {
  const update = host.locator('[data-review-update], [data-status-update-add]').first()
  const next = host.getByRole('textbox', { name: 'Next follow-up' })
  const mark = host.getByRole('button', { name: 'Mark followed up' })
  await expectReachable(page, update, 'the update line')
  await expectReachable(page, next, 'the Next field')
  if (last) await expectReachable(page, host.getByRole('textbox', { name: 'Last follow-up' }), 'the Last field')
  await expectReachable(page, mark, 'Mark followed up')

  const scroll = await box(host.locator('[data-task-writing-scroll]'))
  const rail = await box(host.locator('[data-task-rail]'))
  const writing = await box(host.locator('[data-task-writing]'))
  expect(rail.x + rail.width, 'the rail is left of the writing').toBeLessThanOrEqual(writing.x + 0.5)
  expectNoOverlaps({
    rail,
    notes: clipTo(await box(host.locator('[data-task-notes]')), scroll),
    subtasks: clipTo(await box(host.locator('[data-subtasks]')), scroll),
    dock: await box(host.locator('[data-task-dock]')),
    footer: await box(footer),
  })
  const dock = host.locator('[data-task-dock]')
  const followup = await box(dock.locator('[data-task-followup]'))
  const rows = dock.locator('[data-followup-row]')
  const parts: Record<string, Box | null> = {
    updateLine: await box(update),
    // The hairline: the follow-up block's top edge.
    hairline: { x: followup.x, y: followup.y - 0.5, width: followup.width, height: 1 },
  }
  for (const [i, row] of (await rows.all()).entries()) parts[`row ${i}`] = await box(row)
  expectNoOverlaps(parts)
  for (const row of await rows.all()) await expectRowApart(row)
}

/** A follow-up row's label, field, quick buttons and help: none over another. */
async function expectRowApart(row: Locator) {
  const named: Record<string, Box | null> = {
    label: await box(row.locator('[data-followup-label]')),
    field: await box(row.locator('[data-fact-date-field]')),
  }
  const quick = row.getByRole('group', { name: 'Quick follow-up intervals' })
  if (await quick.count()) named.quick = await box(quick)
  const help = row.locator('[aria-live]')
  if (await help.count() && await help.isVisible()) named.help = await box(help)
  expectNoOverlaps(named)
}

// ── The task editor ─────────────────────────────────────────────────────────

const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit task' })

async function openEditor(page: Page, title: string): Promise<Locator> {
  await taskRowByTitle(page, title).locator(`span[data-task-title="${title}"]`).dblclick()
  await expect(editor(page)).toBeVisible()
  await settle(editor(page))
  return editor(page)
}

for (const size of [{ width: 760, height: 640 }, { width: 760, height: 520 }]) {
  test.describe(`the task editor in a window that leaves it ${size.width} × ${size.height}`, () => {
    // The card is 760px wide and at most 82vh tall: a window that leaves it that tall.
    test.use({ viewport: { width: 1280, height: Math.round(size.height / 0.82) } })

    for (const title of [HEAVY, EMPTY]) {
      test(`${title}: the update line, Next, Last and Mark followed up in view; nothing overlaps`, async ({ page }) => {
        await seedWorkspace(page, SEED)
        const dialog = await openEditor(page, title)
        const b = await box(dialog)
        expect(Math.round(b.width)).toBe(size.width)
        expect(b.height).toBeLessThanOrEqual(size.height + 1)
        await expectLayoutA(page, dialog, { footer: dialog.locator('button', { hasText: 'Done' }).locator('..') })
        if (title === EMPTY) {
          // Empty Notes is one line; the writing's spare room is not Notes'.
          expect((await box(dialog.locator('[data-task-notes-box]'))).height).toBeLessThan(40)
          expect((await box(dialog.locator('[data-task-notes]'))).height).toBeLessThan(64)
        } else {
          // The writing scrolls under the dock and fades where there is more.
          await expect(dialog.locator('[data-task-writing-scroll]')).toHaveAttribute('data-can-scroll-down', '')
        }
        await shot(page, `editor-${size.width}x${size.height}-${title === EMPTY ? 'empty' : 'heavy'}`)
      })
    }
  })
}

test.describe('the task editor in the light theme, 760 × 640', () => {
  test.use({ viewport: { width: 1280, height: Math.round(640 / 0.82) } })

  test('the same layout reads on the light ground: the dock’s ground, the fields’ boxes', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await page.evaluate(async () => {
      const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
        useSettingsStore: { getState: () => { setThemeMode: (mode: 'dark' | 'light') => Promise<void> } }
      }
      await mod.useSettingsStore.getState().setThemeMode('light')
    })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    for (const title of [HEAVY, EMPTY]) {
      const dialog = await openEditor(page, title)
      await expectLayoutA(page, dialog, { footer: dialog.locator('button', { hasText: 'Done' }).locator('..') })
      const looks = await dialog.locator('[data-task-dock]').evaluate((dock) => ({
        dock: getComputedStyle(dock).backgroundColor,
        field: getComputedStyle(dock.querySelector('[data-fact-date-field] > div')!).boxShadow,
      }))
      expect(looks.dock).not.toBe('rgba(0, 0, 0, 0)')
      expect(looks.field).not.toBe('none')
      await shot(page, `editor-760x640-light-${title === EMPTY ? 'empty' : 'heavy'}`)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
  })
})

test.describe('the task editor under 600px of body', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('one column, not pinned: the facts two up, Notes, Subtasks, then the dock with the follow-up rows; nothing overlaps', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await openEditor(page, HEAVY)
    await page.setViewportSize({ width: 580, height: 860 })
    await settle(editor(page))
    const dialog = editor(page)
    const [rail, scroll, dock] = [await box(dialog.locator('[data-task-rail]')), await box(dialog.locator('[data-task-writing-scroll]')), await box(dialog.locator('[data-task-dock]'))]
    expect(scroll.y).toBeGreaterThanOrEqual(rail.y + rail.height - 1)
    expect(dock.y).toBeGreaterThanOrEqual(scroll.y + scroll.height - 1)
    // The body scrolls as one: the dock is reached by scrolling it, and its parts don't overlap.
    await dialog.getByRole('textbox', { name: 'Last follow-up' }).scrollIntoViewIfNeeded()
    const rows = dialog.locator('[data-followup-row]')
    expectNoOverlaps({
      updateLine: await box(dialog.getByRole('textbox', { name: 'New status update' })),
      next: await box(rows.nth(0)),
      last: await box(rows.nth(1)),
    })
    for (const row of await rows.all()) await expectRowApart(row)
    await shot(page, 'editor-580x860-narrow')
  })
})

test.describe('the task editor’s dock and footer', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Next and Last are fields under the update line, one Tab from it; the footer’s Mark followed up records a follow-up', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, HEAVY)
    const rail = dialog.locator('[data-task-rail]')
    await expect(rail.locator('[data-fact]')).toHaveCount(5)
    await expect(rail.getByRole('textbox', { name: /follow-up/ })).toHaveCount(0)
    await expect(rail).toContainText(/Created .* · Modified /)
    const dock = dialog.locator('[data-task-dock]')
    const add = dock.getByRole('textbox', { name: 'New status update' })
    const next = dock.getByRole('textbox', { name: 'Next follow-up' })
    const last = dock.getByRole('textbox', { name: 'Last follow-up' })
    expect((await box(next)).y).toBeGreaterThan((await box(add)).y)
    expect((await box(last)).y).toBeGreaterThan((await box(next)).y)
    await add.focus()
    await page.keyboard.press('Tab')
    await expect(next).toBeFocused()

    // Type `2w` in Next, ⏎: written.
    await next.fill('2w')
    await next.press('Enter')
    await expect.poll(async () => {
      const t = (await readStore<{ title: string; nextFollowupAt?: Date }>(page, 'todos')).find((r) => r.title === HEAVY)
      return t?.nextFollowupAt ? Math.round((new Date(t.nextFollowupAt).getTime() - Date.now()) / 86_400_000) : null
    }).toBeGreaterThanOrEqual(13)

    // Change Last to yesterday.
    await last.fill('yesterday')
    await last.press('Enter')
    const yesterday = new Date()
    yesterday.setHours(0, 0, 0, 0)
    yesterday.setDate(yesterday.getDate() - 1)
    await expect.poll(async () => {
      const t = (await readStore<{ title: string; lastFollowupAt?: Date }>(page, 'todos')).find((r) => r.title === HEAVY)
      return t?.lastFollowupAt ? new Date(t.lastFollowupAt).getTime() : null
    }).toBe(yesterday.getTime())

    // The footer's Mark followed up: today.
    await dialog.locator('[data-task-dock]').click({ position: { x: 4, y: 4 } })
    await dialog.getByRole('button', { name: 'Mark followed up' }).click()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    await expect.poll(async () => {
      const t = (await readStore<{ title: string; lastFollowupAt?: Date }>(page, 'todos')).find((r) => r.title === HEAVY)
      return t?.lastFollowupAt ? new Date(new Date(t.lastFollowupAt).setHours(0, 0, 0, 0)).getTime() : null
    }).toBe(today.getTime())
  })

  test('the notes toolbar sits on the NOTES line and shows only while Notes has the focus', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, EMPTY)
    const toolbar = dialog.getByRole('toolbar', { name: 'Notes formatting' })
    await expect(toolbar).toBeHidden()
    const label = dialog.locator('[data-task-notes] > div').first()
    const notesBox = dialog.locator('[data-task-notes-box]')
    const before = await box(notesBox)
    await notesBox.locator('.cm-content').click()
    await expect(toolbar).toBeVisible()
    // On the label line, at its right end; nothing moved.
    const [t, l, nb] = [await box(toolbar), await box(label), await box(notesBox)]
    expect(t.y).toBeLessThan(l.y + l.height)
    expect(t.y + t.height).toBeLessThanOrEqual(nb.y + 0.5)
    expect(Math.abs(t.x + t.width - (nb.x + nb.width))).toBeLessThan(2)
    expect(nb.y).toBe(before.y)
    expect(nb.height).toBe(before.height)
    // Its buttons work on the notes.
    await page.keyboard.type('first')
    await toolbar.getByRole('button', { name: 'Bullet list' }).click()
    await expect(notesBox.locator('.cm-content')).toContainText('first')
    await expect(toolbar).toBeVisible()
  })
})

// ── The review dialog ───────────────────────────────────────────────────────

const deck = (page: Page) => page.locator('[data-review-deck]')

async function openDeck(page: Page): Promise<Locator> {
  await seedWorkspace(page, SEED)
  await wsListWidget(page, LIST).waitFor({ state: 'visible' })
  await taskRowByTitle(page, EMPTY).locator('[data-person-avatar="Aisha"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Review with Aisha…' }).click()
  await expect(deck(page)).toBeVisible()
  await settle(deck(page))
  return deck(page)
}

async function goTo(page: Page, scope: Locator, title: string) {
  const row = scope.locator('[data-review-row]').filter({ hasText: title })
  if (await row.count()) {
    await row.click()
  } else {
    // The queue folded: open it from its Queue button and pick there.
    await scope.locator('[data-review-queue-button]').click()
    await page.locator('[data-review-queue-popover] [data-review-row]').filter({ hasText: title }).click()
  }
  await expect(scope.getByTestId('review-card-title')).toHaveText(title)
}

for (const size of [{ width: 1200, height: 800 }, { width: 1200, height: 760 }, { width: 900, height: 640 }]) {
  test.describe(`the review dialog at ${size.width} × ${size.height}`, () => {
    // The deck is 32px narrower and shorter than the window at most.
    test.use({ viewport: { width: size.width + 32, height: size.height + 32 } })

    for (const title of [HEAVY, EMPTY]) {
      test(`${title}: in view without scrolling; nothing overlaps; the rail left of the writing`, async ({ page }) => {
        const dialog = await openDeck(page)
        await goTo(page, dialog, title)
        expect(Math.round((await box(dialog)).width)).toBe(size.width)
        await expectLayoutA(page, dialog, { footer: dialog.locator('[data-review-footer]') })
        // The hint over the footer's buttons went: the field it echoed is right above it.
        await expect(dialog.getByTestId('review-hint')).toHaveCount(0)
        await shot(page, `deck-${size.width}x${size.height}-${title === EMPTY ? 'empty' : 'heavy'}`)
      })
    }
  })
}

test.describe('the review dialog in a narrow window', () => {
  test.use({ viewport: { width: 840, height: 720 } })

  test('under 820px of deck the queue folds into a Queue button in the header, which opens it; a pick closes it', async ({ page }) => {
    const dialog = await openDeck(page)
    expect((await box(dialog)).width).toBeLessThan(820)
    await expect(dialog.locator('[data-review-rail]')).toHaveCount(0)
    await expectDeckAt(dialog, 1, 5, { rail: false })
    // No place in the queue: the header has no position words while there is something to review.
    await expect(dialog.getByTestId('review-position')).toHaveCount(0)
    const position = dialog.locator('header').getByRole('button', { name: 'Queue', exact: true })
    await expect(position).toHaveText('Queue')
    await expect(position).toHaveAttribute('data-review-queue-button', '')
    await expect(position).toHaveAttribute('aria-expanded', 'false')
    await position.click()
    await expect(position).toHaveAttribute('aria-expanded', 'true')
    const popover = page.locator('[data-review-queue-popover]')
    await expect(popover.locator('[data-review-row]')).toHaveCount(5)
    await expect(popover.locator('[data-review-row]').first()).toHaveAttribute('aria-current', 'true')
    await expect(popover.getByTestId('review-sort')).toBeVisible()
    await popover.locator('[data-review-row]').filter({ hasText: HEAVY }).click()
    await expect(popover).toHaveCount(0)
    await expect(dialog.getByTestId('review-card-title')).toHaveText(HEAVY)
    // Esc closes an open queue, not the deck.
    await position.click()
    await expect(popover).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await shot(page, 'deck-840x720-folded')
  })
})

test.describe('the review card’s follow-up rows', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the deck: Last is a field (⏎ writes it, one undo step; a future day refused); Next ⏎ returns to the update line; Tab order', async ({ page }) => {
    const dialog = await openDeck(page)
    await goTo(page, dialog, HEAVY)
    await expectFollowupBehaviour(page, dialog)
  })

  test('the Review widget’s large face: the same', async ({ page }) => {
    await seedWorkspace(page, WIDGET_SEED)
    const widget = page.locator('[data-review-widget="rv1"]')
    await pickInReview(page, 'rv1', 'Aisha')
    await expect(widget).toHaveAttribute('data-review-face', 'large')
    await goTo(page, widget, HEAVY)
    await expectFollowupBehaviour(page, widget)
  })
})

async function storedLast(page: Page): Promise<number | null> {
  const t = (await readStore<{ title: string; lastFollowupAt?: Date }>(page, 'todos')).find((r) => r.title === HEAVY)
  return t?.lastFollowupAt ? new Date(t.lastFollowupAt).getTime() : null
}

async function undoDepth(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/undo-store.ts' as string)) as {
      useUndoStore: { getState: () => { undoStack: unknown[] } }
    }
    return mod.useUndoStore.getState().undoStack.length
  })
}

async function undo(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/undo-store.ts' as string)) as {
      useUndoStore: { getState: () => { undo: () => Promise<void> } }
    }
    await mod.useUndoStore.getState().undo()
  })
}

async function expectFollowupBehaviour(page: Page, scope: Locator) {
  const update = scope.getByLabel('Status update · today')
  const next = scope.getByRole('textbox', { name: 'Next follow-up' })
  const last = scope.getByRole('textbox', { name: 'Last follow-up' })
  await expect(scope.getByTestId('review-last-followup')).toContainText('2 weeks ago')

  // Tab from the update line: Next, then its ×, calendar and quick buttons, then Last.
  await update.focus()
  await page.keyboard.press('Tab')
  await expect(next).toBeFocused()
  const stops: string[] = []
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    const name = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
    stops.push(name)
    if (name === 'Last follow-up') break
  }
  expect(stops).toEqual(['Clear next follow-up', 'Pick next follow-up date', 'Follow up in 1 week', 'Follow up in 2 weeks', 'Follow up in 1 month', 'Follow up in 3 months', 'Last follow-up'])

  // A future day is refused: nothing written.
  const before = await storedLast(page)
  await last.fill('tomorrow')
  await expect(last).toHaveAttribute('aria-invalid', 'true')
  await last.press('Enter')
  await expect(last).toBeFocused()
  expect(await storedLast(page)).toBe(before)
  await last.press('Escape')
  await expect(last).toHaveAttribute('aria-invalid', 'false')

  // Yesterday, ⏎: written, one undo step, the focus back on the update line.
  const depth = await undoDepth(page)
  await last.fill('yesterday')
  await last.press('Enter')
  const yesterday = new Date()
  yesterday.setHours(0, 0, 0, 0)
  yesterday.setDate(yesterday.getDate() - 1)
  await expect.poll(() => storedLast(page)).toBe(yesterday.getTime())
  await expect(update).toBeFocused()
  expect(await undoDepth(page)).toBe(depth + 1)
  await undo(page)
  await expect.poll(() => storedLast(page)).toBe(before)

  // Next: ⏎ sets it and hands the focus back to the update line.
  await next.fill('3w')
  await next.press('Enter')
  await expect(update).toBeFocused()
}

// ── The Review widget ───────────────────────────────────────────────────────

/** Resizes the window so the Review widget `rv1` (alone in its cell) is `width` × `height`. */
async function sizeWidget(page: Page, width: number, height: number): Promise<Locator> {
  const widget = page.locator('[data-review-widget="rv1"]')
  for (let i = 0; i < 3; i++) {
    const vp = page.viewportSize()!
    const b = await box(widget)
    if (Math.abs(b.width - width) < 1 && Math.abs(b.height - height) < 1) break
    await page.setViewportSize({ width: Math.round(vp.width + width - b.width), height: Math.round(vp.height + height - b.height) })
    await expect.poll(async () => Math.round((await box(widget)).width)).toBe(width)
  }
  return widget
}

for (const size of [{ width: 1400, height: 800 }, { width: 860, height: 600 }, { width: 700, height: 560 }]) {
  test.describe(`the Review widget, large face, ${size.width} × ${size.height}`, () => {
    test.use({ viewport: { width: size.width + 60, height: size.height + 120 } })

    for (const title of [HEAVY, EMPTY]) {
      test(`${title}: in view without scrolling; nothing overlaps; the queue ${size.width < 820 ? 'folded' : 'beside the card'}`, async ({ page }) => {
        await seedWorkspace(page, WIDGET_SEED)
        await pickInReview(page, 'rv1', 'Aisha')
        const widget = await sizeWidget(page, size.width, size.height)
        await expect(widget).toHaveAttribute('data-review-face', 'large')
        await goTo(page, widget, title)
        await expectLayoutA(page, widget, { footer: widget.locator('[data-review-footer]') })
        if (size.width < 820) {
          await expect(widget.locator('[data-review-rail]')).toHaveCount(0)
          await expect(widget.locator('[data-review-queue-button]')).toBeVisible()
          await expect(widget.getByTestId('review-widget-progress')).toHaveText(/^Queue · [0-9]+ followed up$/)
        } else {
          await expect(widget.locator('[data-review-rail]')).toBeVisible()
          await expect(widget.locator('[data-review-queue-button]')).toHaveCount(0)
        }
        await shot(page, `widget-${size.width}x${size.height}-${title === EMPTY ? 'empty' : 'heavy'}`)
      })
    }
  })
}

test.describe('the Review widget across widths', () => {
  test.use({ viewport: { width: 1460, height: 720 } })

  test('640 → 1400px at 600px tall: no part of a row over another, the rail never above the writing, the fold at 820', async ({ page }) => {
    await seedWorkspace(page, WIDGET_SEED)
    await pickInReview(page, 'rv1', 'Aisha')
    const widget = page.locator('[data-review-widget="rv1"]')
    await goTo(page, widget, HEAVY)
    for (const width of [660, 700, 760, 819, 820, 860, 940, 1040, 1200, 1400]) {
      await sizeWidget(page, width, 600)
      await expect(widget).toHaveAttribute('data-review-face', 'large')
      await expect(widget.locator('[data-review-rail]')).toHaveCount(width < 820 ? 0 : 1)
      await expectLayoutA(page, widget, { footer: widget.locator('[data-review-footer]') })
    }
  })

  test('the medium face (660 × 400): the update line and the Next row over the footer', async ({ page }) => {
    await seedWorkspace(page, WIDGET_SEED)
    await pickInReview(page, 'rv1', 'Aisha')
    const widget = await sizeWidget(page, 660, 400)
    await expect(widget).toHaveAttribute('data-review-face', 'medium')
    for (const title of [HEAVY, EMPTY]) {
      while ((await widget.getByTestId('review-card-title').textContent()) !== title) {
        await widget.getByRole('button', { name: /^Skip/ }).click()
      }
      const update = widget.getByLabel('Status update · today')
      const next = widget.getByRole('textbox', { name: 'Next follow-up' })
      await expectReachable(page, update, 'the update line')
      await expectReachable(page, next, 'the Next field')
      await expectReachable(page, widget.getByRole('button', { name: 'Mark followed up' }), 'Mark followed up')
      await expect(widget.getByRole('textbox', { name: 'Last follow-up' })).toHaveCount(0)
      expect((await box(next)).y).toBeGreaterThan((await box(update)).y + 20)
      await expectRowApart(widget.locator('[data-followup-row="next"]'))
      expectNoOverlaps({ dock: await box(widget.locator('[data-review-dock]')), footer: await box(widget.locator('[data-review-footer]')) })
      await shot(page, `widget-660x400-medium-${title === EMPTY ? 'empty' : 'heavy'}`)
    }
  })
})
