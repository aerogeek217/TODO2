import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, seedWorkspace, wsCell, type WorkspaceSeed, type WsTabSeed } from './fixtures/workspace'
import { box, pointIn, type Point } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * Calendar widget in a real browser: list rows dropped on a day (with the
 * Due / Follow-up chooser when both date types are shown, directly when one
 * is), calendar entries moving their own date, recurring occurrences not
 * dragging, month / week navigation saved as view state, the "+N more" day
 * popover and the compact month's day selection.
 */

const TASK_LIST = { name: 'Everything' }

function layoutWith(calendar: Omit<WsTabSeed, 'id' | 'kind'>, opts: { listWeight?: number } = {}): WorkspaceSeed['layouts'] {
  return [{
    name: 'Main',
    columns: [
      { id: 'colA', weight: opts.listWeight ?? 1, cells: [{ id: 'a1', tabs: [{ id: 'lensTab', kind: 'lens', listDefIdx: 0 }] }] },
      { id: 'colB', weight: 2, cells: [{ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar', ...calendar }] }] },
    ],
  }]
}

const saveButton = (page: Page) => page.getByTestId('layout-save')
const calendar = (page: Page) => page.locator('[data-calendar-widget="calTab"]')

/** The `data-day` key (local `YYYY-MM-DD`, in the page's time zone) of today + `n` days. */
async function dayKey(page: Page, n: number): Promise<string> {
  return page.evaluate((n) => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, n)
}

async function day(page: Page, n: number): Promise<Locator> {
  return calendar(page).locator(`[data-day="${await dayKey(page, n)}"]`)
}

interface StoredTodo {
  id: number
  title: string
  dueDate?: Date
  nextFollowupAt?: Date
  lastFollowupAt?: Date
}

async function readTodo(page: Page, title: string): Promise<StoredTodo> {
  const t = (await readStore<StoredTodo>(page, 'todos')).find((x) => x.title === title)
  if (!t) throw new Error(`no task "${title}"`)
  return { id: t.id, title: t.title, dueDate: t.dueDate, nextFollowupAt: t.nextFollowupAt, lastFollowupAt: t.lastFollowupAt }
}

/** Midnight of today + `n` days plus `hour`, in the page's time zone (ms). */
async function dayAt(page: Page, n: number, hour: number): Promise<number> {
  return page.evaluate(([n, hour]) => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, hour).getTime()
  }, [n, hour] as const)
}

/** Drags `from` (grabbed at `grabX` px from its left) onto the middle of `to`, checking `during` before letting go. */
async function dragOnto(page: Page, from: Locator, to: Locator, during?: () => Promise<void>, grabX = 40): Promise<Point> {
  const a = await box(from)
  const end = await pointIn(to)
  await drag(page, { x: a.x + Math.min(grabX, a.width / 2), y: a.y + a.height / 2 }, end, { during })
  return end
}

/**
 * A menu opened at point `p` has a corner there: its left edge at `p.x`, or —
 * flipped, when it would pass the viewport's right edge (a day in the week's
 * last columns) — its right edge; its top just below `p.y`, or its bottom just
 * above when flipped up (a day in the month's last rows).
 */
async function expectCornerAt(menu: Locator, p: Point): Promise<void> {
  const b = await box(menu)
  const near = (a: number, z: number) => Math.abs(a - z) <= 6
  expect(near(b.x, p.x) || near(b.x + b.width, p.x), `menu x ${b.x}–${b.x + b.width} vs point ${p.x}`).toBe(true)
  expect(near(b.y, p.y) || near(b.y + b.height, p.y), `menu y ${b.y}–${b.y + b.height} vs point ${p.y}`).toBe(true)
}

const listRow = (page: Page, title: string) => wsCell(page, 'a1').locator('[data-row-key]').filter({ hasText: title })
const chooser = (page: Page) => page.getByRole('menu', { name: 'Set which date' })

test.describe('dropping a list task on a day', () => {
  test('both date types shown: the chooser sets the picked date (and Esc changes nothing)', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [TASK_LIST],
      tasks: [{ title: 'Draft OKRs', dueInDays: 1, dueHour: 15 }],
      layouts: layoutWith({}),
    })
    const target = await day(page, 3)
    const end = await dragOnto(page, listRow(page, 'Draft OKRs'), target, async () => {
      await expect(target).toHaveAttribute('data-drop-target', 'true')
      await expect(target).toContainText('Set date')
    })

    // The chooser opens at the pointer; the day stays highlighted.
    const menu = chooser(page)
    await expect(menu).toBeVisible()
    await expectCornerAt(menu, { x: end.x + 2, y: end.y + 10 })
    await expect(target).toHaveAttribute('data-drop-target', 'true')
    await expect(menu.getByRole('menuitem', { name: /Due date/ })).toContainText('was')
    await expect(menu.getByRole('menuitem', { name: /Follow-up/ })).toContainText('not set')
    await expect(menu.getByRole('menuitem', { name: /Due date/ })).toBeFocused()

    // Esc: nothing changes.
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(target).not.toHaveAttribute('data-drop-target', 'true')
    const unchanged = await readTodo(page, 'Draft OKRs')
    expect(unchanged.dueDate?.getTime()).toBe(await dayAt(page, 1, 15))
    expect(unchanged.nextFollowupAt).toBeUndefined()

    // F picks Follow-up: next follow-up at noon on the day, due date untouched.
    await dragOnto(page, listRow(page, 'Draft OKRs'), target)
    await expect(chooser(page)).toBeVisible()
    await page.keyboard.press('f')
    await expect(chooser(page)).toHaveCount(0)
    await expect(target.locator('[data-cal-entry="followup"]')).toContainText('Draft OKRs')
    const after = await readTodo(page, 'Draft OKRs')
    expect(after.nextFollowupAt?.getTime()).toBe(await dayAt(page, 3, 12))
    expect(after.lastFollowupAt).toBeUndefined()
    expect(after.dueDate?.getTime()).toBe(await dayAt(page, 1, 15))

    // Clicking Due date moves the due date, keeping its time of day.
    const other = await day(page, 4)
    await dragOnto(page, listRow(page, 'Draft OKRs'), other)
    await chooser(page).getByRole('menuitem', { name: /Due date/ }).click()
    await expect(other.locator('[data-cal-entry="due"]')).toContainText('Draft OKRs')
    expect((await readTodo(page, 'Draft OKRs')).dueDate?.getTime()).toBe(await dayAt(page, 4, 15))
    // Task drops aren't layout changes.
    await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  })

  test('one date type shown: the drop sets it with no chooser', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [TASK_LIST],
      tasks: [{ title: 'Call legal' }],
      layouts: layoutWith({ dateTypes: { due: false, followup: true } }),
    })
    const target = await day(page, 2)
    await dragOnto(page, listRow(page, 'Call legal'), target, async () => {
      await expect(target).toContainText('Set follow-up')
    })
    await expect(target.locator('[data-cal-entry="followup"]')).toContainText('Call legal')
    await expect(chooser(page)).toHaveCount(0)
    const t = await readTodo(page, 'Call legal')
    expect(t.nextFollowupAt?.getTime()).toBe(await dayAt(page, 2, 12))
    expect(t.dueDate).toBeUndefined()
  })

  test('no date type shown: the drop is refused and sets nothing', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [TASK_LIST],
      tasks: [{ title: 'Call legal' }],
      layouts: layoutWith({ dateTypes: { due: false, followup: false } }),
    })
    await expect(calendar(page).getByTestId('calendar-empty')).toHaveAttribute('data-empty', 'no-types')
    const target = await day(page, 2)
    await dragOnto(page, listRow(page, 'Call legal'), target, async () => {
      await expect(target).not.toHaveAttribute('data-drop-target', 'true')
    })
    await expect(chooser(page)).toHaveCount(0)
    await expect(calendar(page).locator('[data-cal-entry]')).toHaveCount(0)
    const t = await readTodo(page, 'Call legal')
    expect(t.dueDate).toBeUndefined()
    expect(t.nextFollowupAt).toBeUndefined()
  })
})

test('dragging an entry moves its own date only, with no chooser', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [TASK_LIST],
    tasks: [{ title: 'Sign off on new logo', dueInDays: 1, followupInDays: 2 }],
    layouts: layoutWith({}),
  })
  const from = (await day(page, 2)).locator('[data-cal-entry="followup"]')
  const target = await day(page, 4)
  await dragOnto(page, from, target, async () => {
    await expect(target).toContainText('Move here')
    await expect(page.locator('[data-drag-overlay] [data-cal-entry="followup"]')).toBeVisible()
  }, 10)
  await expect(chooser(page)).toHaveCount(0)
  await expect(target.locator('[data-cal-entry="followup"]')).toContainText('Sign off on new logo')
  const t = await readTodo(page, 'Sign off on new logo')
  expect(t.nextFollowupAt?.getTime()).toBe(await dayAt(page, 4, 0))
  expect(t.dueDate?.getTime()).toBe(await dayAt(page, 1, 0))
})

test('a recurring occurrence does not drag; clicking it opens the task', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [TASK_LIST],
    tasks: [{ title: '1:1 with Ben', dueInDays: -7, recurrence: 'weekly' }],
    layouts: layoutWith({ view: 'week', offset: 0 }),
  })
  const occurrence = (await day(page, 0)).locator('[data-cal-entry="due"][data-virtual="true"]')
  await expect(occurrence).toContainText('1:1 with Ben')
  await expect(occurrence).toHaveAttribute('title', /Occurrences can’t be dragged/)
  const target = calendar(page).locator('[data-day]:not([data-today])').first()
  await dragOnto(page, occurrence, target, async () => {
    await expect(page.locator('[data-drag-overlay]')).toHaveCount(0)
    await expect(target).not.toHaveAttribute('data-drop-target', 'true')
    await expect(calendar(page)).not.toHaveAttribute('data-dragging', 'true')
  }, 10)
  expect((await readTodo(page, '1:1 with Ben')).dueDate?.getTime()).toBe(await dayAt(page, -7, 0))

  await occurrence.click()
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
  await expect.poll(() => page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).some((el) => el.value === '1:1 with Ben'),
  )).toBe(true)
})

test('month navigation is view state: saved across reload, never unsaved', async ({ page }) => {
  await seedWorkspace(page, { listDefinitions: [TASK_LIST], layouts: layoutWith({ view: 'month', offset: 0 }) })
  const label = calendar(page).getByTestId('calendar-range-label')
  const names = await page.evaluate(() => {
    const now = new Date()
    const name = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    return { now: name(now), next: name(new Date(now.getFullYear(), now.getMonth() + 1, 1)), after: name(new Date(now.getFullYear(), now.getMonth() + 2, 1)) }
  })
  await expect(label).toHaveText(names.now)
  await calendar(page).getByRole('button', { name: 'Next month' }).click()
  await calendar(page).getByRole('button', { name: 'Next month' }).click()
  await expect(label).toHaveText(names.after)
  await calendar(page).getByRole('button', { name: 'Previous month' }).click()
  await expect(label).toHaveText(names.next)
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')

  await page.reload()
  await expect(label).toHaveText(names.next)
  await calendar(page).getByRole('button', { name: 'Today' }).click()
  await expect(label).toHaveText(names.now)

  // Week view: the week holding today, Previous / Next step a week.
  await calendar(page).getByRole('button', { name: 'Week', exact: true }).click()
  await expect(calendar(page).getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(calendar(page).locator('[data-today="true"]')).toHaveCount(1)
  await calendar(page).getByRole('button', { name: 'Next week' }).click()
  await expect(calendar(page).locator('[data-today="true"]')).toHaveCount(0)
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
})

test('date-type toggles are layout config: unsaved until saved; both can be off', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [TASK_LIST],
    tasks: [{ title: 'Both dates', dueInDays: 1, followupInDays: 1 }],
    layouts: layoutWith({}),
  })
  const tomorrow = await day(page, 1)
  await expect(tomorrow.locator('[data-cal-entry]')).toHaveCount(2)
  const due = calendar(page).getByRole('group', { name: 'Date types shown' }).locator('[data-type="due"]')
  const followup = calendar(page).getByRole('group', { name: 'Date types shown' }).locator('[data-type="followup"]')
  await due.click()
  await expect(due).toHaveAttribute('aria-pressed', 'false')
  await expect(tomorrow.locator('[data-cal-entry]')).toHaveCount(1)
  await expect(tomorrow.locator('[data-cal-entry="followup"]')).toHaveCount(1)
  await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
  // The last type on turns off too: nothing shows, and the calendar says why.
  await followup.click()
  await expect(followup).toHaveAttribute('aria-pressed', 'false')
  await expect(calendar(page).locator('[data-cal-entry]')).toHaveCount(0)
  await expect(calendar(page).getByTestId('calendar-empty')).toContainText('No date types shown')
  await followup.click()
  await expect(tomorrow.locator('[data-cal-entry="followup"]')).toHaveCount(1)
})

test('+N more opens the day with every entry', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await seedWorkspace(page, {
    listDefinitions: [TASK_LIST],
    tasks: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((title) => ({ title, dueInDays: 1 })),
    layouts: layoutWith({ view: 'month', offset: 0 }),
  })
  const tomorrow = await day(page, 1)
  const more = tomorrow.getByRole('button', { name: /^\+\d+ more$/ })
  await expect(more).toBeVisible()
  const shown = await tomorrow.locator('[data-cal-entry]').count()
  await expect(more).toHaveText(`+${6 - shown} more`)
  await more.click()
  const popover = page.getByTestId('calendar-day-popover')
  await expect(popover).toBeVisible()
  await expect(popover.locator('[data-cal-entry]')).toHaveCount(6)
  await expect(popover).toHaveAttribute('aria-label', /6 tasks$/)
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)

  // An entry dragged out of the popover moves; the popover closes.
  await more.click()
  const target = await day(page, 5)
  await dragOnto(page, popover.locator('[data-cal-entry]').filter({ hasText: 'Six' }), target, async () => {
    await expect(popover).toBeHidden()
    await expect(target).toContainText('Move here')
  }, 10)
  await expect(popover).toHaveCount(0)
  expect((await readTodo(page, 'Six')).dueDate?.getTime()).toBe(await dayAt(page, 5, 0))
})

test('a narrow calendar shows dots; selecting a day lists its entries', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [TASK_LIST],
    tasks: [{ title: 'Pick up prescriptions', dueInDays: 2 }, { title: 'Vendor contract', followupInDays: 2 }],
    layouts: layoutWith({ view: 'month', offset: 0 }, { listWeight: 6 }),
  })
  await expect(calendar(page)).toHaveAttribute('data-mode', 'compact')
  const target = await day(page, 2)
  await expect(target.locator('[data-dot]')).toHaveCount(2)
  await target.click()
  await expect(target).toHaveAttribute('aria-pressed', 'true')
  const list = calendar(page).locator(`[data-cal-day-list="${await dayKey(page, 2)}"]`)
  await expect(list).toContainText('2 tasks')
  await expect(list.locator('[data-cal-entry="due"]')).toContainText('Pick up prescriptions')
  await expect(list.locator('[data-cal-entry="followup"]')).toContainText('Vendor contract')
})

/** The calendar in week rows (under 560px wide), in a cell `calWeight` of its column's height (the rest is a notes cell). */
function weekRowsLayout(calWeight: number): WorkspaceSeed['layouts'] {
  return [{
    name: 'Main',
    columns: [
      { id: 'colA', weight: 3, cells: [{ id: 'a1', tabs: [{ id: 'lensTab', kind: 'lens', listDefIdx: 0 }] }] },
      {
        id: 'colB',
        weight: 2,
        cells: [
          { id: 'b1', weight: calWeight, tabs: [{ id: 'calTab', kind: 'calendar', view: 'week', offset: 0 }] },
          ...(calWeight < 1 ? [{ id: 'b2', weight: 1 - calWeight, tabs: [{ id: 'notesTab', kind: 'notes' as const }] }] : []),
        ],
      },
    ],
  }]
}

/** Every week row: its entries and `+N more` stay inside it (none drawn over the next day). */
async function expectRowsContainTheirEntries(page: Page): Promise<void> {
  const overflow = await calendar(page).locator('[data-cal-grid="rows"]').evaluate((grid) =>
    Array.from(grid.children).flatMap((row) => {
      const bottom = row.getBoundingClientRect().bottom
      return Array.from(row.querySelectorAll('[data-cal-entry], button'))
        .filter((el) => el.getBoundingClientRect().bottom > bottom + 0.5)
        .map((el) => `${(row as HTMLElement).dataset.day}: ${el.textContent}`)
    }),
  )
  expect(overflow).toEqual([])
}

test.describe('week rows', () => {
  test('a short cell caps each day to its row with +N more instead of drawing over the next days', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [TASK_LIST],
      tasks: ['One', 'Two', 'Three', 'Four', 'Five'].map((title) => ({ title, dueInDays: 0 })),
      layouts: weekRowsLayout(0.25),
    })
    await expect(calendar(page)).toHaveAttribute('data-mode', 'rows')
    const today = await day(page, 0)
    const more = today.getByRole('button', { name: /^\+\d+ more$/ })
    await expect(more).toBeVisible()
    const shown = await today.locator('[data-cal-entry]').count()
    await expect(more).toHaveText(`+${5 - shown} more`)
    await expectRowsContainTheirEntries(page)

    await more.click()
    const popover = page.getByTestId('calendar-day-popover')
    await expect(popover.locator('[data-cal-entry]')).toHaveCount(5)
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
  })

  test('a tall cell gives a busy day the room the quiet days leave, without scrolling', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [TASK_LIST],
      tasks: Array.from({ length: 30 }, (_, n) => ({ title: `Busy ${n + 1}`, dueInDays: 0 })),
      layouts: weekRowsLayout(1),
    })
    await expect(calendar(page)).toHaveAttribute('data-mode', 'rows')
    const today = await day(page, 0)
    const more = today.getByRole('button', { name: /^\+\d+ more$/ })
    await expect(more).toBeVisible()
    const shown = await today.locator('[data-cal-entry]').count()
    expect(shown).toBeGreaterThan(4)
    await expect(more).toHaveText(`+${30 - shown} more`)
    await expectRowsContainTheirEntries(page)
    const rows = calendar(page).locator('[data-cal-grid="rows"]')
    expect(await rows.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true)
  })
})
