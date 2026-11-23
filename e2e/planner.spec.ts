import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, expectLayoutStored, newestUndoStep, openCellMenu, releaseDrag, seedWorkspace, wsCell, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'
import { readStore } from './fixtures/db'
import { filterClear, filterField } from './fixtures/filters'

/**
 * The Planner's drags and its row menu: the Planner is a scratch pad, so a
 * row dropped on a day tile or in a group changes **only its plan** — a
 * planned day, cleared on the day its own date puts it; held in Unplanned
 * for a dated row — and never its due date or its follow-up; the Delayed
 * tray (a plan whose day has passed) takes no drop. A drop into a group
 * also puts the row where it was dropped (the hand order, saved with the
 * layout). While it is dragged the target is dashed in one neutral color
 * and the lifted row's label says what the drop does (`Plan · Wed, Nov 25`,
 * `Its date · …`, `Unplan`). A plan write never stamps the task. Snooze,
 * Unplan and Plan for day › move it from the keyboard (a day they pick is
 * planned outright, its own date's day too). A list's
 * row is taken by the same rule; a Planner row on a calendar day is the
 * calendar's drop; one on a list does nothing.
 *
 * And its layout: the days in one list on the left (a tile's click scrolls
 * to its day), the trays on the right with the ↓ Unplan button between
 * them, Reset plan, and a row's Planner marks — the corner flag, the tag
 * and its fixes, the late date, the hover Snooze / Unplan — at Rows, at
 * Stacked and on the phone.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const STAMP = '2026-10-10T15:30'

/** Today: a late deadline, a follow-up, a plan. Ahead: a deadline and a follow-up in two days. Focus: one planned, one not. */
const TASKS: NonNullable<WorkspaceSeed['tasks']> = [
  { title: 'Renew the domain', dueInDays: -2, modifiedAt: STAMP },
  { title: 'Chase the invoice', followupInDays: 0, modifiedAt: STAMP },
  { title: 'Write the brief', doInDays: 0, dueInDays: 5, modifiedAt: STAMP },
  { title: 'Book the venue', dueInDays: 2, modifiedAt: STAMP },
  { title: 'Call the caterer', followupInDays: 2, modifiedAt: STAMP },
  { title: 'Someday focus', focus: true, modifiedAt: STAMP },
  { title: 'Planned focus', focus: true, doInDays: 1, modifiedAt: STAMP },
  { title: 'Not planned', modifiedAt: STAMP },
]

const LAYOUT: NonNullable<WorkspaceSeed['layouts']> = [{
  name: 'Week',
  columns: [
    { id: 'c1', weight: 5, rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }] })] },
    { id: 'c2', weight: 2, rows: [wsRow({ id: 'k2', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] },
  ],
}]

/** The Planner wide (its large face) beside a list of every task. */
const WIDE: WorkspaceSeed = { tasks: TASKS, listDefinitions: [{ name: 'Everything', sort: 'manual' }], layouts: LAYOUT }

const planner = (page: Page) => page.locator('[data-planner="plan"]')
const group = (page: Page, key: string) => planner(page).locator(`[data-planner-group="${key}"]`)
const todayGroup = (page: Page) => planner(page).locator('[data-planner-group-kind="today"]')
const unplannedGroup = (page: Page) => group(page, 'unplanned')
const delayedGroup = (page: Page) => group(page, 'delayed')
const tile = (page: Page, key: string) => planner(page).locator(`[data-planner-tile="${key}"]`)
/** The rows' titles: the title's own text (a Planner row's title also holds its tag). */
const titles = (scope: Locator) => scope.locator('[data-title-text]')
const rowOf = (scope: Locator, title: string) => scope.locator('[data-row-key]').filter({ hasText: title })
const label = (page: Page) => page.getByTestId('planner-drag-label')

const dayKeyIn = (page: Page, days: number) => page.evaluate((n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}, days)

/** A day in the Planner's words (`Wed, Nov 25`), `days` from today. */
const dayWords = (page: Page, days: number) => page.evaluate((n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}, days)

interface StoredTask { title: string; uid: string; doDate?: Date; unplanned?: boolean; dueDate?: Date; nextFollowupAt?: Date; modifiedAt: Date }

/** A stored date as `[days from today, hour, minute]`; null when absent. */
function dayAndTime(value: Date | undefined, now: Date): [number, number, number] | null {
  if (!value) return null
  const d = new Date(value)
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  return [Math.round((midnight(d) - midnight(now)) / 86_400_000), d.getHours(), d.getMinutes()]
}

/** What the database holds of the task: its plan (`doDate`, `held`), and each real date, as `[days from today, hour, minute]`. */
async function stored(page: Page, title: string) {
  const task = (await readStore<StoredTask>(page, 'todos')).find((t) => t.title === title)
  if (!task) throw new Error(`no task "${title}"`)
  const now = new Date()
  return {
    doDate: dayAndTime(task.doDate, now),
    held: task.unplanned === true,
    dueDate: dayAndTime(task.dueDate, now),
    followup: dayAndTime(task.nextFollowupAt, now),
    modifiedAt: new Date(task.modifiedAt).getTime(),
  }
}

/** The Planner tab's stored hand order, as task titles. */
async function storedOrder(page: Page): Promise<string[] | null> {
  const layouts = await readStore<{ cells: Array<{ tabs: Array<{ id: string; viewState?: { order?: string[] } }> }> }>(page, 'layouts')
  const order = layouts.flatMap((l) => l.cells).flatMap((c) => c.tabs).find((t) => t.id === 'plan')?.viewState?.order
  if (!order) return null
  const byUid = new Map((await readStore<StoredTask>(page, 'todos')).map((t) => [t.uid, t.title]))
  return order.map((uid) => byUid.get(uid) ?? uid)
}

/** Where to grab a row: near its title's start (clear of its checkbox and its cells' buttons). */
async function grip(row: Locator): Promise<{ x: number; y: number }> {
  const b = await box(row)
  return { x: b.x + 70, y: b.y + b.height / 2 }
}

const STAMP_MS = new Date(STAMP).getTime()

/** The target's mark while a drop would change the plan: there, and in no date's tone. */
const expectMarked = (target: Locator) => expect(target).toHaveAttribute('data-planner-drop', '')

test('a row there by its follow-up, dropped on a later tile: it keeps its follow-up and gets a planned day', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inThree = await dayKeyIn(page, 3)
  const row = rowOf(todayGroup(page), 'Chase the invoice')
  await drag(page, await grip(row), await pointIn(tile(page, inThree)), {
    during: async () => {
      // The tile — and the day's group — dashed, in one neutral mark; the lifted row says the drop plans it.
      await expectMarked(tile(page, inThree))
      await expectMarked(group(page, inThree))
      await expect(label(page)).toHaveText(`Plan · ${await dayWords(page, 3)}`)
      await expect(label(page)).not.toHaveAttribute('data-tone')
      await expect(page.locator('html')).not.toHaveAttribute('data-drop-refused')
    },
  })
  await expect(titles(group(page, inThree))).toHaveText(['Chase the invoice'])
  await expect(titles(todayGroup(page))).toHaveText(['Renew the domain', 'Write the brief'])
  await expect(planner(page).locator('[data-planner-drop]')).toHaveCount(0)
  await expect(label(page)).toHaveCount(0)
  // Only the plan: the planned day at local midnight, the follow-up where it was, the task not stamped.
  await expect.poll(async () => (await stored(page, 'Chase the invoice')).doDate).toEqual([3, 0, 0])
  expect(await stored(page, 'Chase the invoice')).toEqual({ doDate: [3, 0, 0], held: false, dueDate: null, followup: [0, 0, 0], modifiedAt: STAMP_MS })
})

test('a row there by its due date, dropped on a tile: a planned day, the due date kept — and the undo of the plan leaves the Modified date alone', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inTwo = await dayKeyIn(page, 2)
  const inFour = await dayKeyIn(page, 4)
  await drag(page, await grip(rowOf(group(page, inTwo), 'Book the venue')), await pointIn(tile(page, inFour)), {
    during: async () => {
      await expectMarked(tile(page, inFour))
      await expect(label(page)).toHaveText(`Plan · ${await dayWords(page, 4)}`)
    },
  })
  await expect(titles(group(page, inFour))).toHaveText(['Book the venue'])
  await expect(titles(group(page, inTwo))).toHaveText(['Call the caterer'])
  await expect.poll(async () => (await stored(page, 'Book the venue')).doDate).toEqual([4, 0, 0])
  // Planning doesn't touch the task's due date or its Modified date.
  expect(await stored(page, 'Book the venue')).toEqual({ doDate: [4, 0, 0], held: false, dueDate: [2, 0, 0], followup: null, modifiedAt: STAMP_MS })

  // One undo step: the plan goes, the row is back on its due date, the stamp as it was.
  await expect.poll(() => newestUndoStep(page)).toMatch(/^Planned “Book the venue”/)
  await page.keyboard.press('Control+z')
  await expect(titles(group(page, inTwo))).toHaveText(['Book the venue', 'Call the caterer'])
  await expect.poll(async () => (await stored(page, 'Book the venue')).doDate).toBeNull()
  expect(await stored(page, 'Book the venue')).toEqual({ doDate: null, held: false, dueDate: [2, 0, 0], followup: null, modifiedAt: STAMP_MS })
  // And its redo.
  await page.keyboard.press('Control+y')
  await expect(titles(group(page, inFour))).toHaveText(['Book the venue'])
  await expect.poll(async () => (await stored(page, 'Book the venue')).doDate).toEqual([4, 0, 0])
  expect((await stored(page, 'Book the venue')).modifiedAt).toBe(STAMP_MS)
})

test('a row dropped on the day its own date puts it loses its plan', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inTwo = await dayKeyIn(page, 2)
  const inFive = await dayKeyIn(page, 5)
  // Planned for today, due in five days: on its due date's tile the plan is cleared.
  await drag(page, await grip(rowOf(todayGroup(page), 'Write the brief')), await pointIn(tile(page, inFive)), {
    during: async () => {
      await expectMarked(tile(page, inFive))
      await expect(label(page)).toHaveText(`Its date · ${await dayWords(page, 5)}`)
    },
  })
  await expect(titles(group(page, inFive))).toHaveText(['Write the brief'])
  await expect(titles(todayGroup(page))).toHaveText(['Renew the domain', 'Chase the invoice'])
  await expect.poll(async () => (await stored(page, 'Write the brief')).doDate).toBeNull()
  expect(await stored(page, 'Write the brief')).toEqual({ doDate: null, held: false, dueDate: [5, 0, 0], followup: null, modifiedAt: STAMP_MS })

  // A row planned away from its follow-up's day and dropped back into that day's group: the same.
  await drag(page, await grip(rowOf(group(page, inTwo), 'Call the caterer')), await pointIn(tile(page, inFive)))
  await expect.poll(async () => (await stored(page, 'Call the caterer')).doDate).toEqual([5, 0, 0])
  const venue = await box(rowOf(group(page, inTwo), 'Book the venue'))
  // Over the lower half of the day's one row: after it.
  await drag(page, await grip(rowOf(group(page, inFive), 'Call the caterer')), { x: venue.x + 120, y: venue.y + venue.height - 3 }, {
    during: async () => { await expect(label(page)).toHaveText(`Its date · ${await dayWords(page, 2)}`) },
  })
  await expect(titles(group(page, inTwo))).toHaveText(['Book the venue', 'Call the caterer'])
  await expect.poll(async () => (await stored(page, 'Call the caterer')).doDate).toBeNull()
  expect(await stored(page, 'Call the caterer')).toEqual({ doDate: null, held: false, dueDate: null, followup: [2, 0, 0], modifiedAt: STAMP_MS })
})

test('a dated row dropped on Unplanned is held there, keeps its date, and is still there after a reload', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inTwo = await dayKeyIn(page, 2)
  const unplanned = unplannedGroup(page)
  await expect(titles(unplanned)).toHaveText(['Someday focus'])
  // The tile's name: its rows, then its marks — a due date and a follow-up fall on the day.
  await expect(tile(page, inTwo)).toHaveAccessibleName(/: 2 tasks, 1 due, 1 follow-up$/)

  await drag(page, await grip(rowOf(group(page, inTwo), 'Book the venue')), await pointIn(unplanned, 0.5, 0.7), {
    during: async () => {
      await expectMarked(unplanned)
      await expect(label(page)).toHaveText('Unplan')
      await expect(page.locator('html')).not.toHaveAttribute('data-drop-refused')
    },
  })
  await expect(titles(unplanned)).toContainText(['Book the venue'])
  await expect(titles(unplanned)).toHaveCount(2)
  await expect(titles(group(page, inTwo))).toHaveText(['Call the caterer'])
  // One row fewer; the held task's due date still marks the day.
  await expect(tile(page, inTwo)).toHaveAccessibleName(/: 1 task, 1 due, 1 follow-up$/)
  await expect.poll(async () => (await stored(page, 'Book the venue')).held).toBe(true)
  expect(await stored(page, 'Book the venue')).toEqual({ doDate: null, held: true, dueDate: [2, 0, 0], followup: null, modifiedAt: STAMP_MS })
  await expect.poll(() => newestUndoStep(page)).toMatch(/^Unplanned “Book the venue”/)

  await expectLayoutStored(page)
  await page.reload()
  await expect(titles(unplannedGroup(page))).toContainText(['Book the venue'])
  await expect(titles(unplannedGroup(page))).toHaveCount(2)
  await expect(titles(group(page, inTwo))).toHaveText(['Call the caterer'])
  expect((await stored(page, 'Book the venue')).held).toBe(true)

  // A planned row with a date is held too: its planned day goes in the same write.
  await drag(page, await grip(rowOf(todayGroup(page), 'Write the brief')), await pointIn(unplannedGroup(page), 0.5, 0.85))
  await expect(titles(unplannedGroup(page))).toContainText(['Write the brief'])
  await expect.poll(async () => (await stored(page, 'Write the brief')).held).toBe(true)
  expect(await stored(page, 'Write the brief')).toEqual({ doDate: null, held: true, dueDate: [5, 0, 0], followup: null, modifiedAt: STAMP_MS })
})

test('a Focus row dropped on a day is planned there; dropped back on Unplanned it just loses its plan', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inThree = await dayKeyIn(page, 3)
  const unplanned = unplannedGroup(page)
  await drag(page, await grip(rowOf(unplanned, 'Someday focus')), await pointIn(tile(page, inThree)), {
    during: async () => { await expect(label(page)).toHaveText(`Plan · ${await dayWords(page, 3)}`) },
  })
  await expect(titles(group(page, inThree))).toHaveText(['Someday focus'])
  await expect(titles(unplanned)).toHaveCount(0)
  await expect.poll(async () => (await stored(page, 'Someday focus')).doDate).toEqual([3, 0, 0])
  expect((await stored(page, 'Someday focus')).modifiedAt).toBe(STAMP_MS)

  await drag(page, await grip(rowOf(group(page, inThree), 'Someday focus')), await pointIn(unplanned, 0.5, 0.5), {
    during: async () => {
      await expectMarked(unplanned)
      await expect(label(page)).toHaveText('Unplan')
    },
  })
  await expect(titles(unplanned)).toHaveText(['Someday focus'])
  await expect(titles(group(page, inThree))).toHaveCount(0)
  await expect.poll(async () => (await stored(page, 'Someday focus')).doDate).toBeNull()
  // No date to be kept off: not held, just without a plan.
  expect(await stored(page, 'Someday focus')).toEqual({ doDate: null, held: false, dueDate: null, followup: null, modifiedAt: STAMP_MS })
})

test('a plan whose day has passed shows in Delayed, not Today — and Delayed takes no drop', async ({ page }) => {
  await seedWorkspace(page, {
    ...WIDE,
    tasks: [
      ...TASKS,
      // Due today, but planned for yesterday; and a plan from last week with no date.
      { title: 'Missed review', doInDays: -1, dueInDays: 0, modifiedAt: STAMP },
      { title: 'Old plan', doInDays: -6, modifiedAt: STAMP },
    ],
  })
  const inTwo = await dayKeyIn(page, 2)
  const delayed = delayedGroup(page)
  await expect(titles(delayed)).toHaveText(['Old plan', 'Missed review'])
  await expect(titles(todayGroup(page))).toHaveText(['Renew the domain', 'Chase the invoice', 'Write the brief'])
  // Delayed sits above Unplanned, in the trays' pane.
  const trays = planner(page).locator('[data-planner-pane="trays"] [data-planner-group]')
  await expect(trays).toHaveCount(2)
  expect(await trays.evaluateAll((els) => els.map((el) => el.getAttribute('data-planner-group')))).toEqual(['delayed', 'unplanned'])

  // A row dropped on Delayed: refused — no mark, no label, the not-allowed cursor — and nothing is written.
  const steps = await newestUndoStep(page)
  await drag(page, await grip(rowOf(group(page, inTwo), 'Book the venue')), await pointIn(rowOf(delayed, 'Old plan')), {
    during: async () => {
      await expect(page.locator('html')).toHaveAttribute('data-drop-refused', '')
      await expect(planner(page).locator('[data-planner-drop]')).toHaveCount(0)
      await expect(label(page)).toHaveCount(0)
      await expect(delayed.locator('[data-drop-slot]')).toHaveCount(0)
    },
  })
  await expect(page.locator('html')).not.toHaveAttribute('data-drop-refused')
  await expect(titles(group(page, inTwo))).toHaveText(['Book the venue', 'Call the caterer'])
  await expect(titles(delayed)).toHaveText(['Old plan', 'Missed review'])
  expect(await stored(page, 'Book the venue')).toEqual({ doDate: null, held: false, dueDate: [2, 0, 0], followup: null, modifiedAt: STAMP_MS })
  expect(await newestUndoStep(page)).toBe(steps)

  // A Delayed row dropped on Today, the day its due date puts it: its plan is cleared and it shows in Today by its date.
  await drag(page, await grip(rowOf(delayed, 'Missed review')), await pointIn(tile(page, await dayKeyIn(page, 0))), {
    during: async () => { await expect(label(page)).toHaveText('Its date · Today') },
  })
  await expect(titles(todayGroup(page))).toContainText(['Missed review'])
  await expect(titles(delayed)).toHaveText(['Old plan'])
  await expect.poll(async () => (await stored(page, 'Missed review')).doDate).toBeNull()
  expect(await stored(page, 'Missed review')).toEqual({ doDate: null, held: false, dueDate: [0, 0, 0], followup: null, modifiedAt: STAMP_MS })

  // The other one planned again, for tomorrow: Delayed empties and goes.
  await drag(page, await grip(rowOf(delayed, 'Old plan')), await pointIn(tile(page, await dayKeyIn(page, 1))), {
    during: async () => { await expect(label(page)).toHaveText(`Plan · ${await dayWords(page, 1)}`) },
  })
  await expect(delayed).toHaveCount(0)
  await expect.poll(async () => (await stored(page, 'Old plan')).doDate).toEqual([1, 0, 0])
})

test('a row dragged within Today is reordered: no date changes, and the order survives a reload', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  await expect(titles(todayGroup(page))).toHaveText(['Renew the domain', 'Chase the invoice', 'Write the brief'])
  const first = await box(rowOf(todayGroup(page), 'Renew the domain'))
  const from = await grip(rowOf(todayGroup(page), 'Write the brief'))
  await drag(page, from, { x: from.x, y: first.y + 4 }, {
    during: async () => {
      // The list's look: a blank slot where it would land; a reorder changes no plan, so no mark and no label.
      await expect(todayGroup(page).locator('[data-drop-slot]')).toHaveCount(1)
      await expect(planner(page).locator('[data-planner-drop]')).toHaveCount(0)
      await expect(label(page)).toHaveCount(0)
    },
  })
  await expect(titles(todayGroup(page))).toHaveText(['Write the brief', 'Renew the domain', 'Chase the invoice'])
  await expect(todayGroup(page).locator('[data-drop-slot]')).toHaveCount(0)
  await expectLayoutStored(page)
  // The whole displayed sequence, the moved row in its new place; no task was written.
  await expect.poll(() => storedOrder(page)).toEqual([
    'Write the brief', 'Renew the domain', 'Chase the invoice', 'Planned focus', 'Book the venue', 'Call the caterer', 'Someday focus',
  ])
  for (const title of ['Write the brief', 'Renew the domain', 'Chase the invoice']) {
    expect((await stored(page, title)).modifiedAt).toBe(STAMP_MS)
  }
  expect((await stored(page, 'Write the brief')).doDate).toEqual([0, 0, 0])
  expect(await newestUndoStep(page)).toBeNull()

  await page.reload()
  await expect(titles(todayGroup(page))).toHaveText(['Write the brief', 'Renew the domain', 'Chase the invoice'])
})

test('a reorder keeps the place of the rows it can’t see: one the screen filter hides, a day the shifted window leaves out', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inTwo = await dayKeyIn(page, 2)
  const today = todayGroup(page)
  /** Drags a row of `scope` to just above another of its rows. */
  const above = async (scope: Locator, title: string, other: string) => {
    const to = await box(rowOf(scope, other))
    const from = await grip(rowOf(scope, title))
    await drag(page, from, { x: from.x, y: to.y + 3 })
  }
  /** Drags a row of `scope` to just under another of its rows. */
  const below = async (scope: Locator, title: string, other: string) => {
    const to = await box(rowOf(scope, other))
    const from = await grip(rowOf(scope, title))
    await drag(page, from, { x: from.x, y: to.y + to.height - 3 })
  }

  // Today by hand: the brief first. The day in two days by hand: the caterer first.
  await above(today, 'Write the brief', 'Renew the domain')
  await expect(titles(today)).toHaveText(['Write the brief', 'Renew the domain', 'Chase the invoice'])
  await above(group(page, inTwo), 'Call the caterer', 'Book the venue')
  await expect(titles(group(page, inTwo))).toHaveText(['Call the caterer', 'Book the venue'])

  // The screen filter hides the brief; the two rows left are swapped.
  await filterField(page).fill('not "brief"')
  await filterField(page).press('Enter')
  await expect(titles(today)).toHaveText(['Renew the domain', 'Chase the invoice'])
  await below(today, 'Renew the domain', 'Chase the invoice')
  await expect(titles(today)).toHaveText(['Chase the invoice', 'Renew the domain'])
  // Cleared: the brief is first still.
  await filterClear(page).click()
  await expect(titles(today)).toHaveText(['Write the brief', 'Chase the invoice', 'Renew the domain'])

  // A week ahead the day in two days is in no group; a reorder there leaves its order alone.
  await planner(page).getByRole('button', { name: 'Next week' }).click()
  await expect(group(page, inTwo)).toHaveCount(0)
  await above(today, 'Renew the domain', 'Write the brief')
  await expect(titles(today)).toHaveText(['Renew the domain', 'Write the brief', 'Chase the invoice'])
  await wsCell(page, 'k1').getByRole('button', { name: /Back to this week$/ }).click()
  await expect(titles(group(page, inTwo))).toHaveText(['Call the caterer', 'Book the venue'])

  await expectLayoutStored(page)
  await page.reload()
  await expect(titles(todayGroup(page))).toHaveText(['Renew the domain', 'Write the brief', 'Chase the invoice'])
  await expect(titles(group(page, inTwo))).toHaveText(['Call the caterer', 'Book the venue'])
})

test('a row dropped into another day’s group lands where it was dropped, planned for that day', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inTwo = await dayKeyIn(page, 2)
  const target = group(page, inTwo)
  await expect(titles(target)).toHaveText(['Book the venue', 'Call the caterer'])
  // Between the day's two rows: just under the first one's foot.
  const venue = await box(rowOf(target, 'Book the venue'))
  const to = { x: venue.x + 120, y: venue.y + venue.height + 3 }
  await drag(page, await grip(rowOf(todayGroup(page), 'Chase the invoice')), to, {
    during: async () => {
      await expect(target.locator('[data-drop-slot]')).toHaveCount(1)
      await expectMarked(target)
      await expectMarked(tile(page, inTwo))
      await expect(label(page)).toHaveText(`Plan · ${await dayWords(page, 2)}`)
      // The row stays where it was, faded, until it is let go.
      await expect(rowOf(todayGroup(page), 'Chase the invoice')).toBeVisible()
    },
  })
  await expect(titles(target)).toHaveText(['Book the venue', 'Chase the invoice', 'Call the caterer'])
  await expect(titles(todayGroup(page))).toHaveText(['Renew the domain', 'Write the brief'])
  await expect.poll(async () => (await stored(page, 'Chase the invoice')).doDate).toEqual([2, 0, 0])
  expect((await stored(page, 'Chase the invoice')).followup).toEqual([0, 0, 0])
  await expectLayoutStored(page)

  // A row placed by its due date, dropped at the top of Today: planned for today, first there.
  const top = await box(rowOf(todayGroup(page), 'Renew the domain'))
  await drag(page, await grip(rowOf(target, 'Book the venue')), { x: top.x + 120, y: top.y + 3 }, {
    during: async () => { await expect(label(page)).toHaveText('Plan · Today') },
  })
  await expect(titles(todayGroup(page))).toHaveText(['Book the venue', 'Renew the domain', 'Write the brief'])
  await expect.poll(async () => (await stored(page, 'Book the venue')).doDate).toEqual([0, 0, 0])
  expect((await stored(page, 'Book the venue')).dueDate).toEqual([2, 0, 0])

  await expectLayoutStored(page)
  await page.reload()
  await expect(titles(todayGroup(page))).toHaveText(['Book the venue', 'Renew the domain', 'Write the brief'])
  await expect(titles(group(page, inTwo))).toHaveText(['Chase the invoice', 'Call the caterer'])
})

test('a list widget’s row dropped on a tile is planned by the same rule; the list keeps its row and its order', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inOne = await dayKeyIn(page, 1)
  const list = wsCell(page, 'k2')
  const before = await titles(list).allTextContents()
  await drag(page, await grip(rowOf(list, 'Not planned')), await pointIn(tile(page, inOne)), {
    during: async () => {
      await expectMarked(tile(page, inOne))
      await expect(label(page)).toHaveText(`Plan · ${await dayWords(page, 1)}`)
    },
  })
  await expect(titles(group(page, inOne))).toHaveText(['Planned focus', 'Not planned'])
  await expect.poll(async () => (await stored(page, 'Not planned')).doDate).toEqual([1, 0, 0])
  expect((await stored(page, 'Not planned')).modifiedAt).toBe(STAMP_MS)
  expect(await titles(list).allTextContents()).toEqual(before)
  expect(await readStore(page, 'listOrders')).toEqual([])

  // A list row whose follow-up puts it on a Planner day: dropped into Today's group, it is planned for today — the follow-up stays — at the place dropped.
  const today = todayGroup(page)
  const first = await box(rowOf(today, 'Renew the domain'))
  await drag(page, await grip(rowOf(list, 'Call the caterer')), { x: first.x + 120, y: first.y + 3 }, {
    during: async () => {
      await expect(today.locator('[data-drop-slot]')).toHaveCount(1)
      await expect(label(page)).toHaveText('Plan · Today')
    },
  })
  await expect(titles(today)).toHaveText(['Call the caterer', 'Renew the domain', 'Chase the invoice', 'Write the brief'])
  await expect.poll(async () => (await stored(page, 'Call the caterer')).doDate).toEqual([0, 0, 0])
  expect(await stored(page, 'Call the caterer')).toEqual({ doDate: [0, 0, 0], held: false, dueDate: null, followup: [2, 0, 0], modifiedAt: STAMP_MS })
  expect(await readStore(page, 'listOrders')).toEqual([])
})

test('a Planner row dropped on a list does nothing; on a calendar day it is the calendar’s drop', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: TASKS,
    listDefinitions: [{ name: 'Everything', sort: 'manual' }],
    layouts: [{
      name: 'Week',
      columns: [
        { id: 'c1', weight: 5, rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }] })] },
        { id: 'c2', weight: 3, rows: [
          wsRow({ id: 'k2', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] }),
          wsRow({ id: 'k3', tabs: [{ id: 'cal', kind: 'calendar', dateTypes: { due: true, followup: false, plan: false } }] }),
        ] },
      ],
    }],
  })
  const list = wsCell(page, 'k2')
  const before = await titles(list).allTextContents()
  const row = () => rowOf(todayGroup(page), 'Write the brief')
  await drag(page, await grip(row()), await pointIn(rowOf(list, 'Someday focus')), {
    during: async () => {
      await expect(label(page)).toHaveCount(0)
      await expect(list.locator('[data-drop-slot]')).toHaveCount(0)
    },
  })
  await expect(page.locator('[data-drag-overlay]')).toHaveCount(0)
  expect(await titles(list).allTextContents()).toEqual(before)
  expect(await stored(page, 'Write the brief')).toEqual({ doDate: [0, 0, 0], held: false, dueDate: [5, 0, 0], followup: null, modifiedAt: STAMP_MS })
  expect(await readStore(page, 'listOrders')).toEqual([])
  expect(await storedOrder(page)).toBeNull()

  // A calendar showing due dates: its day sets the due date (the calendar's own, real edit), as for a list's row — the plan stays.
  const day = page.locator(`[data-calendar-widget="cal"] [data-day="${await dayKeyIn(page, 0)}"]`)
  await drag(page, await grip(row()), await pointIn(day), {
    during: async () => { await expect(label(page)).toHaveCount(0) },
  })
  await expect.poll(async () => (await stored(page, 'Write the brief')).dueDate?.[0]).toBe(0)
  expect((await stored(page, 'Write the brief')).doDate).toEqual([0, 0, 0])
})

test('Snooze, Unplan and Plan for day › from the keyboard: the plan moves, no date does', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inTwo = await dayKeyIn(page, 2)
  const inThree = await dayKeyIn(page, 3)
  const inFour = await dayKeyIn(page, 4)

  /** Arrows down the open menu until `item` has the focus. */
  const arrowTo = async (item: Locator) => {
    for (let i = 0; i < 24 && !(await item.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('ArrowDown')
    await expect(item).toBeFocused()
  }
  /** Opens the row's task menu from the keyboard (Shift+F10 on its checkbox). */
  const openMenu = async (row: Locator) => {
    await row.getByRole('checkbox').first().focus()
    await page.keyboard.press('Shift+F10')
    const menu = page.getByRole('menu', { name: 'Task actions' })
    await expect(menu).toBeVisible()
    return menu
  }
  /** Picks the menu's item `name` with the arrow keys and Enter. */
  const pickItem = async (row: Locator, name: RegExp) => {
    const menu = await openMenu(row)
    await arrowTo(menu.getByRole('menuitem', { name }))
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toHaveCount(0)
  }

  // Snooze: a row there by its due date is planned for the next day; the item names it.
  let menu = await openMenu(rowOf(group(page, inTwo), 'Book the venue'))
  await expect(menu.getByRole('menuitem', { name: /^Snooze/ })).toContainText(await dayWords(page, 3))
  await expect(menu.getByRole('menuitem', { name: /^Unplan/ })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await pickItem(rowOf(group(page, inTwo), 'Book the venue'), /^Snooze/)
  await expect(titles(group(page, inThree))).toHaveText(['Book the venue'])
  await expect.poll(async () => (await stored(page, 'Book the venue')).doDate).toEqual([3, 0, 0])
  expect(await stored(page, 'Book the venue')).toEqual({ doDate: [3, 0, 0], held: false, dueDate: [2, 0, 0], followup: null, modifiedAt: STAMP_MS })
  // Again: one more day.
  await pickItem(rowOf(group(page, inThree), 'Book the venue'), /^Snooze/)
  await expect(titles(group(page, inFour))).toHaveText(['Book the venue'])
  await expect.poll(async () => (await stored(page, 'Book the venue')).doDate).toEqual([4, 0, 0])

  // Unplan: the dated row is held in Unplanned, its due date kept.
  await pickItem(rowOf(group(page, inFour), 'Book the venue'), /^Unplan/)
  await expect(titles(unplannedGroup(page))).toContainText(['Book the venue'])
  await expect(titles(group(page, inFour))).toHaveCount(0)
  await expect.poll(async () => (await stored(page, 'Book the venue')).held).toBe(true)
  expect(await stored(page, 'Book the venue')).toEqual({ doDate: null, held: true, dueDate: [2, 0, 0], followup: null, modifiedAt: STAMP_MS })
  // There, Unplan is off and says why, and there is no Snooze: nothing there is planned to put off.
  menu = await openMenu(rowOf(unplannedGroup(page), 'Book the venue'))
  const unplan = menu.getByRole('menuitem', { name: /^Unplan/ })
  await expect(unplan).toBeDisabled()
  await expect(unplan).toHaveAttribute('aria-description', /Unplanned already/)
  await expect(menu.getByRole('menuitem', { name: /^Snooze/ })).toHaveCount(0)

  // Plan for day ›: with →, its submenu — a pick plans the task outright; no No day.
  await arrowTo(menu.getByRole('menuitem', { name: /^Plan for day/ }))
  await page.keyboard.press('ArrowRight')
  let sub = page.getByRole('menu').last()
  await expect(sub.getByRole('menuitemradio', { name: /^Today/ })).toBeVisible()
  await expect(sub).toContainText('Plans it for that day')
  await expect(sub.getByRole('menuitemradio')).toHaveCount(7)
  await expect(sub.getByRole('menuitemradio', { name: 'No day' })).toHaveCount(0)
  await expect(sub.getByRole('menuitemradio', { checked: true })).toHaveCount(0)
  // Its own due date's day (noted `due`): planned for it outright, no longer held (a drag there would clear the plan).
  await expect(sub.getByRole('menuitemradio', { name: new RegExp(`^${await dayWords(page, 2)}`) })).toContainText('due')
  await arrowTo(sub.getByRole('menuitemradio', { name: new RegExp(`^${await dayWords(page, 2)}`) }))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(titles(group(page, inTwo))).toContainText(['Book the venue'])
  await expect.poll(async () => (await stored(page, 'Book the venue')).held).toBe(false)
  expect(await stored(page, 'Book the venue')).toEqual({ doDate: [2, 0, 0], held: false, dueDate: [2, 0, 0], followup: null, modifiedAt: STAMP_MS })

  // A row there by its follow-up: the same words, its follow-up's day noted and nothing checked (no plan); a pick plans it and leaves the follow-up.
  menu = await openMenu(rowOf(todayGroup(page), 'Chase the invoice'))
  await arrowTo(menu.getByRole('menuitem', { name: /^Plan for day/ }))
  await page.keyboard.press('ArrowRight')
  sub = page.getByRole('menu').last()
  await expect(sub).toContainText('Plans it for that day')
  await expect(sub.getByRole('menuitemradio', { name: /^Today/ })).toContainText('follow-up')
  await expect(sub.getByRole('menuitemradio', { checked: true })).toHaveCount(0)
  await arrowTo(sub.getByRole('menuitemradio', { name: new RegExp(`^${await dayWords(page, 3)}`) }))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(titles(group(page, inThree))).toHaveText(['Chase the invoice'])
  await expect.poll(async () => (await stored(page, 'Chase the invoice')).doDate).toEqual([3, 0, 0])
  expect(await stored(page, 'Chase the invoice')).toEqual({ doDate: [3, 0, 0], held: false, dueDate: null, followup: [0, 0, 0], modifiedAt: STAMP_MS })
})

test('the medium face: one column takes the same drops', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: TASKS,
    layouts: [{
      name: 'Week',
      columns: [{ id: 'c1', rows: [{ id: 'r1', cells: [
        // About 650px wide: narrower than the panes need, not tall enough for the portrait layout.
        { id: 'k1', weight: 9, tabs: [{ id: 'plan', kind: 'planner' }] },
        { id: 'k2', weight: 11, tabs: [{ id: 'notes', kind: 'notes' }] },
      ] }] }],
    }],
  })
  await expect(planner(page)).toHaveAttribute('data-planner-face', 'medium')
  await expect(planner(page).locator('[data-planner-layout="column"]')).toBeVisible()
  const inOne = await dayKeyIn(page, 1)
  const inTwo = await dayKeyIn(page, 2)

  // Today → a day ahead, between its rows: planned for that day, the row lands there.
  const venue = await box(rowOf(group(page, inTwo), 'Book the venue'))
  await drag(page, await grip(rowOf(todayGroup(page), 'Chase the invoice')), { x: venue.x + 100, y: venue.y + venue.height + 3 }, {
    during: async () => { await expectMarked(group(page, inTwo)) },
  })
  await expect(titles(group(page, inTwo))).toHaveText(['Book the venue', 'Chase the invoice', 'Call the caterer'])
  await expect.poll(async () => (await stored(page, 'Chase the invoice')).doDate).toEqual([2, 0, 0])
  expect((await stored(page, 'Chase the invoice')).followup).toEqual([0, 0, 0])

  // A day ahead → a tile; then a reorder inside Today.
  await drag(page, await grip(rowOf(group(page, inTwo), 'Call the caterer')), await pointIn(tile(page, inOne)))
  // Dropped on a tile it has no place of its own: it keeps the one the hand order (written by the drop before) gives it.
  await expect(titles(group(page, inOne))).toHaveText(['Planned focus', 'Call the caterer'])
  await expect.poll(async () => (await stored(page, 'Call the caterer')).doDate).toEqual([1, 0, 0])
  expect((await stored(page, 'Call the caterer')).followup).toEqual([2, 0, 0])
  const first = await box(rowOf(todayGroup(page), 'Renew the domain'))
  const from = await grip(rowOf(todayGroup(page), 'Write the brief'))
  await drag(page, from, { x: from.x, y: first.y + 3 })
  await expect(titles(todayGroup(page))).toHaveText(['Write the brief', 'Renew the domain'])
})

test('a Planner under the widget popup takes no drop from a row dragged in the popup over it', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inThree = await dayKeyIn(page, 3)
  const at = await pointIn(tile(page, inThree))
  await wsCell(page, 'k2').getByRole('button', { name: 'Open larger' }).click()
  const popup = page.getByTestId('widget-popup')
  await expect(popup).toBeVisible()
  // The popup lies over the tile.
  const p = await box(popup)
  expect(at.x).toBeGreaterThan(p.x)
  expect(at.x).toBeLessThan(p.x + p.width)
  expect(at.y).toBeGreaterThan(p.y)
  expect(at.y).toBeLessThan(p.y + p.height)

  await drag(page, await grip(rowOf(popup, 'Not planned')), at, {
    during: async () => {
      await expect(planner(page).locator('[data-planner-drop]')).toHaveCount(0)
      await expect(label(page)).toHaveCount(0)
    },
  })
  await expect(page.locator('[data-drag-overlay]')).toHaveCount(0)
  expect((await stored(page, 'Not planned')).doDate).toBeNull()
  expect((await stored(page, 'Not planned')).modifiedAt).toBe(STAMP_MS)
  expect(await storedOrder(page)).toBeNull()
})

test('a drag let go mid-way over a group is one drop: Esc cancels it and nothing is written', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inTwo = await dayKeyIn(page, 2)
  const row = rowOf(todayGroup(page), 'Chase the invoice')
  const from = await grip(row)
  const to = await pointIn(group(page, inTwo), 0.5, 0.5)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + 8, { steps: 2 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await expectMarked(group(page, inTwo))
  await page.keyboard.press('Escape')
  await expect(planner(page).locator('[data-planner-drop]')).toHaveCount(0)
  await expect(planner(page).locator('[data-drop-slot]')).toHaveCount(0)
  await releaseDrag(page)
  await expect(titles(todayGroup(page))).toHaveText(['Renew the domain', 'Chase the invoice', 'Write the brief'])
  expect(await stored(page, 'Chase the invoice')).toEqual({ doDate: null, held: false, dueDate: null, followup: [0, 0, 0], modifiedAt: STAMP_MS })
  expect(await storedOrder(page)).toBeNull()
  expect(await newestUndoStep(page)).toBeNull()
})

// ── The layout: the days on the left, the trays on the right ────────────────

/** A week with every Planner state: placed and not, a plan past its due date, Delayed, held. */
const WEEK: NonNullable<WorkspaceSeed['tasks']> = [
  { title: 'Renew the domain', dueInDays: 0, modifiedAt: STAMP },
  { title: 'Write the brief', doInDays: 0, dueInDays: 5, modifiedAt: STAMP },
  { title: 'Book the venue', dueInDays: 2, modifiedAt: STAMP },
  // Due in two days, planned for the day after: one day after due.
  { title: 'Migrate the invoices', dueInDays: 2, doInDays: 3, modifiedAt: STAMP },
  // From a list: planned, with no date, not in Focus.
  { title: 'From a list', doInDays: 4, modifiedAt: STAMP },
  { title: 'Missed review', doInDays: -1, dueInDays: 9, modifiedAt: STAMP },
  { title: 'Old plan', doInDays: -3, modifiedAt: STAMP },
  { title: 'Held call', unplanned: true, followupInDays: 3, modifiedAt: STAMP },
  { title: 'Someday focus', focus: true, modifiedAt: STAMP },
]

const ALONE: WorkspaceSeed = {
  tasks: WEEK,
  layouts: [{ name: 'Week', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }] })] }] }],
}

const daysPane = (page: Page) => planner(page).locator('[data-planner-pane="days"]')
const traysPane = (page: Page) => planner(page).locator('[data-planner-pane="trays"]')
const flagOf = (row: Locator) => row.locator('xpath=ancestor::*[@data-planner-row][1]').locator('[data-planner-flag]')
const tagOf = (row: Locator) => row.locator('[data-planner-tag]')
const unplanAll = (page: Page) => planner(page).getByRole('button', { name: 'Unplan all Delayed tasks' })
/** A day's short weekday (`Wed`), `days` from today: a tag's words within six days. */
const weekday = (page: Page, days: number) => page.evaluate((n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-US', { weekday: 'short' })
}, days)

test('the large face: the days in one list on the left, the trays on a darker ground on the right', async ({ page }) => {
  await seedWorkspace(page, ALONE)
  await expect(planner(page)).toHaveAttribute('data-planner-face', 'large')
  // Left: Today, then every later day of the window — the empty ones quiet headings.
  const dayGroups = daysPane(page).locator('[data-planner-group]')
  await expect(dayGroups).toHaveCount(7)
  const keys = await Promise.all([0, 1, 2, 3, 4, 5, 6].map((n) => dayKeyIn(page, n)))
  expect(await dayGroups.evaluateAll((els) => els.map((el) => el.getAttribute('data-planner-group')))).toEqual(keys)
  await expect(group(page, keys[1]!)).toHaveAttribute('data-planner-empty', '')
  await expect(group(page, keys[1]!).getByTestId('planner-group-count')).toHaveCount(0)
  await expect(group(page, keys[2]!)).not.toHaveAttribute('data-planner-empty')
  // Right: Delayed, the Unplan button, Unplanned — top to bottom.
  expect(await traysPane(page).locator('[data-planner-group], [data-planner-unplan-all]').evaluateAll((els) => els.map((el) => el.getAttribute('data-planner-group') ?? 'unplan')))
    .toEqual(['delayed', 'unplan', 'unplanned'])
  const [left, right, delayed, button, unplanned] = await Promise.all([
    box(daysPane(page)), box(traysPane(page)), box(delayedGroup(page)), box(unplanAll(page)), box(unplannedGroup(page)),
  ])
  expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1)
  expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(1)
  expect(delayed.y + delayed.height).toBeLessThanOrEqual(button.y + 1)
  expect(button.y + button.height).toBeLessThanOrEqual(unplanned.y + 1)
  // The button is centered on its rule.
  expect(Math.abs(button.x + button.width / 2 - (right.x + right.width / 2))).toBeLessThan(12)
  // The trays' ground is darker than the days'.
  const ground = (pane: Locator) => pane.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await ground(traysPane(page))).not.toBe(await ground(daysPane(page)))
  expect(await ground(traysPane(page))).not.toBe('rgba(0, 0, 0, 0)')

  // The strip: a solid tick per real date, a hollow one per plan; the count is the rows on the day.
  const marks = (key: string) => tile(page, key).locator('[data-mark]').evaluateAll((els) => els.map((el) => el.getAttribute('data-mark')))
  // In two days: two due dates (one of them planned a day later), no plan. In three: that plan, and the held call's follow-up.
  expect(await marks(keys[2]!)).toEqual(['due', 'due'])
  await expect(tile(page, keys[2]!).getByTestId('planner-tile-count')).toHaveText('1')
  expect(await marks(keys[3]!)).toEqual(['followup', 'plan'])
  await expect(tile(page, keys[3]!).getByTestId('planner-tile-count')).toHaveText('1')
  // A solid tick is filled, a hollow one outlined.
  const plan = tile(page, keys[3]!).locator('[data-mark="plan"]')
  expect(await plan.evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderTopStyle] })).toEqual(['rgba(0, 0, 0, 0)', 'solid'])
  // Seven tiles of one width, and a rule where the week turns (Monday by default) unless the window starts there.
  const widths = await planner(page).locator('[data-planner-tile]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)))
  expect(new Set(widths).size).toBe(1)
  const mondayIn = await page.evaluate(() => (8 - new Date().getDay()) % 7)
  await expect(planner(page).locator('[data-planner-week-rule]')).toHaveCount(mondayIn === 0 ? 0 : 1)
  if (mondayIn > 0) await expect(planner(page).locator('[data-planner-week-rule]')).toHaveAttribute('data-planner-week-rule', keys[mondayIn]!)
})

test.describe('a short Planner', () => {
  test.use({ viewport: { width: 1440, height: 560 } })

  /** Three deadlines on each day ahead: the day list scrolls. */
  const filler: NonNullable<WorkspaceSeed['tasks']> = [1, 2, 3, 4, 5, 6].flatMap((n) => [1, 2, 3].map((i) => ({ title: `Day ${n} task ${i}`, dueInDays: n })))
  const SHORT: WorkspaceSeed = {
    tasks: [{ title: 'Planned focus', focus: true, doInDays: 1, modifiedAt: STAMP }, { title: 'Someday focus', focus: true, modifiedAt: STAMP }, ...filler],
    layouts: [{ name: 'Week', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }] })] }] }],
  }

  test('a click on a tile brings its day to the top of the day list; it picks nothing', async ({ page }) => {
    await seedWorkspace(page, SHORT)
    await expect(planner(page)).toHaveAttribute('data-planner-face', 'large')
    const inTwo = await dayKeyIn(page, 2)
    const inFive = await dayKeyIn(page, 5)
    const pane = daysPane(page)
    const top = async (target: Locator) => Math.round((await box(target)).y - (await box(pane)).y)
    /** Where the pane scrolls to for a day: the day's heading at its top, or as far as the list goes. */
    const scrollFor = (key: string) => pane.evaluate((el, k) => {
      const g = el.querySelector(`[data-planner-group="${k}"]`)
      if (!g) return -1
      const at = g.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
      return Math.round(Math.min(at, el.scrollHeight - el.clientHeight))
    }, key)
    const scrolled = () => pane.evaluate((el) => Math.round(el.scrollTop))
    // Out of view below the pane to begin with.
    expect(await top(group(page, inFive))).toBeGreaterThan((await box(pane)).height)
    // A near day: its heading comes to the pane's top.
    const near = await scrollFor(inTwo)
    expect(near).toBeGreaterThan(0)
    await tile(page, inTwo).click()
    await expect.poll(scrolled).toBe(near)
    expect(Math.abs(await top(group(page, inTwo)))).toBeLessThanOrEqual(1)
    // A late one: as far as the list goes, and in view.
    const far = await scrollFor(inFive)
    await tile(page, inFive).click()
    await expect.poll(scrolled).toBe(far)
    await expect(group(page, inFive)).toBeInViewport()
    // Every day is still listed, and no tile is pressed.
    await expect(pane.locator('[data-planner-group]')).toHaveCount(7)
    await expect(planner(page).locator('[data-planner-tile][aria-pressed]')).toHaveCount(0)
    // Today's tile goes back to the top.
    await tile(page, await dayKeyIn(page, 0)).click()
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(0)
  })

  test('a day’s group scrolled out of the day list, behind the strip, takes no drop: the drop is the tile’s', async ({ page }) => {
    await seedWorkspace(page, SHORT)
    await expect(planner(page)).toHaveAttribute('data-planner-face', 'large')
    // The list scrolled to its end: its first groups lie (unseen) where the strip is.
    await daysPane(page).evaluate((el) => { el.scrollTop = el.scrollHeight })
    const inTwo = await dayKeyIn(page, 2)
    const to = await pointIn(tile(page, inTwo))
    // A day's group whose box — clipped by its scroller — holds that point.
    const hidden = await planner(page).locator('[data-planner-group-kind="today"], [data-planner-group-kind="day"]').evaluateAll((groups, point) => {
      const under = groups.find((g) => {
        const r = g.getBoundingClientRect()
        return point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom
      })
      return under?.getAttribute('data-planner-group') ?? null
    }, to)
    expect(hidden, 'a day group lying behind the strip').not.toBeNull()
    if (!hidden) return
    expect(hidden).not.toBe(inTwo)

    await drag(page, await grip(rowOf(unplannedGroup(page), 'Someday focus')), to, {
      during: async () => {
        await expectMarked(tile(page, inTwo))
        await expect(label(page)).toHaveText(`Plan · ${await dayWords(page, 2)}`)
        await expect(group(page, hidden)).not.toHaveAttribute('data-planner-drop')
      },
    })
    await expect.poll(async () => (await stored(page, 'Someday focus')).doDate).toEqual([2, 0, 0])
    expect((await stored(page, 'Someday focus')).modifiedAt).toBe(STAMP_MS)
  })

  test('a row from the trays dropped on an empty day’s quiet heading is planned for that day', async ({ page }) => {
    await seedWorkspace(page, { ...SHORT, tasks: SHORT.tasks?.filter((t) => !t.title.startsWith('Day 2')) })
    const inTwo = await dayKeyIn(page, 2)
    const heading = group(page, inTwo)
    await expect(heading).toHaveAttribute('data-planner-empty', '')
    await heading.scrollIntoViewIfNeeded()
    await drag(page, await grip(rowOf(unplannedGroup(page), 'Someday focus')), await pointIn(heading), {
      during: async () => {
        await expectMarked(heading)
        await expect(label(page)).toHaveText(`Plan · ${await dayWords(page, 2)}`)
        await expect(heading.locator('[data-drop-slot]')).toHaveCount(1)
      },
    })
    await expect(titles(heading)).toHaveText(['Someday focus'])
    await expect(heading).not.toHaveAttribute('data-planner-empty')
    await expect.poll(async () => (await stored(page, 'Someday focus')).doDate).toEqual([2, 0, 0])
  })
})

// ── A row's hover buttons ───────────────────────────────────────────────────

test('hover Snooze moves a Today row to tomorrow; hover Unplan moves it to Unplanned; hover Today brings it back — the plan only', async ({ page }) => {
  await seedWorkspace(page, ALONE)
  const tomorrow = await dayKeyIn(page, 1)
  const row = rowOf(todayGroup(page), 'Renew the domain')
  const snooze = row.getByRole('button', { name: 'Snooze' })
  const unplan = row.getByRole('button', { name: 'Unplan' })
  // Hidden until the row is hovered.
  expect(await row.locator('[data-row-cluster]').evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
  await row.hover({ position: { x: 80, y: 10 } })
  await expect.poll(() => row.locator('[data-row-cluster]').evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  await expect(snooze).toBeVisible()
  await expect(unplan).toBeVisible()
  await snooze.click()
  // Tomorrow, with its flag and — planned a day after its due date — its tag; the due date as it was.
  const moved = rowOf(group(page, tomorrow), 'Renew the domain')
  await expect(moved).toBeVisible()
  await expect(flagOf(moved)).toHaveCount(1)
  await expect(tagOf(moved)).toHaveText('1 day after due')
  await expect.poll(async () => (await stored(page, 'Renew the domain')).doDate).toEqual([1, 0, 0])
  expect(await stored(page, 'Renew the domain')).toEqual({ doDate: [1, 0, 0], held: false, dueDate: [0, 0, 0], followup: null, modifiedAt: STAMP_MS })
  // The editor did not open.
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Unplan, from the row's hover: held in Unplanned, with a tag of the day it came off; there only a Today button.
  await moved.hover({ position: { x: 80, y: 10 } })
  await moved.getByRole('button', { name: 'Unplan' }).click()
  const held = rowOf(unplannedGroup(page), 'Renew the domain')
  await expect(held).toBeVisible()
  await expect(tagOf(held)).toHaveText('Today')
  await expect(flagOf(held)).toHaveCount(1)
  await expect.poll(async () => (await stored(page, 'Renew the domain')).held).toBe(true)
  expect(await stored(page, 'Renew the domain')).toEqual({ doDate: null, held: true, dueDate: [0, 0, 0], followup: null, modifiedAt: STAMP_MS })
  await held.hover({ position: { x: 80, y: 10 } })
  const today = held.getByRole('button', { name: 'Today' })
  await expect(today).toBeVisible()
  await expect(held.getByRole('button', { name: 'Snooze' })).toHaveCount(0)
  await expect(held.getByRole('button', { name: 'Unplan' })).toHaveCount(0)
  // Each a step of its own.
  expect(await newestUndoStep(page)).toBe('Unplanned “Renew the domain”')

  // Today: planned for today outright — due today too, so a plan on its own date's day — no longer held, flagged.
  await today.click()
  const back = rowOf(todayGroup(page), 'Renew the domain')
  await expect(back).toBeVisible()
  await expect(flagOf(back)).toHaveCount(1)
  await expect.poll(async () => (await stored(page, 'Renew the domain')).held).toBe(false)
  expect(await stored(page, 'Renew the domain')).toEqual({ doDate: [0, 0, 0], held: false, dueDate: [0, 0, 0], followup: null, modifiedAt: STAMP_MS })
})

test('Unplan keeps a planned task with no date, not in Focus, in the Planner: it is held in Unplanned', async ({ page }) => {
  await seedWorkspace(page, ALONE)
  const inFour = await dayKeyIn(page, 4)
  const row = rowOf(group(page, inFour), 'From a list')
  await expect(flagOf(row)).toHaveCount(1)
  await row.hover({ position: { x: 80, y: 10 } })
  await row.getByRole('button', { name: 'Unplan' }).click()
  const held = rowOf(unplannedGroup(page), 'From a list')
  await expect(held).toBeVisible()
  // No date of its own: no tag, but the flag of a held row.
  await expect(tagOf(held)).toHaveCount(0)
  await expect(flagOf(held)).toHaveCount(1)
  await expect.poll(async () => stored(page, 'From a list')).toEqual({ doDate: null, held: true, dueDate: null, followup: null, modifiedAt: STAMP_MS })
  await expect(group(page, inFour)).toHaveAttribute('data-planner-empty', '')
  // Still there after a reload.
  await page.reload()
  await expect(rowOf(unplannedGroup(page), 'From a list')).toBeVisible()
})

// ── Delayed: the tags, the Unplan button ────────────────────────────────────

test('the ↓ Unplan button moves every Delayed task to Unplanned in one step; Undo brings them back', async ({ page }) => {
  await seedWorkspace(page, ALONE)
  const delayed = delayedGroup(page)
  await expect(titles(delayed)).toHaveText(['Old plan', 'Missed review'])
  // Each Delayed row: its flag and the day it was planned for.
  await expect(tagOf(rowOf(delayed, 'Missed review'))).toHaveText(await weekday(page, -1))
  await expect(tagOf(rowOf(delayed, 'Old plan'))).toHaveText(await weekday(page, -3))
  await expect(delayed.locator('[data-planner-flag]')).toHaveCount(2)
  // A held row with a date: the day it came off.
  await expect(tagOf(rowOf(unplannedGroup(page), 'Held call'))).toHaveText(await weekday(page, 3))

  const button = unplanAll(page)
  await button.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Move all Delayed tasks to Unplanned')
  await button.click()
  await expect(delayed).toHaveCount(0)
  await expect(button).toHaveCount(0)
  await expect(titles(unplannedGroup(page))).toHaveText(['Missed review', 'Old plan', 'Held call', 'Someday focus'])
  await expect.poll(async () => (await stored(page, 'Old plan')).held).toBe(true)
  // Both held — the one with no date too —, no date and no stamp touched.
  expect(await stored(page, 'Old plan')).toEqual({ doDate: null, held: true, dueDate: null, followup: null, modifiedAt: STAMP_MS })
  expect(await stored(page, 'Missed review')).toEqual({ doDate: null, held: true, dueDate: [9, 0, 0], followup: null, modifiedAt: STAMP_MS })

  const snackbar = page.locator('[data-snackbar-live]')
  await expect(snackbar).toContainText('Unplanned 2 tasks from Delayed')
  await snackbar.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(titles(delayedGroup(page))).toHaveText(['Old plan', 'Missed review'])
  await expect.poll(async () => (await stored(page, 'Old plan')).doDate).toEqual([-3, 0, 0])
  expect(await stored(page, 'Missed review')).toEqual({ doDate: [-1, 0, 0], held: false, dueDate: [9, 0, 0], followup: null, modifiedAt: STAMP_MS })
})

// ── Reset plan ──────────────────────────────────────────────────────────────

/** Reset plan asks first: its confirm prompt's Reset plan. */
async function confirmReset(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: /^Reset plan/ }).getByRole('button', { name: 'Reset plan', exact: true }).click()
}

test('Reset plan › This week clears every plan the Planner shows; Undo puts them back', async ({ page }) => {
  await seedWorkspace(page, ALONE)
  await expect(planner(page).locator('[data-planner-flag]')).toHaveCount(6)
  await planner(page).getByRole('button', { name: 'Reset plan' }).click()
  const menu = page.getByRole('menu', { name: 'Reset plan' })
  // Six placed tasks; one planned for today; two Delayed.
  await expect(menu.getByRole('menuitem')).toHaveText([/^This week\s*6$/, /^Today only\s*1$/, /^Delayed\s*2$/])
  await menu.getByRole('menuitem', { name: /^This week/ }).click()
  // It asks first: how many plans, and how many tasks then leave the Planner.
  await expect(page.getByRole('dialog', { name: 'Reset plan: this week?' })).toContainText('This clears the plan of 6 tasks')
  await confirmReset(page)
  // No flag left; a planned task with no date and no Focus leaves the widget (Reset may remove it), the dated ones sit by their dates.
  await expect(planner(page).locator('[data-planner-flag]')).toHaveCount(0)
  await expect(delayedGroup(page)).toHaveCount(0)
  await expect(titles(unplannedGroup(page))).toHaveText(['Someday focus'])
  await expect(titles(group(page, await dayKeyIn(page, 2)))).toHaveText(['Book the venue', 'Migrate the invoices'])
  await expect(titles(group(page, await dayKeyIn(page, 3)))).toHaveText(['Held call'])
  await expect.poll(async () => (await stored(page, 'Migrate the invoices')).doDate).toBeNull()
  for (const title of ['Write the brief', 'Migrate the invoices', 'From a list', 'Missed review', 'Old plan', 'Held call']) {
    const task = await stored(page, title)
    expect([title, task.doDate, task.held, task.modifiedAt]).toEqual([title, null, false, STAMP_MS])
  }
  // The dates stand.
  expect((await stored(page, 'Migrate the invoices')).dueDate).toEqual([2, 0, 0])
  expect((await stored(page, 'Held call')).followup).toEqual([3, 0, 0])

  // One undo step, offered by the snackbar.
  const snackbar = page.locator('[data-snackbar-live]')
  await expect(snackbar).toContainText('Reset plan: this week')
  await snackbar.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(planner(page).locator('[data-planner-flag]')).toHaveCount(6)
  await expect(titles(delayedGroup(page))).toHaveText(['Old plan', 'Missed review'])
  await expect.poll(async () => (await stored(page, 'Migrate the invoices')).doDate).toEqual([3, 0, 0])
  expect(await stored(page, 'Held call')).toEqual({ doDate: null, held: true, dueDate: null, followup: [3, 0, 0], modifiedAt: STAMP_MS })
  expect((await stored(page, 'From a list')).doDate).toEqual([4, 0, 0])

  // A choice with nothing to clear is inert.
  await planner(page).getByRole('button', { name: 'Reset plan' }).click()
  await page.getByRole('menu', { name: 'Reset plan' }).getByRole('menuitem', { name: /^Delayed/ }).click()
  await confirmReset(page)
  await expect(delayedGroup(page)).toHaveCount(0)
  await planner(page).getByRole('button', { name: 'Reset plan' }).click()
  await expect(page.getByRole('menu', { name: 'Reset plan' }).getByRole('menuitem', { name: /^Delayed/ })).toBeDisabled()
})

test('in a cell of tabs Reset plan is under the widget’s ⋯ menu', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: WEEK,
    listDefinitions: [{ name: 'Everything', sort: 'manual' }],
    layouts: [{ name: 'Week', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }, { id: 'list', kind: 'lens', listDefIdx: 0 }] })] }] }],
  })
  await expect(planner(page)).toBeVisible()
  await expect(planner(page).getByRole('button', { name: 'Reset plan' })).toHaveCount(0)
  await openCellMenu(page, 'k1')
  await page.getByRole('menuitem', { name: /^Reset plan/ }).hover()
  const today = page.getByRole('menuitem', { name: /^Today only/ })
  await expect(today).toContainText('1')
  await today.click()
  await confirmReset(page)
  await expect.poll(async () => (await stored(page, 'Write the brief')).doDate).toBeNull()
  expect(await newestUndoStep(page)).toBe('Reset plan: today')
  // The rest of the plan stands.
  expect((await stored(page, 'Migrate the invoices')).doDate).toEqual([3, 0, 0])
})

// ── The strip's room and the Unplanned filter ────────────────────────────────

test('a cell too narrow for the tiles’ ticks hides the strip: the range and the arrows sit in the top line, or in a slim row in a cell of tabs', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: TASKS,
    layouts: [{
      name: 'Week',
      columns: [{ id: 'c1', rows: [{ id: 'r1', cells: [
        // About 280px wide: a column, too narrow for seven tiles with their ticks beside the arrows.
        { id: 'k1', weight: 3, tabs: [{ id: 'plan', kind: 'planner' }] },
        { id: 'k2', weight: 12, tabs: [{ id: 'notes', kind: 'notes' }] },
      ] }, wsRow({ id: 'k3', tabs: [{ id: 'notes2', kind: 'notes' }, { id: 'plan2', kind: 'planner' }] })] }],
    }],
  })
  const cell = wsCell(page, 'k1')
  await expect(planner(page).locator('[data-planner-layout="column"]')).toBeVisible()
  await expect(planner(page).locator('[data-planner-strip]')).toHaveCount(0)
  await expect(planner(page).locator('[data-planner-tile]')).toHaveCount(0)
  await expect(cell.getByTestId('planner-range')).toBeVisible()
  const prev = await box(cell.getByRole('button', { name: 'Previous week' }))
  const range = await box(cell.getByTestId('planner-range'))
  const next = await box(cell.getByRole('button', { name: 'Next week' }))
  expect(prev.x + prev.width).toBeLessThanOrEqual(range.x + 1)
  expect(next.x).toBeGreaterThanOrEqual(range.x + range.width - 1)
  expect(Math.abs(next.y - range.y)).toBeLessThan(12)
  // Today's heading comes right under the top line.
  await expect(todayGroup(page)).toBeVisible()
  await cell.getByRole('button', { name: 'Next week' }).click()
  await expect(cell.getByRole('button', { name: /Back to this week$/ })).toBeVisible()

  // A cell of tabs has no top line: the slim range row, the arrows around the range.
  await wsCell(page, 'k3').getByRole('tab', { name: 'Planner' }).click()
  const other = page.locator('[data-planner="plan2"]')
  await expect(other.locator('[data-planner-strip]')).toHaveAttribute('data-planner-strip', 'tiles')
  await page.setViewportSize({ width: 340, height: 900 })
  await expect(other.locator('[data-planner-strip]')).toHaveAttribute('data-planner-strip', 'range')
  await expect(other.getByRole('group', { name: 'Days' }).getByRole('button', { name: 'Next week' })).toBeVisible()
})

test('the Unplanned filter: its words open the Planner settings, and what it holds decides what joins Unplanned — one undo step', async ({ page }) => {
  await seedWorkspace(page, {
    ...WIDE,
    tags: ['errands'],
    tasks: [...TASKS, { title: 'Pick up dry cleaning', tags: ['errands'], modifiedAt: STAMP }, { title: 'Dated errand', tags: ['errands'], dueInDays: 2, modifiedAt: STAMP }],
  })
  const line = unplannedGroup(page).locator('[data-planner-filter-line]')
  await expect(line).toHaveText('Focus')
  await expect(titles(unplannedGroup(page))).toHaveText(['Someday focus'])

  await line.getByRole('button').click()
  const dialog = page.getByRole('dialog', { name: 'Planner settings' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('group', { name: 'Unplanned holds' })).toBeVisible()
  await dialog.getByRole('radio', { name: 'Expression' }).click()
  await dialog.getByRole('textbox', { name: 'Filter expression' }).fill('#errands')
  await dialog.getByRole('textbox', { name: 'Filter expression' }).press('Tab')
  // Drawn as edited: the errand with no day joins Unplanned, the dated one stays on its day, Focus no longer joins.
  await expect(titles(unplannedGroup(page))).toHaveText(['Pick up dry cleaning'])
  await expect(titles(group(page, await dayKeyIn(page, 2)))).toContainText(['Dated errand'])
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(line).toContainText('errands')
  await expectLayoutStored(page)
  expect(await newestUndoStep(page)).toBe('Changed what counts as unplanned')
  const stored = await readStore<{ cells: Array<{ tabs: Array<{ id: string; config: { unplanned?: { expression?: unknown } } }> }> }>(page, 'layouts')
  expect(stored.flatMap((l) => l.cells).flatMap((c) => c.tabs).find((t) => t.id === 'plan')?.config.unplanned?.expression).toMatchObject({ kind: 'tag' })

  // From the widget's ⋯: emptied, nothing joins on its own.
  await openCellMenu(page, 'k1')
  await page.getByRole('menuitem', { name: 'What counts as unplanned…' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Filter expression' }).fill('')
  await dialog.getByRole('textbox', { name: 'Filter expression' }).press('Tab')
  await expect(unplannedGroup(page).getByText('Nothing unplanned')).toBeVisible()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(line).toHaveText('Nothing joins on its own')
})

test('in the widget popup, the Planner settings redraw Unplanned as the filter is edited, as in a cell', async ({ page }) => {
  await seedWorkspace(page, {
    ...WIDE,
    tags: ['errands'],
    tasks: [...TASKS, { title: 'Pick up dry cleaning', tags: ['errands'], modifiedAt: STAMP }],
  })
  await wsCell(page, 'k1').getByRole('button', { name: 'Open larger' }).click()
  const popup = page.getByTestId('widget-popup')
  await expect(popup).toBeVisible()
  const inPopup = popup.locator('[data-planner="plan"] [data-planner-group="unplanned"]')
  await expect(titles(inPopup)).toHaveText(['Someday focus'])

  await inPopup.locator('[data-planner-filter-line]').getByRole('button').click()
  const dialog = page.getByRole('dialog', { name: 'Planner settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: 'Expression' }).click()
  const field = dialog.getByRole('textbox', { name: 'Filter expression' })
  await field.fill('#errands')
  await field.press('Tab')
  // Drawn as edited, before Save, and the popup stays open.
  await expect(titles(inPopup)).toHaveText(['Pick up dry cleaning'])
  await expect(inPopup.locator('[data-planner-filter-line]')).toContainText('errands')
  await expect(popup).toBeVisible()

  // Cancel puts the stored filter back.
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(titles(inPopup)).toHaveText(['Someday focus'])
})

// ── A plan past a real date: the tag, the late date, the fixes ──────────────

test('a row planned after its due date shows the tag and the date drawn late; Move due date to … edits the date, and the tag and the flag go', async ({ page }) => {
  await seedWorkspace(page, ALONE)
  const inThree = await dayKeyIn(page, 3)
  const row = rowOf(group(page, inThree), 'Migrate the invoices')
  const tag = tagOf(row)
  await expect(tag).toHaveText('1 day after due')
  await expect(flagOf(row)).toHaveCount(1)
  // Its due date — two days ahead, not late — drawn as a late one: bold, over its band.
  const due = row.locator('[data-row-cell="due"]')
  await expect(due).toHaveAttribute('data-date-level', 'late')
  expect(Number(await due.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(700)
  expect(await due.evaluate((el) => getComputedStyle(el).backgroundImage)).not.toBe('none')
  // The same date on a row with no plan: not late.
  const plain = rowOf(group(page, await dayKeyIn(page, 2)), 'Book the venue').locator('[data-row-cell="due"]')
  await expect(plain).not.toHaveAttribute('data-date-level', 'late')
  expect(Number(await plain.evaluate((el) => getComputedStyle(el).fontWeight))).toBeLessThan(700)

  // The tag stays in view, and takes the press, while the row's hover buttons show.
  await row.hover({ position: { x: 80, y: 10 } })
  await expect(row.getByRole('button', { name: 'Snooze' })).toBeVisible()
  await tag.click()
  const menu = page.getByRole('menu', { name: 'Fix the plan' })
  await expect(menu.getByRole('menuitem')).toHaveText([`Move due date to ${await dayWords(page, 3)}`, `Plan for ${await dayWords(page, 2)}`])
  // Esc closes it with the focus back on the tag; from the keyboard it opens again.
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(tag).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Enter')

  // The due date moved to the planned day; its own date puts the row there now: no plan, no flag, no tag.
  await expect.poll(async () => (await stored(page, 'Migrate the invoices')).dueDate).toEqual([3, 0, 0])
  const task = await stored(page, 'Migrate the invoices')
  expect([task.doDate, task.held, task.followup]).toEqual([null, false, null])
  // A real edit: stamped.
  expect(task.modifiedAt).toBeGreaterThan(STAMP_MS)
  const after = rowOf(group(page, inThree), 'Migrate the invoices')
  await expect(after).toBeVisible()
  await expect(tagOf(after)).toHaveCount(0)
  await expect(flagOf(after)).toHaveCount(0)
  await expect(after.locator('[data-row-cell="due"]')).not.toHaveAttribute('data-date-level', 'late')
  // One undo step puts both back.
  await page.keyboard.press('Control+z')
  await expect(tagOf(rowOf(group(page, inThree), 'Migrate the invoices'))).toHaveText('1 day after due')
  await expect.poll(async () => (await stored(page, 'Migrate the invoices')).dueDate).toEqual([2, 0, 0])
  expect((await stored(page, 'Migrate the invoices')).doDate).toEqual([3, 0, 0])
})

test('Plan for … moves the plan to the date’s day and leaves the date alone', async ({ page }) => {
  await seedWorkspace(page, ALONE)
  const inTwo = await dayKeyIn(page, 2)
  const inThree = await dayKeyIn(page, 3)
  await tagOf(rowOf(group(page, inThree), 'Migrate the invoices')).click()
  await page.getByRole('menu', { name: 'Fix the plan' }).getByRole('menuitem', { name: `Plan for ${await dayWords(page, 2)}` }).click()
  // Planned outright for the day it is due: flagged, no conflict left, so no tag.
  const row = rowOf(group(page, inTwo), 'Migrate the invoices')
  await expect(row).toBeVisible()
  await expect(tagOf(row)).toHaveCount(0)
  await expect(flagOf(row)).toHaveCount(1)
  await expect(group(page, inThree)).toHaveAttribute('data-planner-empty', '')
  await expect.poll(async () => (await stored(page, 'Migrate the invoices')).doDate).toEqual([2, 0, 0])
  expect(await stored(page, 'Migrate the invoices')).toEqual({ doDate: [2, 0, 0], held: false, dueDate: [2, 0, 0], followup: null, modifiedAt: STAMP_MS })
})

// ── The keyboard: the focus follows the row ─────────────────────────────────

test('from the keyboard, the focus follows a row that Snooze, Unplan or a fix moves — it never falls to the page', async ({ page }) => {
  await seedWorkspace(page, ALONE)
  const [inTwo, inThree, inFour, inFive, inSix] = await Promise.all([2, 3, 4, 5, 6].map((n) => dayKeyIn(page, n)))
  /** What holds the focus: its text, the task of its row and its group. */
  const focused = () => page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    return {
      on: el.tagName === 'BUTTON' ? el.textContent : el.tagName,
      row: el.closest('[data-planner-row]')?.querySelector('[data-task-title]')?.getAttribute('data-task-title') ?? null,
      group: el.closest('[data-planner-group]')?.getAttribute('data-planner-group') ?? null,
    }
  })

  // Snooze, Enter: the row moves a day on and its Snooze button still has the focus; Enter again moves it on again.
  await rowOf(group(page, inTwo!), 'Book the venue').getByRole('button', { name: 'Snooze' }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(focused).toEqual({ on: 'Snooze', row: 'Book the venue', group: inThree })
  await expect(rowOf(group(page, inThree!), 'Book the venue').getByRole('button', { name: 'Snooze' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect.poll(focused).toEqual({ on: 'Snooze', row: 'Book the venue', group: inFour })
  expect((await stored(page, 'Book the venue')).doDate).toEqual([4, 0, 0])

  // Tab to Unplan, Space: the row goes to Unplanned, in the other pane, and the focus with it (its Today: it has no Snooze or Unplan there).
  await page.keyboard.press('Tab')
  await expect.poll(focused).toEqual({ on: 'Unplan', row: 'Book the venue', group: inFour })
  await page.keyboard.press('Space')
  await expect.poll(focused).toEqual({ on: 'Today', row: 'Book the venue', group: 'unplanned' })
  await expect(rowOf(unplannedGroup(page), 'Book the venue')).toBeInViewport()

  // A fix: Enter on the tag opens its menu, Enter picks Move due date — the tag goes with the conflict, the focus stays in the row.
  await tagOf(rowOf(group(page, inThree!), 'Migrate the invoices')).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu', { name: 'Fix the plan' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(tagOf(rowOf(group(page, inThree!), 'Migrate the invoices'))).toHaveCount(0)
  await expect.poll(focused).toEqual({ on: 'Snooze', row: 'Migrate the invoices', group: inThree })

  // A row that leaves the view (snoozed past the last day, no date): the focus goes to its group's heading, and the snackbar says where it went.
  await rowOf(group(page, inFour!), 'From a list').getByRole('button', { name: 'Snooze' }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(focused).toEqual({ on: 'Snooze', row: 'From a list', group: inFive })
  await page.keyboard.press('Enter')
  await expect.poll(focused).toEqual({ on: 'Snooze', row: 'From a list', group: inSix })
  await page.keyboard.press('Enter')
  await expect(rowOf(planner(page), 'From a list')).toHaveCount(0)
  await expect.poll(focused).toEqual({ on: 'DIV', row: null, group: inSix })
  await expect(page.locator('[data-snackbar-live]')).toContainText(`Planned for ${await dayWords(page, 7)}`)
})

// ── A plan past the days shown ──────────────────────────────────────────────

test('Snooze from the window’s last day: a dated row stays there, planned later; one with no date leaves with a snackbar naming the day', async ({ page }) => {
  await seedWorkspace(page, {
    ...ALONE,
    tasks: [
      { title: 'Due on the last day', dueInDays: 6, modifiedAt: STAMP },
      { title: 'Planned on the last day', doInDays: 6, modifiedAt: STAMP },
    ],
  })
  const last = group(page, await dayKeyIn(page, 6))
  const nextDay = await dayWords(page, 7)
  await expect(titles(last)).toHaveText(['Due on the last day', 'Planned on the last day'])

  // A real date inside the window: the row stays on its day, flagged, tagged with the planned day, its date drawn late.
  const dated = rowOf(last, 'Due on the last day')
  await dated.hover({ position: { x: 80, y: 10 } })
  await dated.getByRole('button', { name: 'Snooze' }).click()
  await expect.poll(async () => (await stored(page, 'Due on the last day')).doDate).toEqual([7, 0, 0])
  await expect(rowOf(last, 'Due on the last day')).toBeVisible()
  await expect(flagOf(dated)).toHaveCount(1)
  await expect(tagOf(dated)).toHaveText(`planned ${nextDay}`)
  await expect(dated.locator('[data-row-cell="due"]')).toHaveAttribute('data-date-level', 'late')
  await expect(page.locator('[data-snackbar-live]')).not.toContainText('Planned for')
  expect(await stored(page, 'Due on the last day')).toEqual({ doDate: [7, 0, 0], held: false, dueDate: [6, 0, 0], followup: null, modifiedAt: STAMP_MS })
  // Its tag offers the fixes.
  await tagOf(dated).click()
  await expect(page.getByRole('menu', { name: 'Fix the plan' }).getByRole('menuitem')).toHaveText([`Move due date to ${nextDay}`, `Plan for ${await dayWords(page, 6)}`])
  await page.keyboard.press('Escape')

  // No real date: the row leaves the days shown — and the snackbar says where it went, with Undo.
  const plain = rowOf(last, 'Planned on the last day')
  await plain.hover({ position: { x: 80, y: 10 } })
  await plain.getByRole('button', { name: 'Snooze' }).click()
  await expect(rowOf(planner(page), 'Planned on the last day')).toHaveCount(0)
  const snackbar = page.locator('[data-snackbar-live]')
  await expect(snackbar).toContainText(`Planned for ${nextDay}`)
  expect((await stored(page, 'Planned on the last day')).doDate).toEqual([7, 0, 0])
  // The next week shows it on that day.
  await planner(page).getByRole('button', { name: 'Next week' }).click()
  await expect(rowOf(group(page, await dayKeyIn(page, 7)), 'Planned on the last day')).toBeVisible()
  await planner(page).getByRole('button', { name: /Back to this week$/ }).click()
  await snackbar.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(rowOf(last, 'Planned on the last day')).toBeVisible()
  await expect.poll(async () => (await stored(page, 'Planned on the last day')).doDate).toEqual([6, 0, 0])
})

test('an overdue row planned for next week is still in Today on this week, planned later — counted by the badge and by Reset plan', async ({ page }) => {
  await seedWorkspace(page, { ...ALONE, tasks: [{ title: 'Renew the domain', dueInDays: -2, modifiedAt: STAMP }] })
  const inEight = await dayKeyIn(page, 8)
  await expect(page.getByTestId('planner-badge')).toBeVisible()
  await planner(page).getByRole('button', { name: 'Next week' }).click()
  await drag(page, await grip(rowOf(todayGroup(page), 'Renew the domain')), await pointIn(tile(page, inEight)), {
    during: async () => { await expect(label(page)).toHaveText(`Plan · ${await dayWords(page, 8)}`) },
  })
  await expect(rowOf(group(page, inEight), 'Renew the domain')).toBeVisible()
  await expect.poll(async () => (await stored(page, 'Renew the domain')).doDate).toEqual([8, 0, 0])

  // Back on this week: not gone — in Today by its overdue date, flagged, with the day it is planned for.
  await planner(page).getByRole('button', { name: /Back to this week$/ }).click()
  const row = rowOf(todayGroup(page), 'Renew the domain')
  await expect(row).toBeVisible()
  await expect(flagOf(row)).toHaveCount(1)
  await expect(tagOf(row)).toHaveText(`planned ${await dayWords(page, 8)}`)
  await expect(delayedGroup(page)).toHaveCount(0)
  await expect(tile(page, await dayKeyIn(page, 0)).getByTestId('planner-tile-count')).toHaveText('1')
  await expect(page.getByTestId('planner-badge')).toBeVisible()
  // Reset plan counts it, and clears it.
  await planner(page).getByRole('button', { name: 'Reset plan' }).click()
  const week = page.getByRole('menu', { name: 'Reset plan' }).getByRole('menuitem').first()
  await expect(week).toContainText('1')
  await week.click()
  await confirmReset(page)
  await expect(flagOf(rowOf(todayGroup(page), 'Renew the domain'))).toHaveCount(0)
  await expect.poll(async () => (await stored(page, 'Renew the domain')).doDate).toBeNull()
  expect((await stored(page, 'Renew the domain')).dueDate).toEqual([-2, 0, 0])
})

// ── Narrow panes (Stacked rows), and the phone ──────────────────────────────

test.describe('panes narrow enough for Stacked rows', () => {
  test.use({ viewport: { width: 800, height: 900 } })

  test('the corner flag, the tag, the late date and the hover buttons are all there', async ({ page }) => {
    // Auto zoom (the app's default): a pane under 480px draws Stacked rows.
    await seedWorkspace(page, { ...ALONE, settings: { rowDensity: null } })
    await expect(planner(page)).toHaveAttribute('data-planner-face', 'large')
    await expect(daysPane(page).locator('> [data-zoom]')).toHaveAttribute('data-zoom', 'stacked')
    const inThree = await dayKeyIn(page, 3)
    const row = rowOf(group(page, inThree), 'Migrate the invoices')
    // The flag: at the row's top-left corner, drawn, and it takes no press.
    const flag = flagOf(row)
    await expect(flag).toBeVisible()
    const [f, r] = await Promise.all([box(flag), box(row)])
    expect(Math.abs(f.x - r.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(f.y - r.y)).toBeLessThanOrEqual(1)
    expect(Math.round(f.width)).toBe(9)
    expect(await flag.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')
    // Every placed row has one; a row there by its date has none.
    await expect(planner(page).locator('[data-planner-flag]')).toHaveCount(6)
    await expect(flagOf(rowOf(group(page, await dayKeyIn(page, 2)), 'Book the venue'))).toHaveCount(0)
    // The tag leads the details line, under the title; the due date is drawn late.
    const tag = tagOf(row)
    await expect(tag).toHaveText('1 day after due')
    expect((await box(tag)).y).toBeGreaterThan((await box(row.locator('[data-title-text]'))).y)
    await expect(row.locator('[data-row-cell="due"]')).toHaveAttribute('data-date-level', 'late')
    // Still there under the pointer, with the hover buttons at the title line's end.
    await row.hover({ position: { x: 80, y: 10 } })
    await expect(flag).toBeVisible()
    await expect(row.getByRole('button', { name: 'Snooze' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Unplan' })).toBeVisible()
    // The fixes open from the tag here too.
    await tag.click()
    await expect(page.getByRole('menu', { name: 'Fix the plan' }).getByRole('menuitem')).toHaveCount(2)
    await page.keyboard.press('Escape')

    // Lifted: the flag stays on the slot the row leaves, and is back on the row when it lands.
    const from = await grip(row)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 4, from.y + 10, { steps: 3 })
    await expect(group(page, inThree).locator('[data-drop-slot]')).toHaveCount(1)
    await expect(group(page, inThree).locator('[data-planner-flag]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await releaseDrag(page)
    await expect(flagOf(rowOf(group(page, inThree), 'Migrate the invoices'))).toBeVisible()
  })
})

test.describe('on the phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('one column: Today, the days with tasks, Delayed, the Unplan button, Unplanned — flags and tags, no hover buttons', async ({ page }) => {
    await seedWorkspace(page, ALONE)
    const column = planner(page).locator('[data-planner-layout="column"]')
    await expect(column).toBeVisible()
    await expect(planner(page).locator('[data-planner-pane]')).toHaveCount(0)
    const keys = await Promise.all([0, 2, 3, 4].map((n) => dayKeyIn(page, n)))
    expect(await column.locator('[data-planner-group], [data-planner-unplan-all]').evaluateAll((els) => els.map((el) => el.getAttribute('data-planner-group') ?? 'unplan')))
      .toEqual([...keys, 'delayed', 'unplan', 'unplanned'])
    // Top to bottom, in one scroll.
    const tops = await column.locator('[data-planner-group], [data-planner-unplan-all]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top))
    expect([...tops].sort((a, b) => a - b)).toEqual(tops)
    await expect(planner(page).locator('[data-planner-flag]')).toHaveCount(6)
    await expect(planner(page).locator('[data-planner-actions]')).toHaveCount(0)
    const conflict = planner(page).locator('[data-planner-row]').filter({ hasText: 'Migrate the invoices' })
    await expect(conflict.locator('[data-planner-tag]')).toHaveText('1 day after due')
    await expect(conflict.locator('[data-row-part="due"]')).toHaveAttribute('data-date-level', 'late')
    // A tile's tap brings its day into view.
    await tile(page, keys[3]!).tap()
    await expect(group(page, keys[3]!)).toBeInViewport()
    // The Unplan button works by tap.
    await unplanAll(page).scrollIntoViewIfNeeded()
    await unplanAll(page).tap()
    await expect(delayedGroup(page)).toHaveCount(0)
    await expect.poll(async () => (await stored(page, 'Old plan')).held).toBe(true)
  })
})

// ── Any task into the Planner: Plan for day › in every task menu, the editor's ⋯, a calendar entry's menu ──

/** The Planner beside a list of every task and a month calendar of due dates. */
const ANYWHERE: WorkspaceSeed = {
  tasks: [
    ...['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((title) => ({ title, dueInDays: 1, modifiedAt: STAMP })),
    { title: 'Loose idea', modifiedAt: STAMP },
  ],
  listDefinitions: [{ name: 'Everything', sort: 'manual' }],
  layouts: [{
    name: 'Week',
    columns: [
      { id: 'c1', weight: 4, rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }] })] },
      { id: 'c2', weight: 4, rows: [
        wsRow({ id: 'k2', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] }),
        wsRow({ id: 'k3', tabs: [{ id: 'cal', kind: 'calendar', view: 'month', offset: 0, titles: true, dateTypes: { due: true, followup: false, plan: false } }] }),
      ] },
    ],
  }],
}

/** Opens Plan for day › in the task menu that is open, and picks the day or Unplanned (`item`: its name's start). */
async function planFor(page: Page, item: string): Promise<void> {
  const menu = page.getByRole('menu', { name: 'Task actions' })
  await menu.getByRole('menuitem', { name: /^Plan for day/ }).hover()
  await page.getByRole('menuitemradio', { name: new RegExp(`^${item}`) }).click()
}

test('a task with no date joins the Planner from a list row’s menu — Unplanned, flagged — and Remove takes it out again', async ({ page }) => {
  await seedWorkspace(page, ANYWHERE)
  const list = wsCell(page, 'k2')
  await expect(rowOf(planner(page), 'Loose idea')).toHaveCount(0)
  await rowOf(list, 'Loose idea').locator('[data-title-text]').click({ button: 'right' })
  await planFor(page, 'Unplanned')
  const row = rowOf(unplannedGroup(page), 'Loose idea')
  await expect(row).toHaveCount(1)
  await expect(planner(page).locator('[data-planner-row]').filter({ hasText: 'Loose idea' }).locator('[data-planner-flag]')).toHaveCount(1)
  await expect.poll(async () => (await stored(page, 'Loose idea')).held).toBe(true)
  expect((await stored(page, 'Loose idea')).modifiedAt).toBe(STAMP_MS)

  // Held with no date: its hover offers Today and Remove.
  await row.hover()
  await expect(row.locator('[data-planner-actions] button')).toHaveText(['Today', 'Remove'])
  await row.getByRole('button', { name: 'Remove' }).click()
  await expect(rowOf(planner(page), 'Loose idea')).toHaveCount(0)
  await expect.poll(async () => (await stored(page, 'Loose idea')).held).toBe(false)
  const snackbar = page.locator('[data-snackbar-live]')
  await expect(snackbar).toContainText('Removed “Loose idea” from the Planner')
  await snackbar.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(rowOf(unplannedGroup(page), 'Loose idea')).toHaveCount(1)
})

test('a list row dropped on Unplanned joins the Planner, even with no date', async ({ page }) => {
  await seedWorkspace(page, ANYWHERE)
  const list = wsCell(page, 'k2')
  await drag(page, await grip(rowOf(list, 'Loose idea')), await pointIn(unplannedGroup(page)), {
    during: async () => {
      await expectMarked(unplannedGroup(page))
      await expect(label(page)).toHaveText('Unplan')
    },
  })
  await expect(rowOf(unplannedGroup(page), 'Loose idea')).toHaveCount(1)
  await expect.poll(async () => (await stored(page, 'Loose idea')).held).toBe(true)
})

test('the task editor’s ⋯ plans the task for a day: the plan only', async ({ page }) => {
  await seedWorkspace(page, ANYWHERE)
  await rowOf(wsCell(page, 'k2'), 'Loose idea').locator('[data-task-title]').dblclick()
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await editor.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: /^Plan for day/ }).hover()
  await page.getByRole('menuitemradio', { name: await dayWords(page, 3), exact: true }).click()
  await expect.poll(async () => (await stored(page, 'Loose idea')).doDate).toEqual([3, 0, 0])
  expect(await stored(page, 'Loose idea')).toEqual({ doDate: [3, 0, 0], held: false, dueDate: null, followup: null, modifiedAt: STAMP_MS })
  await editor.getByRole('button', { name: 'Done' }).click()
  await expect(titles(group(page, await dayKeyIn(page, 3)))).toHaveText(['Loose idea'])
})

test('a calendar entry — in a full day’s popover too — opens the task menu on a right-click, not the browser’s', async ({ page }) => {
  await seedWorkspace(page, ANYWHERE)
  const tomorrow = wsCell(page, 'k3').locator(`[data-day="${await dayKeyIn(page, 1)}"]`)
  await tomorrow.getByRole('button', { name: /^\d+ more tasks?$/ }).click()
  const popover = page.getByTestId('calendar-day-popover')
  await expect(popover).toBeVisible()
  await popover.locator('[data-cal-entry]').filter({ hasText: 'Six' }).click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Task actions' })
  await expect(menu).toBeVisible()
  await planFor(page, 'Today')
  await expect(rowOf(todayGroup(page), 'Six')).toHaveCount(1)
  await expect.poll(async () => (await stored(page, 'Six')).doDate).toEqual([0, 0, 0])
  // The due date stands.
  expect((await stored(page, 'Six')).dueDate).toEqual([1, 0, 0])
})

/**
 * The portrait layout (board R1, 2026-11-21): in a tall, narrow cell the
 * days scroll on top and the trays dock under them; the dock's top edge
 * shares the height (saved as view state), its chevron folds it to one bar
 * that still takes a drop to Unplanned; the week arrows sit in the top
 * line, and a line under the tiles marks the days in view.
 */
test.describe('the portrait layout', () => {
  /** Enough tasks due in three days that the day list scrolls, Today out of sight at its end. */
  const MANY: NonNullable<WorkspaceSeed['tasks']> = [
    ...TASKS,
    ...Array.from({ length: 14 }, (_, i) => ({ title: `Due later ${i + 1}`, dueInDays: 3, modifiedAt: STAMP })),
  ]
  const TALL: WorkspaceSeed = {
    tasks: MANY,
    listDefinitions: [{ name: 'Everything', sort: 'manual' }],
    layouts: [{
      name: 'Week',
      columns: [
        { id: 'c1', weight: 1, rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }] })] },
        { id: 'c2', weight: 3, rows: [wsRow({ id: 'k2', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] },
      ],
    }],
  }
  const dock = (page: Page) => planner(page).locator('[data-planner-dock]')
  const dockGrip = (page: Page) => planner(page).getByRole('separator', { name: 'Resize the trays' })
  const bar = (page: Page) => planner(page).locator('[data-planner-dock-bar]')
  const storedView = async (page: Page) => {
    const layouts = await readStore<{ cells: Array<{ tabs: Array<{ id: string; viewState?: { dockShare?: number; dockFolded?: boolean } }> }> }>(page, 'layouts')
    return layouts.flatMap((l) => l.cells).flatMap((c) => c.tabs).find((t) => t.id === 'plan')?.viewState ?? {}
  }

  test('the days over the trays dock; the week arrows in the top line; the days-in-view line follows the scroll', async ({ page }) => {
    await seedWorkspace(page, TALL)
    await expect(planner(page)).toHaveAttribute('data-planner-face', 'medium')
    await expect(planner(page).locator('[data-planner-layout="stack"]')).toBeVisible()
    await expect(daysPane(page).locator('[data-planner-group-kind="today"]')).toBeVisible()
    await expect(dock(page).locator('[data-planner-group="unplanned"]')).toBeVisible()
    // The dock sits under the days, the full width.
    const days = await box(daysPane(page))
    const trays = await box(dock(page))
    expect(trays.y).toBeGreaterThanOrEqual(days.y + days.height - 1)
    expect(Math.abs(trays.width - days.width)).toBeLessThan(2)

    // The arrows are the top line's; the strip is all tiles, and they show their ticks.
    const strip = planner(page).getByRole('group', { name: 'Days' })
    await expect(strip).toHaveAttribute('data-planner-strip-arrows', 'top-line')
    await expect(strip.getByRole('button', { name: 'Next week' })).toHaveCount(0)
    const today = await dayKeyIn(page, 0)
    await expect(tile(page, today).locator('[data-mark]').first()).toBeVisible()

    // Today's group shows, the last day's doesn't; scrolled to the end, the other way round.
    const last = await dayKeyIn(page, 6)
    await expect(tile(page, today)).toHaveAttribute('data-in-view', '')
    await expect(tile(page, last)).not.toHaveAttribute('data-in-view', '')
    await daysPane(page).evaluate((el) => { el.scrollTop = el.scrollHeight })
    await expect(tile(page, last)).toHaveAttribute('data-in-view', '')
    await expect(tile(page, today)).not.toHaveAttribute('data-in-view', '')

    // The top line's › moves the week.
    await planner(page).getByRole('button', { name: 'Next week' }).click()
    await expect(tile(page, today)).toHaveCount(0)
  })

  test('the dock’s edge shares the height: dragged, it stays after a reload; a double-click resets it', async ({ page }) => {
    await seedWorkspace(page, TALL)
    const before = (await box(dock(page))).height
    const g = await pointIn(dockGrip(page), 0.3)
    // Esc mid-drag puts it back and saves nothing.
    await page.mouse.move(g.x, g.y)
    await page.mouse.down()
    await page.mouse.move(g.x, g.y - 100, { steps: 4 })
    await expect.poll(async () => (await box(dock(page))).height).toBeGreaterThan(before + 80)
    await page.keyboard.press('Escape')
    await expect.poll(async () => Math.round((await box(dock(page))).height)).toBe(Math.round(before))
    await page.mouse.up()
    expect((await storedView(page)).dockShare).toBeUndefined()

    await page.mouse.move(g.x, g.y)
    await page.mouse.down()
    await page.mouse.move(g.x, g.y - 60, { steps: 4 })
    await page.mouse.move(g.x, g.y - 150, { steps: 4 })
    // Live while it is dragged.
    await expect.poll(async () => (await box(dock(page))).height).toBeGreaterThan(before + 120)
    await page.mouse.up()
    await expect.poll(async () => (await storedView(page)).dockShare ?? 0).toBeGreaterThan(0.45)
    await expectLayoutStored(page)
    const after = (await box(dock(page))).height
    expect(Math.abs(after - (before + 150))).toBeLessThan(4)

    await page.reload()
    await expect(dock(page)).toBeVisible()
    await expect.poll(async () => Math.round((await box(dock(page))).height)).toBe(Math.round(after))

    // The arrow keys step it; a double-click puts the default back.
    await dockGrip(page).focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => (await box(dock(page))).height).toBeLessThan(after - 10)
    await dockGrip(page).dblclick({ position: { x: 20, y: 7 } })
    await expect.poll(async () => Math.round((await box(dock(page))).height)).toBe(Math.round(before))
  })

  test('folded, the dock is one bar: it stays folded after a reload, takes a row as a drop on Unplanned, and unfolds on a click', async ({ page }) => {
    await seedWorkspace(page, TALL)
    await planner(page).getByRole('button', { name: 'Fold the trays' }).click()
    await expect(bar(page)).toBeVisible()
    await expect(dock(page)).toHaveCount(0)
    await expect.poll(async () => (await storedView(page)).dockFolded).toBe(true)
    await expectLayoutStored(page)
    await page.reload()
    await expect(bar(page)).toBeVisible()
    await expect(bar(page)).toHaveAccessibleName('Show the trays: Unplanned 1')

    // A dated row dropped on the bar is held in Unplanned, its date kept.
    const inTwo = await dayKeyIn(page, 2)
    await rowOf(group(page, inTwo), 'Book the venue').scrollIntoViewIfNeeded()
    await drag(page, await grip(rowOf(group(page, inTwo), 'Book the venue')), await pointIn(bar(page)), {
      during: async () => {
        await expectMarked(bar(page))
        await expect(label(page)).toHaveText('Unplan')
      },
    })
    await expect.poll(async () => (await stored(page, 'Book the venue')).held).toBe(true)
    expect((await stored(page, 'Book the venue')).dueDate).toEqual([2, 0, 0])
    await expect(bar(page)).toHaveAccessibleName('Show the trays: Unplanned 2')

    await bar(page).click()
    await expect(rowOf(dock(page).locator('[data-planner-group="unplanned"]'), 'Book the venue')).toBeVisible()
    await expect.poll(async () => (await storedView(page)).dockFolded).toBeUndefined()
  })
})
