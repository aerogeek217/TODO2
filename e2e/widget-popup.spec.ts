import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, dragRow, readListOrders, seedWorkspace, wsCell, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'
import { readStore } from './fixtures/db'
import { rowTitles } from './fixtures/seed'

/**
 * Open larger (the widget popup) in a real browser: a List, a Calendar and a
 * Neglect map open from the cell's Open larger button, its ⋯ menu and the
 * palette's Open Widget Larger — one popup, `min(1400px, 100vw − 48px)` ×
 * `100vh − 48px`, centered, the same tab as the cell (its data, and an edit
 * made inside shows in the cell). Esc, × and a press on the scrim close it,
 * the focus back on what opened it.
 */

const VIEWPORT = { width: 1600, height: 1000 }
test.use({ viewport: VIEWPORT })

const SEED: WorkspaceSeed = {
  tags: ['Project: Atlas'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Renew the domain', dueInDays: -2, tags: ['Project: Atlas'] },
    { title: 'Book the venue', dueInDays: 1 },
    { title: 'Draft the agenda', dueInDays: 3 },
  ],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] },
      { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 'cal', kind: 'calendar' }] })] },
      { id: 'c3', rows: [wsRow({ id: 'k3', tabs: [{ id: 'map', kind: 'neglect', neglect: { colourBy: { tags: ['Project: Atlas'] } } }] })] },
    ],
  }],
}

const popup = (page: Page) => page.getByTestId('widget-popup')

/** The popup's size and place: nearly the whole window, centered. */
async function expectPopupSize(page: Page) {
  const p = await box(popup(page))
  expect(Math.round(p.width)).toBe(Math.min(1400, VIEWPORT.width - 48))
  expect(Math.round(p.height)).toBe(VIEWPORT.height - 48)
  expect(Math.abs(p.x + p.width / 2 - VIEWPORT.width / 2)).toBeLessThanOrEqual(1)
  expect(Math.abs(p.y + p.height / 2 - VIEWPORT.height / 2)).toBeLessThanOrEqual(1)
}

async function openFromButton(page: Page, cell: Locator): Promise<Locator> {
  await cell.hover()
  const button = cell.getByRole('button', { name: 'Open larger' })
  await button.click()
  await expect(popup(page)).toBeVisible()
  return button
}

test('a List opens larger from its button: the same list, an edit inside shows in the cell; Esc closes it, the focus back on the button', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const cell = wsCell(page, 'k1')
  await expect(cell.locator('[data-todo-id]')).toHaveCount(3)
  const button = await openFromButton(page, cell)
  await expectPopupSize(page)
  await expect(popup(page)).toHaveAttribute('aria-label', 'Team')
  await expect(popup(page).locator('[data-todo-id]')).toHaveCount(3)
  // No cell controls in the popup: its header has its own ⋯ and ×.
  await expect(popup(page).locator('[data-cell-controls]')).toHaveCount(0)

  // One live copy of the tab: the list is in the popup, the cell holds a quiet placeholder under its top line.
  await expect(page.locator('[data-list-widget="list"]')).toHaveCount(1)
  await expect(cell.locator('[data-open-larger-placeholder="list"]')).toContainText('“Team” is open larger')
  await expect(cell.locator('[data-todo-id]')).toHaveCount(0)

  await popup(page).locator('[data-row-key]').filter({ hasText: 'Book the venue' }).getByRole('checkbox', { name: 'Mark complete' }).click()
  await expect(popup(page).locator('[data-row-key]').filter({ hasText: 'Book the venue' })).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(popup(page)).toHaveCount(0)
  await expect(button).toBeFocused()
  // The cell's list is back, with the edit made in the popup.
  await expect(cell.locator('[data-open-larger-placeholder]')).toHaveCount(0)
  await expect(cell.locator('[data-todo-id]')).toHaveCount(2)
  await expect(cell.locator('[data-row-key]').filter({ hasText: 'Book the venue' })).toHaveCount(0)
})

test('a Calendar opens larger from the ⋯ menu; × closes it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const cell = wsCell(page, 'k2')
  await cell.hover()
  await cell.getByRole('button', { name: 'Cell options' }).click()
  const menu = page.getByRole('menu', { name: 'Cell options' })
  const items = await menu.getByRole('menuitem').allTextContents()
  // Open larger sits in the widget's section, before Name and icon….
  expect(items.findIndex((t) => t.includes('Open larger'))).toBeLessThan(items.findIndex((t) => t.includes('Name and icon')))
  await menu.getByRole('menuitem', { name: 'Open larger' }).click()
  await expect(popup(page)).toBeVisible()
  await expectPopupSize(page)
  await expect(popup(page).locator('[data-calendar-widget="cal"]')).toBeVisible()
  await popup(page).getByRole('button', { name: 'Close' }).click()
  await expect(popup(page)).toHaveCount(0)
})

test('a Neglect map opens larger from the palette (the cell last used); a press on the scrim closes it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const cell = wsCell(page, 'k3')
  await expect(cell.locator('[data-neglect-dot]')).not.toHaveCount(0)
  const dots = await cell.locator('[data-neglect-dot]').count()
  // The cell last used: the focus in it when the palette opens.
  await cell.hover()
  await cell.getByRole('button', { name: 'Open larger' }).focus()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Find tasks, commands/).pressSequentially('open widget larger')
  await page.keyboard.press('Enter')
  await expect(popup(page)).toBeVisible()
  await expectPopupSize(page)
  // The popup holds the tab's one live widget: the map's dots are there, the cell says it is open larger.
  await expect(popup(page).locator('[data-neglect-dot]')).toHaveCount(dots)
  await expect(cell.locator('[data-neglect-dot]')).toHaveCount(0)
  await expect(cell.locator('[data-open-larger-placeholder="map"]')).toContainText('is open larger')
  await page.mouse.click(6, VIEWPORT.height - 6)
  await expect(popup(page)).toHaveCount(0)
  await expect(cell.locator('[data-neglect-dot]')).toHaveCount(dots)
  await expect(cell.locator('[data-open-larger-placeholder]')).toHaveCount(0)
})

test('the popup’s ⋯ holds the widget’s own entries only', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await openFromButton(page, wsCell(page, 'k1'))
  await popup(page).getByRole('button', { name: 'Widget options' }).click()
  const items = await page.getByRole('menu', { name: 'Widget options' }).getByRole('menuitem').allTextContents()
  expect(items.some((t) => t.startsWith('Edit list'))).toBe(true)
  for (const absent of ['Open larger', 'Change widget', 'Add widget', 'Split cell', 'Close cell', 'Name and icon']) {
    expect(items.some((t) => t.includes(absent))).toBe(false)
  }
})

// ── One live widget per tab (cr34 H1): dragging after, and inside, the popup ──

const DRAG_SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Order' }],
  tasks: [{ title: 'Alpha' }, { title: 'Bravo' }, { title: 'Charlie' }, { title: 'Delta' }],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] },
      // Due dates only: a row dropped on a day sets its due date, with no Due / Follow-up question.
      { id: 'c2', weight: 2, rows: [wsRow({ id: 'k2', tabs: [{ id: 'cal', kind: 'calendar', titles: true, dateTypes: { due: true, followup: false } }] })] },
    ],
  }],
}

const listRow = (scope: Locator, title: string) => scope.locator('[data-row-key]', { has: scope.page().locator(`span[data-task-title="${title}"]`) })
/** Viewport y just inside the top of `target` (a row dropped there lands before it). */
const above = async (target: Locator) => (await box(target)).y + 4

/** The `data-day` key (local `YYYY-MM-DD`, in the page's time zone) of today + `n` days. */
function dayKey(page: Page, n: number): Promise<string> {
  return page.evaluate((n) => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, n)
}

/** The stored due date of task `title` as days from today (its day in the page's time zone; whatever its time of day), or `null`. */
async function dueInDays(page: Page, title: string): Promise<number | null> {
  const due = (await readStore<{ title: string; dueDate?: Date }>(page, 'todos')).find((t) => t.title === title)?.dueDate?.getTime()
  if (due == null) return null
  return page.evaluate((due) => {
    const now = new Date()
    const d = new Date(due)
    const midnight = (y: number, m: number, day: number) => Date.UTC(y, m, day)
    return Math.round((midnight(d.getFullYear(), d.getMonth(), d.getDate()) - midnight(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000)
  }, due)
}

/** The titles of list `Order`'s ranked tasks, by their stored rank. */
async function storedOrder(page: Page): Promise<string[]> {
  const todos = await readStore<{ id: number; title: string }>(page, 'todos')
  return (await readListOrders(page))
    .sort((a, b) => a.rank - b.rank || a.todoId - b.todoId)
    .map((r) => todos.find((t) => t.id === r.todoId)?.title ?? `#${r.todoId}`)
}

test('after Open larger closes, the cell’s rows and entries drag as before: a reorder, a row onto a calendar day, an entry to another day', async ({ page }) => {
  await seedWorkspace(page, DRAG_SEED)
  const list = wsCell(page, 'k1')
  const cal = wsCell(page, 'k2')
  await expect.poll(() => rowTitles(list)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])

  // Before the popup: a row drag reorders the list.
  await dragRow(page, listRow(list, 'Delta'), await above(listRow(list, 'Bravo')))
  await expect.poll(() => rowTitles(list)).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie'])

  // The list open larger, then closed: its rows drag as before.
  await openFromButton(page, list)
  await page.keyboard.press('Escape')
  await expect(popup(page)).toHaveCount(0)
  await expect.poll(() => rowTitles(list)).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie'])
  await dragRow(page, listRow(list, 'Alpha'), await above(listRow(list, 'Charlie')), async () => {
    await expect(page.locator('[data-drop-slot]')).toHaveCount(1)
  })
  await expect.poll(() => rowTitles(list)).toEqual(['Delta', 'Bravo', 'Alpha', 'Charlie'])
  await expect.poll(() => storedOrder(page)).toEqual(['Delta', 'Bravo', 'Alpha', 'Charlie'])

  // The calendar open larger, then closed: its days take a row's drop…
  await openFromButton(page, cal)
  await expect(popup(page).locator('[data-calendar-widget="cal"]')).toBeVisible()
  await expect(cal.locator('[data-calendar-widget="cal"]')).toHaveCount(0)
  await popup(page).getByRole('button', { name: 'Close' }).click()
  await expect(popup(page)).toHaveCount(0)
  const day1 = cal.locator(`[data-day="${await dayKey(page, 1)}"]`)
  const row = await box(listRow(list, 'Bravo'))
  await drag(page, { x: row.x + 40, y: row.y + row.height / 2 }, await pointIn(day1), {
    during: async () => { await expect(day1).toContainText('Set due') },
  })
  await expect(day1.locator('[data-cal-entry="due"]')).toContainText('Bravo')
  await expect.poll(() => dueInDays(page, 'Bravo')).toBe(1)

  // … and its entries move to another day.
  const day2 = cal.locator(`[data-day="${await dayKey(page, 2)}"]`)
  const entry = await box(day1.locator('[data-cal-entry="due"]'))
  await drag(page, { x: entry.x + 10, y: entry.y + entry.height / 2 }, await pointIn(day2), {
    during: async () => { await expect(day2).toContainText('Move here') },
  })
  await expect(day2.locator('[data-cal-entry="due"]')).toContainText('Bravo')
  await expect.poll(() => dueInDays(page, 'Bravo')).toBe(2)
})

test('a row dragged inside the open popup lands once: one landing slot, one order write, and the cell shows it after', async ({ page }) => {
  await seedWorkspace(page, DRAG_SEED)
  const list = wsCell(page, 'k1')
  await expect.poll(() => rowTitles(list)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  // Counts the manual order's writes (`list-order-store.setRanks`).
  await page.evaluate(async () => {
    const m = (await import(/* @vite-ignore */ '/src/stores/list-order-store.ts' as string)) as {
      useListOrderStore: {
        getState: () => { setRanks: (...args: unknown[]) => Promise<void> }
        setState: (patch: { setRanks: (...args: unknown[]) => Promise<void> }) => void
      }
    }
    const counter = window as unknown as { rankWrites: number }
    counter.rankWrites = 0
    const setRanks = m.useListOrderStore.getState().setRanks
    m.useListOrderStore.setState({
      setRanks: (...args) => {
        counter.rankWrites += 1
        return setRanks(...args)
      },
    })
  })
  const rankWrites = () => page.evaluate(() => (window as unknown as { rankWrites: number }).rankWrites)

  await openFromButton(page, list)
  const inPopup = popup(page)
  await expect.poll(() => rowTitles(inPopup)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  await dragRow(page, listRow(inPopup, 'Delta'), await above(listRow(inPopup, 'Bravo')), async () => {
    // One list follows the drag: one landing slot on the page.
    await expect(page.locator('[data-drop-slot]')).toHaveCount(1)
  })
  await expect.poll(() => rowTitles(inPopup)).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie'])
  await expect.poll(() => storedOrder(page)).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie'])
  expect(await rankWrites()).toBe(1)

  await page.keyboard.press('Escape')
  await expect(popup(page)).toHaveCount(0)
  await expect.poll(() => rowTitles(list)).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie'])
  // And the cell's rows drag again.
  await dragRow(page, listRow(list, 'Alpha'), await above(listRow(list, 'Charlie')))
  await expect.poll(() => rowTitles(list)).toEqual(['Delta', 'Bravo', 'Alpha', 'Charlie'])
  expect(await rankWrites()).toBe(2)
})
