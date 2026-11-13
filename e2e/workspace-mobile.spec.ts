import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, wsTab, type WsLayoutSeed, wsRow } from './fixtures/workspace'
import { box } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * The workspace on a phone (D26): every cell of the table in reading order
 * (by its top track, then its left) in one scroll, a run of Numbers two up;
 * tabs switch inside cells; the layout picker is a bottom sheet; layout
 * editing is not offered.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const weekly: WsLayoutSeed = {
  name: 'Weekly review',
  columns: [
    { id: 'colA', rows: [wsRow({ id: 'a1', tabs: [{ id: 'todayTab', kind: 'lens', listDefIdx: 0 }] })] },
    { id: 'colB', rows: [wsRow({ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] }), wsRow({ id: 'b2', tabs: [{ id: 'notesTab', kind: 'notes' }] })] },
    {
      id: 'colC',
      rows: [wsRow({ id: 'c1', tabs: [{ id: 'waitTab', kind: 'lens', listDefIdx: 1 }, { id: 'mapTab', kind: 'neglect' }] })],
    },
  ],
}

const daily: WsLayoutSeed = {
  name: 'Daily',
  columns: [{ id: 'colD', rows: [wsRow({ id: 'd1', tabs: [{ id: 'dailyNotes', kind: 'notes' }] })] }],
}

async function seed(page: Page): Promise<void> {
  await seedWorkspace(page, {
    layouts: [weekly, daily],
    people: ['Ben'],
    listDefinitions: [{ name: 'Today' }, { name: 'Waiting on', grouping: 'people' }],
    tasks: [{ title: 'Call plumber', people: ['Ben'] }, { title: 'Pay electricity bill' }],
  })
}

test('mobile opens the workspace; list widgets use touch rows and tabs are not draggable', async ({ page }) => {
  await seed(page)
  await page.goto('/#/')
  await expect(page).toHaveURL(/#\/$/)
  // No column strip: every cell in one scroll.
  await expect(page.getByRole('tablist', { name: 'Columns' })).toHaveCount(0)

  const rows = wsCell(page, 'a1').locator('[data-todo-id]')
  await expect(rows).toHaveCount(2)
  // The quiet phone row (2C): its title is its one button; no ▸, pills or flag.
  await expect(rows.first().getByRole('button')).toHaveCount(1)
  await expect(wsCell(page, 'a1').getByRole('button', { name: 'Open task details', exact: true })).toHaveCount(0)
  await expect(wsCell(page, 'a1').locator('[data-row-key]')).toHaveCount(0)

  // Switching only: no close ×, no add-tab +, no drag handle semantics.
  await expect(wsTab(page, 'todayTab')).not.toHaveAttribute('aria-roledescription', 'draggable')
  await expect(page.getByRole('button', { name: 'Add widget as tab' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Close / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Quick add' })).toBeVisible()
})

test('every cell in reading order, one under another, in one scroll', async ({ page }) => {
  await seed(page)
  // The table: a1 | b1 | c1 over a1 | b2 | c1 — by top track, then left: a1, b1, c1, b2.
  const order = ['a1', 'b1', 'c1', 'b2']
  const boxes = await Promise.all(order.map((id) => box(wsCell(page, id))))
  for (let i = 1; i < boxes.length; i++) {
    const prev = boxes[i - 1]!
    const cur = boxes[i]!
    expect(Math.round(cur.x)).toBe(Math.round(prev.x))
    expect(Math.round(cur.width)).toBe(Math.round(prev.width))
    expect(cur.y).toBeGreaterThan(prev.y + prev.height - 1)
  }
  const scroller = page.locator('[data-ws-mobile] [data-ws-table]')
  const scroll = await scroller.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth }))
  expect(scroll.sh).toBeGreaterThan(scroll.ch)
  expect(scroll.sw).toBeLessThanOrEqual(scroll.cw)
})

test('a run of Number cells sits two up', async ({ page }) => {
  await seedWorkspace(page, {
    layouts: [{
      name: 'Numbers',
      table: {
        areas: ['n1 n2 n3', 'k k k'],
        cells: [
          { id: 'n1', tabs: [{ id: 'num1', kind: 'number' }] },
          { id: 'n2', tabs: [{ id: 'num2', kind: 'number', glance: { metric: 'overdue' } }] },
          { id: 'n3', tabs: [{ id: 'num3', kind: 'number', glance: { metric: 'dueToday' } }] },
          { id: 'k', tabs: [{ id: 'notesTab', kind: 'notes' }] },
        ],
      },
    }],
  })
  const [n1, n2, n3, k] = await Promise.all(['n1', 'n2', 'n3', 'k'].map((id) => box(wsCell(page, id))))
  expect(Math.round(n2!.y)).toBe(Math.round(n1!.y))
  expect(n2!.x).toBeGreaterThan(n1!.x + n1!.width - 1)
  expect(n1!.width).toBeGreaterThanOrEqual(140)
  expect(Math.round(n3!.x)).toBe(Math.round(n1!.x))
  expect(n3!.y).toBeGreaterThan(n1!.y + n1!.height - 1)
  expect(k!.y).toBeGreaterThan(n3!.y + n3!.height - 1)
})

test('tabs switch inside a cell and stay switched', async ({ page }) => {
  await seed(page)
  await wsCell(page, 'c1').scrollIntoViewIfNeeded()
  await expect(wsCell(page, 'c1').getByText('Ben', { exact: true })).toBeVisible()

  await wsTab(page, 'mapTab').tap()
  await expect(wsTab(page, 'mapTab')).toHaveAttribute('aria-selected', 'true')
  await expect(wsCell(page, 'c1').locator('[data-neglect-map="mapTab"]')).toBeVisible()

  // The active tab is view state: kept across a reload, never an unsaved change.
  await page.reload()
  await expect(wsTab(page, 'mapTab')).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('layout-picker').tap()
  const sheet = page.getByRole('dialog', { name: 'Layouts' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('Edited')).toHaveCount(0)
})

test('the ⋯ menu has the list’s items and collapses a cell’s rows (D26: Collapse row); its top line’s Expand brings it back', async ({ page }) => {
  await seed(page)
  // One widget: no tab row; its top line holds the ⋯ (D26 AA1).
  await expect(wsCell(page, 'a1').getByRole('tablist')).toHaveCount(0)
  await wsCell(page, 'a1').getByRole('button', { name: 'Cell options' }).tap()
  const menu = page.getByRole('menu', { name: 'Cell options' })
  await expect(menu.getByRole('menuitem')).toHaveText(['Edit list…', 'Copy tasks', 'Collapse row'])
  await menu.getByRole('menuitem', { name: 'Collapse row' }).tap()
  await expect(wsCell(page, 'a1').locator('[data-ws-cell-body]')).toBeHidden()
  // Its top line still shows, with Expand row.
  await expect(wsTab(page, 'todayTab').getByTestId('top-line-name')).toBeVisible()
  await wsCell(page, 'a1').getByRole('button', { name: 'Expand row' }).tap()
  await expect(wsCell(page, 'a1').locator('[data-ws-cell-body]')).toBeVisible()
})

test('a Numbers row collapsed on a wide screen expands on the phone: each collapsed Number has Expand row (cr34 W5)', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: [{ title: 'Call plumber' }, { title: 'Pay electricity bill' }],
    layouts: [{
      name: 'Numbers',
      table: {
        areas: ['n1 n2', 'k k'],
        rows: [{ weight: 1000, collapsed: true }, 1000],
        cells: [
          { id: 'n1', tabs: [{ id: 'num1', kind: 'number' }] },
          { id: 'n2', tabs: [{ id: 'num2', kind: 'number', glance: { metric: 'overdue' } }] },
          { id: 'k', tabs: [{ id: 'notesTab', kind: 'notes' }] },
        ],
      },
    }],
  })
  // Collapsed: the Number's figure is hidden, its Expand shows inside the cell and takes a tap across 44px.
  const n1 = wsCell(page, 'n1')
  await expect(n1.getByTestId('number-count')).toBeHidden()
  const expand = n1.getByRole('button', { name: 'Expand row' })
  await expect(expand).toBeVisible()
  await expect(wsCell(page, 'n2').getByRole('button', { name: 'Expand row' })).toBeVisible()
  const [cellBox, button] = [await box(n1), await box(expand)]
  expect(button.x + button.width).toBeLessThanOrEqual(cellBox.x + cellBox.width + 1)
  expect(button.y).toBeGreaterThanOrEqual(cellBox.y - 1)
  expect(button.width).toBeGreaterThanOrEqual(36)
  // The cell that isn't collapsed has none.
  await expect(wsCell(page, 'k').getByRole('button', { name: 'Expand row' })).toHaveCount(0)

  await expand.tap()
  await expect(n1.getByTestId('number-count')).toBeVisible()
  await expect(wsCell(page, 'n2').getByTestId('number-count')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Expand row' })).toHaveCount(0)
  // View state, stored.
  await expect.poll(async () => (await readStore<{ grid: { rows: Array<{ collapsed?: boolean }> } }>(page, 'layouts'))[0]?.grid.rows.some((r) => r.collapsed === true)).toBe(false)
})

test('a two-widget cell keeps its tabs; tapping a collapsed one expands it', async ({ page }) => {
  await seed(page)
  await expect(wsCell(page, 'c1').getByRole('tab')).toHaveCount(2)
  await wsCell(page, 'c1').getByRole('button', { name: 'Cell options' }).tap()
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Collapse row' }).tap()
  await expect(wsCell(page, 'c1').locator('[data-ws-cell-body]')).toHaveCount(0)
  await wsTab(page, 'waitTab').tap()
  await expect(wsCell(page, 'c1').locator('[data-ws-cell-body]')).toBeVisible()
})

test('the layout sheet switches layouts, never an unsaved change', async ({ page }) => {
  await seed(page)
  await page.getByTestId('layout-picker').tap()
  const sheet = page.getByRole('dialog', { name: 'Layouts' })
  await expect(sheet.getByRole('button', { name: 'Weekly review' })).toHaveAttribute('aria-current', 'true')
  await expect(sheet.getByText('To create or edit layouts, use a wider screen.')).toBeVisible()
  await sheet.getByRole('button', { name: 'Daily' }).tap()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Daily')
  await expect(wsCell(page, 'd1')).toBeVisible()

  await page.getByTestId('layout-picker').tap()
  await page.getByRole('dialog', { name: 'Layouts' }).getByRole('button', { name: 'Weekly review' }).tap()
  await expect(wsCell(page, 'a1')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Weekly review')
  await page.getByTestId('layout-picker').tap()
  await expect(page.getByRole('dialog', { name: 'Layouts' }).getByText('Edited')).toHaveCount(0)
})

test('the layout sheet is a bottom sheet on the dialog frame: focus on the open layout, kept inside, Esc closes, focus back', async ({ page }) => {
  await seed(page)
  const picker = page.getByTestId('layout-picker')
  await picker.focus()
  await picker.press('Enter')
  const sheet = page.getByRole('dialog', { name: 'Layouts' })
  await expect(sheet.getByRole('button', { name: 'Weekly review' })).toBeFocused()
  // Full width, on the bottom edge.
  const b = await box(sheet)
  expect(Math.round(b.x)).toBe(0)
  expect(Math.round(b.width)).toBe(390)
  expect(Math.round(b.y + b.height)).toBe(844)
  // Tab stays inside (Daily → wraps to Weekly review).
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(sheet.locator(':focus')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(picker).toBeFocused()
})

test('a list tab’s sheet is on the dialog frame too: focus in, arrows move, Tab kept inside, Esc closes, focus back on the tab', async ({ page }) => {
  await seed(page)
  // A list tab: Waiting on beside the Neglect map (one widget has no tab, D26 AA1), made active first.
  const tab = wsTab(page, 'waitTab')
  await tab.tap()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await tab.focus()
  await tab.dispatchEvent('contextmenu')
  const menu = page.getByRole('menu', { name: 'List' })
  const sheet = page.getByRole('dialog', { name: 'List tab' })
  await expect(menu.getByRole('menuitem', { name: 'Edit list…' })).toBeFocused()
  const b = await box(sheet)
  expect(Math.round(b.y + b.height)).toBe(844)
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Copy tasks' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Edit list…' })).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(sheet.locator(':focus')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(tab).toBeFocused()

  // A tap on the backdrop closes it the same way — once the tab's switch has
  // settled: while its view transition runs, its overlay takes every tap.
  await tab.dispatchEvent('contextmenu')
  await expect(sheet).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0)
  await page.mouse.click(195, 100)
  await expect(sheet).toHaveCount(0)
})

test('a list alone: its ⋯ opens Edit list, a half sheet with the list live above it', async ({ page }) => {
  await seed(page)
  // One widget, no tab to long-press: its top line's ⋯ (D26 AA1).
  const openEditList = async () => {
    await wsCell(page, 'a1').getByRole('button', { name: 'Cell options' }).tap()
    await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Edit list…' }).click()
  }
  await openEditList()

  // A half sheet: 55% of the screen, the list's rows still on screen above it.
  const sheet = page.getByRole('dialog', { name: 'Edit list Today' })
  await expect(sheet).toBeVisible()
  const s = await box(sheet)
  expect(Math.round(s.y + s.height)).toBe(844)
  expect(s.height).toBeGreaterThan(844 * 0.5)
  expect(s.height).toBeLessThan(844 * 0.6)
  const row = wsCell(page, 'a1').locator('[data-todo-id]').first()
  expect((await box(row)).y + (await box(row)).height).toBeLessThan(s.y)

  // Sort by › Name: a list of choices in the sheet; the list updates live behind it.
  await sheet.getByRole('button', { name: 'Sort by: Manual' }).click()
  await sheet.getByRole('radio', { name: /^Name/ }).click()
  await expect(sheet.getByRole('button', { name: 'Sort by: Name' })).toBeVisible()
  await expect(wsCell(page, 'a1').locator('[data-todo-id]').first()).toContainText('Call plumber')
  // No unsaved marks: the draft is the sheet's.
  await expect(wsTab(page, 'todayTab').getByRole('img', { name: 'unsaved list changes' })).toHaveCount(0)

  // A tap above the sheet asks (it has changes); Keep editing keeps it open.
  await page.mouse.click(195, 100)
  const question = page.getByRole('dialog', { name: 'Save changes to list “Today”?' })
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'Keep editing' }).tap()
  await expect(sheet).toBeVisible()
  // × asks the same way; Discard puts the list back.
  await sheet.getByRole('button', { name: 'Close Edit list' }).click()
  await question.getByRole('button', { name: 'Discard' }).tap()
  await expect(sheet).toHaveCount(0)
  expect((await readStore<{ name: string; sort: string }>(page, 'listDefinitions')).find((d) => d.name === 'Today')?.sort).toBe('manual')

  // Again, and Save: written; the filter line stays (Every open task), with no Revert · Save.
  await openEditList()
  await sheet.getByRole('button', { name: 'Sort by: Manual' }).click()
  await sheet.getByRole('radio', { name: /^Name/ }).click()
  await sheet.getByRole('button', { name: 'Save', exact: true }).tap()
  await expect(sheet).toHaveCount(0)
  await expect.poll(async () => (await readStore<{ name: string; sort: string }>(page, 'listDefinitions')).find((d) => d.name === 'Today')?.sort).toBe('name')
  const line = wsCell(page, 'a1').getByTestId('list-filter-row')
  await expect(line).toContainText('Every open task')
  await expect(line.getByTestId('save-list')).toHaveCount(0)
})

test('switching between desktop and phone widths keeps the drag sensors stable (no React deps error)', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await seed(page)
  await expect(page.locator('[data-ws-mobile]')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('[data-layout-controls]')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[data-ws-mobile]')).toBeVisible()
  expect(errors.filter((e) => e.includes('changed size between renders'))).toEqual([])
})

test('the task editor on a phone fills the screen (on the dialog frame)', async ({ page }) => {
  await seed(page)
  // Long-press a row (a mobile browser turns it into contextmenu) → Open.
  await page.getByRole('button', { name: /Call plumber/ }).first().dispatchEvent('contextmenu')
  await page.getByRole('menuitem', { name: 'Open' }).tap()
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await expect(editor).toBeVisible()
  // Once its slide-up has run.
  await expect.poll(async () => {
    const b = await box(editor)
    return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]
  }).toEqual([0, 0, 390, 844])
})

test('a tap anywhere on a row opens the task: its title, its details line, its empty right end', async ({ page }) => {
  await seed(page)
  const row = wsCell(page, 'a1').locator('[data-todo-id]').filter({ hasText: 'Call plumber' })
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  const b = await box(row)
  const details = await box(row.locator('[data-row-details]'))
  for (const [x, y] of [[b.x + 60, b.y + 18], [details.x + 4, details.y + details.height / 2], [b.x + b.width - 12, b.y + b.height / 2]] as const) {
    await page.touchscreen.tap(x, y)
    await expect(editor).toBeVisible()
    await expect(editor.getByPlaceholder('Task title')).toHaveValue('Call plumber')
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
  }
})

test('touch targets: a cell’s tabs, a row and its checkbox take taps across 44px', async ({ page }) => {
  await seed(page)
  /** How far, in px, taps along a vertical line through the element's centre still land on it. */
  const tappableHeight = (selector: string) => page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel)!
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const ys = []
    for (let y = Math.floor(r.top) - 30; y <= Math.ceil(r.bottom) + 30; y++) {
      const hit = document.elementFromPoint(x, y)
      if (hit === el || (hit && el.contains(hit))) ys.push(y)
    }
    return ys.length === 0 ? 0 : Math.max(...ys) - Math.min(...ys) + 1
  }, selector)

  await expect(wsTab(page, 'todayTab')).toBeVisible()
  expect(await tappableHeight('[data-ws-tab="todayTab"]')).toBeGreaterThanOrEqual(44)
  const row = wsCell(page, 'a1').locator('[data-todo-id]').first()
  expect((await box(row)).height).toBeGreaterThanOrEqual(44)
  const id = await row.getAttribute('data-todo-id')
  const checkbox = wsCell(page, 'a1').locator(`[data-todo-id="${id}"]`).getByRole('checkbox', { name: 'Toggle complete' })
  await expect(checkbox).toBeVisible()
  const b = await box(checkbox)
  expect(Math.round(b.width)).toBeGreaterThanOrEqual(44)
  expect(await tappableHeight('[data-ws-cell="a1"] input[type="checkbox"]')).toBeGreaterThanOrEqual(44)
  // A tap well above the drawn box still completes the task (it leaves the list, or shows ticked).
  await page.touchscreen.tap(b.x + b.width / 2, b.y + 4)
  await expect.poll(async () => (await checkbox.count()) === 0 || await checkbox.isChecked()).toBe(true)
})
