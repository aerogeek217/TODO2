import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, expectLayoutStored, newestUndoStep, releaseDrag, seedWorkspace, wsCell, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * The Planner's drags and Move to day ›: a row dropped on a day tile or in a
 * group changes its day by the one rule — a row on its day by its follow-up
 * has the follow-up moved, any other gets a Do day, Focus, no day only clears
 * a Do day, the due date is never written — and a drop into a group also
 * puts the row where it was dropped (the hand order, saved with the layout).
 * While it is dragged the target is dashed in the color of the date the drop
 * changes and the lifted row carries a label saying which. A list's row is
 * taken by the same rule; a Planner row on a calendar day is the calendar's
 * drop; one on a list does nothing.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const STAMP = '2026-10-10T15:30'

/** Today: a late deadline, a follow-up, a plan. Ahead: a deadline and a follow-up in two days. Focus: one planned, one not. */
const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Renew the domain', dueInDays: -2, modifiedAt: STAMP },
  { title: 'Chase the invoice', followupInDays: 0, modifiedAt: STAMP },
  { title: 'Write the brief', doInDays: 0, dueInDays: 5, modifiedAt: STAMP },
  { title: 'Book the venue', dueInDays: 2, modifiedAt: STAMP },
  { title: 'Call the caterer', followupInDays: 2, modifiedAt: STAMP },
  { title: 'Someday focus', focus: true, modifiedAt: STAMP },
  { title: 'Planned focus', focus: true, doInDays: 1, modifiedAt: STAMP },
  { title: 'Not planned', modifiedAt: STAMP },
]

/** The Planner wide (its large face) beside a list of every task. */
const WIDE: WorkspaceSeed = {
  tasks: TASKS,
  listDefinitions: [{ name: 'Everything', sort: 'manual' }],
  layouts: [{
    name: 'Week',
    columns: [
      { id: 'c1', weight: 5, rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }] })] },
      { id: 'c2', weight: 2, rows: [wsRow({ id: 'k2', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] },
    ],
  }],
}

const planner = (page: Page) => page.locator('[data-planner="plan"]')
const group = (page: Page, key: string) => planner(page).locator(`[data-planner-group="${key}"]`)
const todayGroup = (page: Page) => planner(page).locator('[data-planner-group-kind="today"]')
const tile = (page: Page, key: string) => planner(page).locator(`[data-planner-tile="${key}"]`)
const titles = (scope: Locator) => scope.locator('[data-task-title]')
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

interface StoredTask { title: string; uid: string; doDate?: Date; dueDate?: Date; nextFollowupAt?: Date; modifiedAt: Date }

/** A stored date as `[days from today, hour, minute]`; null when absent. */
function dayAndTime(value: Date | undefined, now: Date): [number, number, number] | null {
  if (!value) return null
  const d = new Date(value)
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  return [Math.round((midnight(d) - midnight(now)) / 86_400_000), d.getHours(), d.getMinutes()]
}

/** What the database holds of the task: each date as `[days from today, hour, minute]`. */
async function stored(page: Page, title: string) {
  const task = (await readStore<StoredTask>(page, 'todos')).find((t) => t.title === title)
  if (!task) throw new Error(`no task "${title}"`)
  const now = new Date()
  return {
    doDate: dayAndTime(task.doDate, now),
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

test('a row on its day by its follow-up, dropped on a tile: the follow-up moves there, no Do day', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inThree = await dayKeyIn(page, 3)
  const row = rowOf(todayGroup(page), 'Chase the invoice')
  await drag(page, await grip(row), await pointIn(tile(page, inThree)), {
    during: async () => {
      // The tile — and the day's group — dashed in the follow-up's tone; the lifted row says which date moves.
      await expect(tile(page, inThree)).toHaveAttribute('data-planner-drop', 'followup')
      await expect(group(page, inThree)).toHaveAttribute('data-planner-drop', 'followup')
      await expect(label(page)).toHaveText(`Follow-up · ${await dayWords(page, 3)}`)
      await expect(label(page)).toHaveAttribute('data-tone', 'followup')
      await expect(page.locator('html')).not.toHaveAttribute('data-drop-refused')
    },
  })
  await expect(titles(group(page, inThree))).toHaveText(['Chase the invoice'])
  await expect(titles(todayGroup(page))).toHaveText(['Renew the domain', 'Write the brief'])
  await expect(planner(page).locator('[data-planner-drop]')).toHaveCount(0)
  await expect(label(page)).toHaveCount(0)
  // The real follow-up, a day at local midnight; the ordinary edit: stamped.
  await expect.poll(async () => (await stored(page, 'Chase the invoice')).followup).toEqual([3, 0, 0])
  const after = await stored(page, 'Chase the invoice')
  expect(after.doDate).toBeNull()
  expect(after.dueDate).toBeNull()
  expect(after.modifiedAt).toBeGreaterThan(STAMP_MS)
})

test('a row on its day by its due date, dropped on a tile: a Do day, the due date kept — and its undo leaves the stamp alone', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inTwo = await dayKeyIn(page, 2)
  const inFour = await dayKeyIn(page, 4)
  await drag(page, await grip(rowOf(group(page, inTwo), 'Book the venue')), await pointIn(tile(page, inFour)), {
    during: async () => {
      await expect(tile(page, inFour)).toHaveAttribute('data-planner-drop', 'do')
      await expect(label(page)).toHaveText(`Do · ${await dayWords(page, 4)}`)
      await expect(label(page)).toHaveAttribute('data-tone', 'do')
    },
  })
  await expect(titles(group(page, inFour))).toHaveText(['Book the venue'])
  await expect(titles(group(page, inTwo))).toHaveText(['Call the caterer'])
  await expect.poll(async () => (await stored(page, 'Book the venue')).doDate).toEqual([4, 0, 0])
  let task = await stored(page, 'Book the venue')
  expect(task.dueDate).toEqual([2, 0, 0])
  expect(task.followup).toBeNull()
  // Planning doesn't touch the task's Modified date.
  expect(task.modifiedAt).toBe(STAMP_MS)

  // One undo step: the Do day goes, the row is back on its due date, the stamp as it was.
  await expect.poll(() => newestUndoStep(page)).toMatch(/^Set Do day of/)
  await page.keyboard.press('Control+z')
  await expect(titles(group(page, inTwo))).toHaveText(['Book the venue', 'Call the caterer'])
  await expect.poll(async () => (await stored(page, 'Book the venue')).doDate).toBeNull()
  task = await stored(page, 'Book the venue')
  expect(task.dueDate).toEqual([2, 0, 0])
  expect(task.modifiedAt).toBe(STAMP_MS)
})

test('Focus, no day clears a Do day — and refuses a row that is on its day by a date', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inOne = await dayKeyIn(page, 1)
  const inTwo = await dayKeyIn(page, 2)
  const noDay = group(page, 'none')
  await expect(titles(noDay)).toHaveText(['Someday focus'])

  // A planned Focus task: its Do day cleared, it joins Focus, no day.
  await drag(page, await grip(rowOf(group(page, inOne), 'Planned focus')), await pointIn(noDay, 0.5, 0.7), {
    during: async () => {
      await expect(noDay).toHaveAttribute('data-planner-drop', 'do')
      await expect(label(page)).toHaveText('No day')
    },
  })
  await expect(titles(noDay)).toContainText(['Planned focus'])
  await expect(titles(group(page, inOne))).toHaveCount(0)
  await expect.poll(async () => (await stored(page, 'Planned focus')).doDate).toBeNull()
  expect((await stored(page, 'Planned focus')).modifiedAt).toBe(STAMP_MS)

  // A row there by its due date: refused — no mark, no label, the not-allowed cursor — and nothing is written.
  const steps = await newestUndoStep(page)
  await drag(page, await grip(rowOf(group(page, inTwo), 'Book the venue')), await pointIn(noDay, 0.5, 0.7), {
    during: async () => {
      await expect(page.locator('html')).toHaveAttribute('data-drop-refused', '')
      await expect(planner(page).locator('[data-planner-drop]')).toHaveCount(0)
      await expect(label(page)).toHaveCount(0)
      await expect(noDay.locator('[data-drop-slot]')).toHaveCount(0)
    },
  })
  await expect(page.locator('html')).not.toHaveAttribute('data-drop-refused')
  await expect(titles(group(page, inTwo))).toHaveText(['Book the venue', 'Call the caterer'])
  await expect(titles(noDay)).not.toContainText(['Book the venue'])
  const task = await stored(page, 'Book the venue')
  expect(task.doDate).toBeNull()
  expect(task.dueDate).toEqual([2, 0, 0])
  expect(task.modifiedAt).toBe(STAMP_MS)
  expect(await newestUndoStep(page)).toBe(steps)
})

test('a row dragged within Today is reordered: no date changes, and the order survives a reload', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  await expect(titles(todayGroup(page))).toHaveText(['Renew the domain', 'Chase the invoice', 'Write the brief'])
  const first = await box(rowOf(todayGroup(page), 'Renew the domain'))
  const from = await grip(rowOf(todayGroup(page), 'Write the brief'))
  await drag(page, from, { x: from.x, y: first.y + 4 }, {
    during: async () => {
      // The list's look: a blank slot where it would land; a reorder changes no date, so no mark and no label.
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

test('a row dropped into another day’s group lands where it was dropped, with that day', async ({ page }) => {
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
      await expect(target).toHaveAttribute('data-planner-drop', 'followup')
      await expect(tile(page, inTwo)).toHaveAttribute('data-planner-drop', 'followup')
      await expect(label(page)).toHaveText(`Follow-up · ${await dayWords(page, 2)}`)
      // The row stays where it was, faded, until it is let go.
      await expect(rowOf(todayGroup(page), 'Chase the invoice')).toBeVisible()
    },
  })
  await expect(titles(target)).toHaveText(['Book the venue', 'Chase the invoice', 'Call the caterer'])
  await expect(titles(todayGroup(page))).toHaveText(['Renew the domain', 'Write the brief'])
  await expect.poll(async () => (await stored(page, 'Chase the invoice')).followup).toEqual([2, 0, 0])
  expect((await stored(page, 'Chase the invoice')).doDate).toBeNull()
  await expectLayoutStored(page)

  // A row placed by its due date, dropped at the top of Today: a Do day, first there.
  const top = await box(rowOf(todayGroup(page), 'Renew the domain'))
  await drag(page, await grip(rowOf(target, 'Book the venue')), { x: top.x + 120, y: top.y + 3 }, {
    during: async () => { await expect(label(page)).toHaveText('Do · Today') },
  })
  await expect(titles(todayGroup(page))).toHaveText(['Book the venue', 'Renew the domain', 'Write the brief'])
  await expect.poll(async () => (await stored(page, 'Book the venue')).doDate).toEqual([0, 0, 0])
  expect((await stored(page, 'Book the venue')).dueDate).toEqual([2, 0, 0])

  await expectLayoutStored(page)
  await page.reload()
  await expect(titles(todayGroup(page))).toHaveText(['Book the venue', 'Renew the domain', 'Write the brief'])
  await expect(titles(group(page, inTwo))).toHaveText(['Chase the invoice', 'Call the caterer'])
})

test('a list widget’s row dropped on a tile gets that day by the same rule; the list keeps its row and its order', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inOne = await dayKeyIn(page, 1)
  const list = wsCell(page, 'k2')
  const before = await titles(list).allTextContents()
  await drag(page, await grip(rowOf(list, 'Not planned')), await pointIn(tile(page, inOne)), {
    during: async () => {
      await expect(tile(page, inOne)).toHaveAttribute('data-planner-drop', 'do')
      await expect(label(page)).toHaveText(`Do · ${await dayWords(page, 1)}`)
    },
  })
  await expect(titles(group(page, inOne))).toHaveText(['Planned focus', 'Not planned'])
  await expect.poll(async () => (await stored(page, 'Not planned')).doDate).toEqual([1, 0, 0])
  expect((await stored(page, 'Not planned')).modifiedAt).toBe(STAMP_MS)
  expect(await titles(list).allTextContents()).toEqual(before)
  expect(await readStore(page, 'listOrders')).toEqual([])

  // A list row whose follow-up puts it on a Planner day: dropped into a group, the follow-up moves, at the place dropped.
  const today = todayGroup(page)
  const first = await box(rowOf(today, 'Renew the domain'))
  await drag(page, await grip(rowOf(list, 'Call the caterer')), { x: first.x + 120, y: first.y + 3 }, {
    during: async () => {
      await expect(today.locator('[data-drop-slot]')).toHaveCount(1)
      await expect(label(page)).toHaveText('Follow-up · Today')
    },
  })
  await expect(titles(today)).toHaveText(['Call the caterer', 'Renew the domain', 'Chase the invoice', 'Write the brief'])
  await expect.poll(async () => (await stored(page, 'Call the caterer')).followup).toEqual([0, 0, 0])
  expect((await stored(page, 'Call the caterer')).doDate).toBeNull()
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
          wsRow({ id: 'k3', tabs: [{ id: 'cal', kind: 'calendar', dateTypes: { due: true, followup: false } }] }),
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
  expect(await stored(page, 'Write the brief')).toEqual({ doDate: [0, 0, 0], dueDate: [5, 0, 0], followup: null, modifiedAt: STAMP_MS })
  expect(await readStore(page, 'listOrders')).toEqual([])
  expect(await storedOrder(page)).toBeNull()

  // A calendar showing due dates: its day sets the due date, as for a list's row — the Do day stays.
  const day = page.locator(`[data-calendar-widget="cal"] [data-day="${await dayKeyIn(page, 0)}"]`)
  await drag(page, await grip(row()), await pointIn(day), {
    during: async () => { await expect(label(page)).toHaveCount(0) },
  })
  await expect.poll(async () => (await stored(page, 'Write the brief')).dueDate?.[0]).toBe(0)
  expect((await stored(page, 'Write the brief')).doDate).toEqual([0, 0, 0])
})

test('Move to day › from the keyboard: the same writes, No day off for a row placed by a date', async ({ page }) => {
  await seedWorkspace(page, WIDE)
  const inTwo = await dayKeyIn(page, 2)
  const inThree = await dayKeyIn(page, 3)

  /** Arrows down the open menu until `item` has the focus. */
  const arrowTo = async (item: Locator) => {
    for (let i = 0; i < 20 && !(await item.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('ArrowDown')
    await expect(item).toBeFocused()
  }
  /** Opens the row's task menu from the keyboard (Shift+F10 on its checkbox) and, with →, its Move to day › submenu. */
  const openMove = async (row: Locator) => {
    await row.getByRole('checkbox').first().focus()
    await page.keyboard.press('Shift+F10')
    const menu = page.getByRole('menu', { name: 'Task actions' })
    await expect(menu).toBeVisible()
    await arrowTo(menu.getByRole('menuitem', { name: /^Move to day/ }))
    await page.keyboard.press('ArrowRight')
    const sub = page.getByRole('menu').last()
    await expect(sub.getByRole('menuitemradio', { name: /^Today/ })).toBeVisible()
    return sub
  }
  /** Picks the submenu's `name` with the arrow keys and Enter. */
  const pick = async (sub: Locator, name: string | RegExp) => {
    await arrowTo(sub.getByRole('menuitemradio', { name }))
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toHaveCount(0)
  }

  // A row on its day by its due date: the submenu sets the Do day; No day is off, saying why.
  let sub = await openMove(rowOf(group(page, inTwo), 'Book the venue'))
  await expect(sub).toContainText('Sets the Do day')
  await expect(sub.getByRole('menuitemradio')).toHaveCount(8)
  await expect(sub.getByRole('menuitemradio', { name: await dayWords(page, 2) })).toHaveAttribute('aria-checked', 'true')
  const noDay = sub.getByRole('menuitemradio', { name: 'No day' })
  await expect(noDay).toBeDisabled()
  await expect(noDay).toHaveAttribute('aria-description', /due date/)
  await pick(sub, await dayWords(page, 3))
  await expect(titles(group(page, inThree))).toHaveText(['Book the venue'])
  await expect.poll(async () => (await stored(page, 'Book the venue')).doDate).toEqual([3, 0, 0])
  expect((await stored(page, 'Book the venue')).dueDate).toEqual([2, 0, 0])
  expect((await stored(page, 'Book the venue')).modifiedAt).toBe(STAMP_MS)

  // With a Do day: No day clears it, and the row is back on its due date.
  sub = await openMove(rowOf(group(page, inThree), 'Book the venue'))
  await pick(sub, 'No day')
  await expect(titles(group(page, inTwo))).toHaveText(['Book the venue', 'Call the caterer'])
  await expect.poll(async () => (await stored(page, 'Book the venue')).doDate).toBeNull()

  // A row on its day by its follow-up: the submenu moves the follow-up.
  sub = await openMove(rowOf(todayGroup(page), 'Chase the invoice'))
  await expect(sub).toContainText('Moves the follow-up')
  await expect(sub.getByRole('menuitemradio', { name: /^Today/ })).toHaveAttribute('aria-checked', 'true')
  await pick(sub, await dayWords(page, 3))
  await expect(titles(group(page, inThree))).toHaveText(['Chase the invoice'])
  await expect.poll(async () => (await stored(page, 'Chase the invoice')).followup).toEqual([3, 0, 0])
  expect((await stored(page, 'Chase the invoice')).doDate).toBeNull()
})

test('the medium face: one column takes the same drops', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: TASKS,
    layouts: [{
      name: 'Week',
      columns: [{ id: 'c1', rows: [{ id: 'r1', cells: [
        { id: 'k1', weight: 3, tabs: [{ id: 'plan', kind: 'planner' }] },
        { id: 'k2', weight: 5, tabs: [{ id: 'notes', kind: 'notes' }] },
      ] }] }],
    }],
  })
  await expect(planner(page)).toHaveAttribute('data-planner-face', 'medium')
  await expect(planner(page).locator('[data-planner-layout="column"]')).toBeVisible()
  const inOne = await dayKeyIn(page, 1)
  const inTwo = await dayKeyIn(page, 2)

  // Today → a day ahead, between its rows: the follow-up moves, the row lands there.
  const venue = await box(rowOf(group(page, inTwo), 'Book the venue'))
  await drag(page, await grip(rowOf(todayGroup(page), 'Chase the invoice')), { x: venue.x + 100, y: venue.y + venue.height + 3 }, {
    during: async () => { await expect(group(page, inTwo)).toHaveAttribute('data-planner-drop', 'followup') },
  })
  await expect(titles(group(page, inTwo))).toHaveText(['Book the venue', 'Chase the invoice', 'Call the caterer'])
  await expect.poll(async () => (await stored(page, 'Chase the invoice')).followup).toEqual([2, 0, 0])

  // A day ahead → a tile; then a reorder inside Today.
  await drag(page, await grip(rowOf(group(page, inTwo), 'Call the caterer')), await pointIn(tile(page, inOne)))
  // Dropped on a tile it has no place of its own: it keeps the one the hand order (written by the drop before) gives it.
  await expect(titles(group(page, inOne))).toHaveText(['Planned focus', 'Call the caterer'])
  await expect.poll(async () => (await stored(page, 'Call the caterer')).followup).toEqual([1, 0, 0])
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

test.describe('a short Planner', () => {
  test.use({ viewport: { width: 1440, height: 560 } })

  test('a day’s group scrolled out of the days ahead, behind Focus, no day, takes no drop: the drop is Focus, no day’s', async ({ page }) => {
    // Three deadlines on each day ahead: the days ahead scroll, their last groups lying (unseen) where Focus, no day is pinned.
    const filler: NonNullable<WorkspaceSeed['tasks']> = [1, 2, 3, 4, 5, 6].flatMap((n) => [1, 2, 3].map((i) => ({ title: `Day ${n} task ${i}`, dueInDays: n })))
    await seedWorkspace(page, {
      tasks: [{ title: 'Planned focus', focus: true, doInDays: 1, modifiedAt: STAMP }, { title: 'Someday focus', focus: true }, ...filler],
      layouts: [{ name: 'Week', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }] })] }] }],
    })
    await expect(planner(page)).toHaveAttribute('data-planner-face', 'large')
    const noDay = group(page, 'none')
    const to = await pointIn(noDay, 0.5, 0.75)
    // A day's group whose box — clipped by its scroller — holds that point.
    const hidden = await planner(page).locator('[data-planner-group-kind="day"]').evaluateAll((groups, point) => {
      const under = groups.find((g) => {
        const r = g.getBoundingClientRect()
        return point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom
      })
      return under?.getAttribute('data-planner-group') ?? null
    }, to)
    expect(hidden, 'a day group lying behind Focus, no day').not.toBeNull()
    if (!hidden) return

    const inOne = await dayKeyIn(page, 1)
    await drag(page, await grip(rowOf(group(page, inOne), 'Planned focus')), to, {
      during: async () => {
        await expect(noDay).toHaveAttribute('data-planner-drop', 'do')
        await expect(label(page)).toHaveText('No day')
        await expect(group(page, hidden)).not.toHaveAttribute('data-planner-drop')
      },
    })
    await expect(titles(noDay)).toContainText(['Planned focus'])
    await expect.poll(async () => (await stored(page, 'Planned focus')).doDate).toBeNull()
    expect((await stored(page, 'Planned focus')).modifiedAt).toBe(STAMP_MS)
  })
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
  await expect(group(page, inTwo)).toHaveAttribute('data-planner-drop', 'followup')
  await page.keyboard.press('Escape')
  await expect(planner(page).locator('[data-planner-drop]')).toHaveCount(0)
  await expect(planner(page).locator('[data-drop-slot]')).toHaveCount(0)
  await releaseDrag(page)
  await expect(titles(todayGroup(page))).toHaveText(['Renew the domain', 'Chase the invoice', 'Write the brief'])
  expect((await stored(page, 'Chase the invoice')).followup).toEqual([0, 0, 0])
  expect(await storedOrder(page)).toBeNull()
  expect(await newestUndoStep(page)).toBeNull()
})
