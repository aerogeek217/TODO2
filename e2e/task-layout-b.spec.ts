import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { box, type Box } from './fixtures/geometry'
import { taskRowByTitle } from './fixtures/seed'
import { pickInReview, seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Task layout B (feedback 2026-11-15, boards B-Editor / B-Review) in a real
 * browser — the task editor and the Review widget, by geometry: the fact
 * band under the title (Priority · Status · People · Tags · Due), the dashed
 * + after the people and the tags (always shown, it opens the picker), the
 * two columns — Subtasks then Notes on the left, Status updates on the right
 * with the update line under them — and the footer: `Last · Next [quick] ·
 * Mark followed up`, Done at the right end in the editor, Back / Skip at the
 * left end in the review. The editor is as tall as its content; under 600px
 * of body the columns stack. Then the behaviour: the fields in the footer
 * keep their rules (⏎ writes, one undo step, a future Last refused), the Tab
 * order from the update line, and the footer's Mark followed up. With
 * `TASK_LAYOUT_SHOTS=<folder>` it saves screenshots.
 */

const SHOTS = process.env.TASK_LAYOUT_SHOTS
const LIST = 'l1'
const HEAVY = 'Vendor contract renewal'
const EMPTY = 'Empty task'
const LOGGED = 'Weekly vendor sync'

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
  {
    title: LOGGED,
    people: ['Aisha'],
    statusUpdates: Array.from({ length: 12 }, (_, i) => ({ text: `Sync ${12 - i}: nothing new from the vendor`, inDays: -(i + 1) * 2 })),
  },
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

/** The visible boxes of what `scope` holds matching `selector`. */
async function visibleBoxes(scope: Locator, selector: string): Promise<Box[]> {
  const out: Box[] = []
  for (const el of await scope.locator(selector).all()) if (await el.isVisible()) out.push(await box(el))
  return out
}

/**
 * Layout B inside `host` (the editor, a widget): the fact band's six cells in order under the
 * title; the band above the body; Subtasks above Notes; the writing left of Status updates (or above
 * it, `stacked`); the update line, Last, Next and Mark followed up reachable; the footer holding the
 * follow-up fields — Last, then Next, then Mark followed up, left to right, none over another.
 */
async function expectLayoutB(page: Page, host: Locator, { last = true, stacked = false, footer }: { last?: boolean; stacked?: boolean; footer: Locator }) {
  const band = host.locator('[data-task-facts]')
  await expect(band.locator('[data-fact]')).toHaveCount(6)
  expect(await band.locator('[data-fact]').evaluateAll((cells) => cells.map((c) => c.getAttribute('data-fact'))))
    .toEqual(['priority', 'status', 'people', 'tags', 'due', 'planned'])
  const [bandBox, writing, updates] = [await box(band), await box(host.locator('[data-task-writing]')), await box(host.locator('[data-task-updates]'))]
  expect(writing.y, 'the body under the band').toBeGreaterThanOrEqual(bandBox.y + bandBox.height - 1)
  if (stacked) {
    expect(updates.y, 'Status updates under the writing').toBeGreaterThanOrEqual(writing.y + writing.height - 1)
  } else {
    expect(writing.x + writing.width, 'the writing left of Status updates').toBeLessThanOrEqual(updates.x + 0.5)
    expect(Math.abs(writing.y - updates.y), 'the columns side by side').toBeLessThan(1)
  }
  const [subtasks, notes] = [await box(host.locator('[data-subtasks]')), await box(host.locator('[data-task-notes]'))]
  expect(notes.y, 'Notes under Subtasks').toBeGreaterThanOrEqual(subtasks.y + subtasks.height - 1)

  const update = host.locator('[data-review-update], [data-status-update-add]').first()
  const nextField = footer.getByRole('textbox', { name: 'Next follow-up' })
  const lastField = footer.getByRole('textbox', { name: 'Last follow-up' })
  const mark = footer.getByRole('button', { name: 'Mark followed up' })
  if (!stacked) await expectReachable(page, update, 'the update line')
  await expectReachable(page, nextField, 'the Next field')
  if (last) await expectReachable(page, lastField, 'the Last field')
  await expectReachable(page, mark, 'Mark followed up')

  // The footer: Last → Next → Mark followed up, on one line — except in a stacked (phone-width)
  // editor, whose footer wraps: the fields on their line, the buttons under them.
  const [n, m] = [await box(nextField), await box(mark)]
  if (stacked) {
    expect(m.y, 'Mark followed up under the fields').toBeGreaterThanOrEqual(n.y + n.height - 0.5)
  } else {
    expect(n.x + n.width, 'Next before Mark followed up').toBeLessThanOrEqual(m.x + 0.5)
    expect(Math.abs((n.y + n.height / 2) - (m.y + m.height / 2)), 'the fields on the footer’s line').toBeLessThan(3)
  }
  if (last) {
    const l = await box(lastField)
    expect(l.x + l.width, 'Last before Next').toBeLessThanOrEqual(n.x + 0.5)
  }
  const parts: Record<string, Box | null> = {}
  for (const [i, b] of (await visibleBoxes(footer, '[data-followup-label], [data-fact-date-field], [data-followup-quick], [data-followup-help] > :not(:empty), button:not([data-fact-date-field] button):not([data-followup-quick] button)')).entries()) parts[`footer part ${i}`] = b
  expectNoOverlaps(parts)
  // The body and the footer apart.
  expectNoOverlaps({ body: await box(host.locator('[data-task-body]')), footer: await box(footer) })
}

// ── The task editor ─────────────────────────────────────────────────────────

const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit task' })
const editorFooter = (dialog: Locator) => dialog.locator('[data-task-footer]')

async function openEditor(page: Page, title: string): Promise<Locator> {
  await taskRowByTitle(page, title).locator(`span[data-task-title="${title}"]`).dblclick()
  await expect(editor(page)).toBeVisible()
  await settle(editor(page))
  return editor(page)
}

test.describe('the task editor, wide', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  for (const title of [HEAVY, EMPTY]) {
    test(`${title}: the band, the two columns and the footer’s Last · Next · Mark followed up · Done`, async ({ page }) => {
      await seedWorkspace(page, SEED)
      const dialog = await openEditor(page, title)
      expect(Math.round((await box(dialog)).width)).toBe(1060)
      await expectLayoutB(page, dialog, { footer: editorFooter(dialog) })
      const footer = editorFooter(dialog)
      // Done at the right end; the quick intervals shown at this width.
      const [mark, done] = [await box(footer.getByRole('button', { name: 'Mark followed up' })), await box(footer.getByRole('button', { name: 'Done' }))]
      expect(done.x).toBeGreaterThan(mark.x + mark.width - 0.5)
      await expect(footer.getByRole('group', { name: 'Quick follow-up intervals' })).toBeVisible()
      // Created · Modified is the header's now.
      await expect(dialog.locator('[data-task-meta]')).toHaveText(/^Created .* · Modified /)
      if (title === EMPTY) {
        // Empty Notes is one line.
        expect((await box(dialog.locator('[data-task-notes-box]'))).height).toBeLessThan(40)
      } else {
        // Held at its cap, the writing scrolls inside and fades where there is more.
        await expect(dialog.locator('[data-task-writing]')).toHaveAttribute('data-can-scroll-down', '')
      }
      await shot(page, `editor-1440-${title === EMPTY ? 'empty' : 'heavy'}`)
    })
  }

  test('the editor fits its content: few updates — a short popup; many — taller, the log anchored at the bottom', async ({ page }) => {
    await seedWorkspace(page, SEED)
    let dialog = await openEditor(page, EMPTY)
    const short = await box(dialog)
    expect(short.height, 'an empty task’s editor is short').toBeLessThan(470)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    dialog = await openEditor(page, LOGGED)
    const tall = await box(dialog)
    expect(tall.height).toBeGreaterThan(short.height + 150)
    // Status updates sets the height; the writing column (shorter) leaves its room empty, and the log
    // ends right above the update line.
    const list = await box(dialog.locator('[data-status-update-list]'))
    const add = await box(dialog.getByRole('textbox', { name: 'New status update' }))
    expect(add.y - (list.y + list.height)).toBeLessThan(12)
    await shot(page, 'editor-1440-logged')
  })

  test('People and Tags: a pill each with its own ×, then a dashed + that always shows and opens the picker', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, HEAVY)
    const people = dialog.locator('[data-fact="people"]')
    await expect(people.getByRole('button', { name: 'Remove Aisha' })).toBeVisible()
    await expect(people.getByRole('button', { name: 'Remove Ben' })).toBeVisible()
    // Not hovered: the + is there.
    await page.mouse.move(2, 2)
    const addPerson = people.getByRole('button', { name: 'Add person' })
    await expect(addPerson).toBeVisible()
    expect(await addPerson.evaluate((el) => getComputedStyle(el).borderStyle)).toBe('dashed')
    await addPerson.click()
    await expect(page.getByPlaceholder('Search or create people…')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByPlaceholder('Search or create people…')).toHaveCount(0)
    await expect(dialog).toBeVisible()

    const tags = dialog.locator('[data-fact="tags"]')
    await expect(tags.getByRole('button', { name: 'Remove #legal' })).toBeVisible()
    await tags.getByRole('button', { name: 'Add tag' }).click()
    await expect(page.getByPlaceholder('Search tags...')).toBeVisible()
    await page.keyboard.press('Escape')

    // × removes one.
    await people.getByRole('button', { name: 'Remove Ben' }).click()
    await expect(people.getByRole('button', { name: 'Remove Ben' })).toHaveCount(0)
  })

  test('the footer’s fields: the update line, then Last, then Next by Tab; ⏎ writes each; Mark followed up records a follow-up', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, HEAVY)
    const footer = editorFooter(dialog)
    const add = dialog.getByRole('textbox', { name: 'New status update' })
    const next = footer.getByRole('textbox', { name: 'Next follow-up' })
    const last = footer.getByRole('textbox', { name: 'Last follow-up' })
    await add.focus()
    await page.keyboard.press('Tab')
    await expect(last).toBeFocused()
    await page.keyboard.press('Tab') // Last's calendar
    await page.keyboard.press('Tab')
    await expect(next).toBeFocused()

    // Type `2w` in Next, ⏎: written.
    await next.fill('2w')
    await expect(footer.locator('[data-followup-help]')).toContainText('in 2 weeks')
    await next.press('Enter')
    await expect.poll(async () => {
      const t = (await readStore<{ title: string; nextFollowupAt?: Date }>(page, 'todos')).find((r) => r.title === HEAVY)
      return t?.nextFollowupAt ? Math.round((new Date(t.nextFollowupAt).getTime() - Date.now()) / 86_400_000) : null
    }).toBeGreaterThanOrEqual(13)

    // Last: a future day is refused; yesterday is written.
    await last.fill('tomorrow')
    await expect(last).toHaveAttribute('aria-invalid', 'true')
    await last.press('Escape')
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
    await footer.getByRole('button', { name: 'Mark followed up' }).click()
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
    await page.keyboard.type('first')
    await toolbar.getByRole('button', { name: 'Bullet list' }).click()
    await expect(notesBox.locator('.cm-content')).toContainText('first')
  })
})

test.describe('the task editor at 760px', () => {
  test.use({ viewport: { width: 1440, height: 800 } })

  test('the quick intervals give way first; the fields, Mark followed up and Done stay on one line', async ({ page }) => {
    await seedWorkspace(page, SEED)
    // Opened wide (a narrow list row's title lies under its checklist count), then the window narrows.
    await openEditor(page, HEAVY)
    await page.setViewportSize({ width: 792, height: 800 })
    const dialog = editor(page)
    await expect.poll(async () => Math.round((await box(dialog)).width)).toBe(760)
    const footer = editorFooter(dialog)
    await expect(footer.getByRole('group', { name: 'Quick follow-up intervals' })).toBeHidden()
    await expectLayoutB(page, dialog, { footer })
    await shot(page, 'editor-760-heavy')
  })
})

test.describe('the task editor under 600px of body', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('one column — Subtasks, Notes, Status updates; the band wraps; the body scrolls as one', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await openEditor(page, HEAVY)
    await page.setViewportSize({ width: 580, height: 860 })
    await settle(editor(page))
    const dialog = editor(page)
    await expectLayoutB(page, dialog, { stacked: true, footer: editorFooter(dialog) })
    // The band wrapped onto more than one line.
    const cells = await visibleBoxes(dialog.locator('[data-task-facts]'), '[data-fact]')
    expect(new Set(cells.map((c) => Math.round(c.y))).size).toBeGreaterThan(1)
    const writing = await box(dialog.locator('[data-task-writing]'))
    const updates = await box(dialog.locator('[data-task-updates]'))
    expect(Math.abs(writing.x - updates.x)).toBeLessThan(1)
    await dialog.getByRole('textbox', { name: 'New status update' }).scrollIntoViewIfNeeded()
    await expectReachable(page, dialog.getByRole('textbox', { name: 'New status update' }), 'the update line')
    await shot(page, 'editor-580-narrow')
  })
})

test.describe('the new-task editor', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the band and the columns as in edit mode; Last and Next in the footer before Cancel and Create task', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await page.evaluate(async () => {
      const mod = (await import(/* @vite-ignore */ '/src/stores/ui-store.ts' as string)) as {
        useUIStore: { getState: () => { openCreatePopup: () => void } }
      }
      mod.useUIStore.getState().openCreatePopup()
    })
    const dialog = page.getByRole('dialog', { name: 'New task' })
    await expect(dialog).toBeVisible()
    await settle(dialog)
    await expect(dialog.locator('[data-task-facts] [data-fact]')).toHaveCount(6)
    const footer = dialog.locator('[data-task-footer]')
    const [l, n, cancel, create] = [
      await box(footer.getByRole('textbox', { name: 'Last follow-up' })),
      await box(footer.getByRole('textbox', { name: 'Next follow-up' })),
      await box(footer.getByRole('button', { name: 'Cancel' })),
      await box(footer.getByRole('button', { name: 'Create task' })),
    ]
    expect(l.x + l.width).toBeLessThanOrEqual(n.x + 0.5)
    expect(n.x + n.width).toBeLessThanOrEqual(cancel.x + 0.5)
    expect(cancel.x + cancel.width).toBeLessThanOrEqual(create.x + 0.5)
    await shot(page, 'editor-1440-create')
  })
})

// ── The review card ─────────────────────────────────────────────────────────

async function goTo(page: Page, scope: Locator, title: string) {
  const row = scope.locator('[data-review-row]').filter({ hasText: title })
  if (await row.count()) {
    await row.click()
  } else {
    // The queue folded: open it from its Queue button and pick there.
    await scope.locator('[data-review-queue-button]').click()
    await page.locator('[data-review-queue-popover] [data-review-row]').filter({ hasText: title }).click()
  }
  await expect(scope.getByTestId('review-card-title')).toHaveValue(title)
}

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

test.describe('the review card’s footer', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Back and Skip at the left end; Last · Next · Mark followed up › at the right; the fields keep their rules; the Tab order', async ({ page }) => {
    await seedWorkspace(page, WIDGET_SEED)
    const widget = page.locator('[data-review-widget="rv1"]')
    await pickInReview(page, 'rv1', 'Aisha')
    await expect(widget).toHaveAttribute('data-review-face', 'large')
    await goTo(page, widget, HEAVY)
    const footer = widget.locator('[data-review-footer]')
    const [back, skip, lastBox] = [
      await box(footer.getByRole('button', { name: /^Back/ })),
      await box(footer.getByRole('button', { name: /^Skip/ })),
      await box(footer.getByRole('textbox', { name: 'Last follow-up' })),
    ]
    expect(back.x + back.width).toBeLessThanOrEqual(skip.x + 0.5)
    expect(skip.x + skip.width).toBeLessThan(lastBox.x)

    const update = widget.getByLabel('Status update · today')
    const next = widget.getByRole('textbox', { name: 'Next follow-up' })
    const last = widget.getByRole('textbox', { name: 'Last follow-up' })
    await expect(widget.getByTestId('review-last-followup')).toContainText('2 weeks ago')

    // Tab from the update line: Last and its calendar, Next, its ×, calendar and quick buttons, Mark followed up, then Back and Skip.
    await update.focus()
    const stops: string[] = []
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      const name = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '')
      stops.push(name)
      if (/Skip/.test(name)) break
    }
    expect(stops.slice(0, 9)).toEqual(['Last follow-up', 'Pick last follow-up date', 'Next follow-up', 'Clear next follow-up', 'Pick next follow-up date', 'Follow up in 1 day', 'Follow up in 1 week', 'Follow up in 1 month', 'Follow up in 3 months'])
    expect(stops.slice(9).join(' | ')).toMatch(/Mark followed up.*\|.*Back.*\|.*Skip/)

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
  })
})

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
      test(`${title}: the band, the columns and the footer in view; nothing overlaps; the queue ${size.width < 820 ? 'folded' : 'beside the card'}`, async ({ page }) => {
        await seedWorkspace(page, WIDGET_SEED)
        await pickInReview(page, 'rv1', 'Aisha')
        const widget = await sizeWidget(page, size.width, size.height)
        await expect(widget).toHaveAttribute('data-review-face', 'large')
        await goTo(page, widget, title)
        await expectLayoutB(page, widget, { footer: widget.locator('[data-review-footer]') })
        // The card fills its cell: the body reaches the footer.
        const [body, footer] = [await box(widget.locator('[data-task-body]')), await box(widget.locator('[data-review-footer]'))]
        expect(footer.y - (body.y + body.height)).toBeLessThan(2)
        if (size.width < 820) {
          await expect(widget.locator('[data-review-rail]')).toHaveCount(0)
          await expect(widget.locator('[data-review-queue-button]')).toBeVisible()
        } else {
          await expect(widget.locator('[data-review-rail]')).toBeVisible()
        }
        await shot(page, `widget-${size.width}x${size.height}-${title === EMPTY ? 'empty' : 'heavy'}`)
      })
    }
  })
}

test.describe('the Review widget across widths', () => {
  test.use({ viewport: { width: 1460, height: 720 } })

  test('660 → 1400px at 600px tall: the footer stays one line — the quick intervals go first', async ({ page }) => {
    await seedWorkspace(page, WIDGET_SEED)
    await pickInReview(page, 'rv1', 'Aisha')
    const widget = page.locator('[data-review-widget="rv1"]')
    await goTo(page, widget, HEAVY)
    for (const width of [660, 700, 760, 819, 820, 860, 940, 1040, 1200, 1400]) {
      await sizeWidget(page, width, 600)
      await expect(widget).toHaveAttribute('data-review-face', 'large')
      await expectLayoutB(page, widget, { footer: widget.locator('[data-review-footer]') })
    }
  })

  test('the medium face keeps its shape: the update line and the Next row over the footer', async ({ page }) => {
    await seedWorkspace(page, WIDGET_SEED)
    await pickInReview(page, 'rv1', 'Aisha')
    const widget = await sizeWidget(page, 660, 300)
    await expect(widget).toHaveAttribute('data-review-face', 'medium')
    for (const title of [HEAVY, EMPTY]) {
      while ((await widget.getByTestId('review-card-title').inputValue()) !== title) {
        await widget.getByRole('button', { name: /^Skip/ }).click()
      }
      const update = widget.getByLabel('Status update · today')
      const next = widget.getByRole('textbox', { name: 'Next follow-up' })
      await expectReachable(page, update, 'the update line')
      await expectReachable(page, next, 'the Next field')
      await expectReachable(page, widget.getByRole('button', { name: 'Mark followed up' }), 'Mark followed up')
      await expect(widget.getByRole('textbox', { name: 'Last follow-up' })).toHaveCount(0)
      expect((await box(next)).y).toBeGreaterThan((await box(update)).y + 20)
      expectNoOverlaps({ dock: await box(widget.locator('[data-review-dock]')), footer: await box(widget.locator('[data-review-footer]')) })
      await shot(page, `widget-660x300-medium-${title === EMPTY ? 'empty' : 'heavy'}`)
    }
  })
})
