import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, wsTab, type WsLayoutSeed } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * The workspace on a phone: one column per screen width, swiped sideways with
 * native scroll snap; the column strip follows; tabs switch inside cells; the
 * layout picker is a bottom sheet; layout editing is not offered.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const weekly: WsLayoutSeed = {
  name: 'Weekly review',
  columns: [
    { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'todayTab', kind: 'lens', listDefIdx: 0 }] }] },
    { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] }, { id: 'b2', tabs: [{ id: 'notesTab', kind: 'notes' }] }] },
    {
      id: 'colC',
      cells: [{ id: 'c1', tabs: [{ id: 'waitTab', kind: 'lens', listDefIdx: 1 }, { id: 'eisTab', kind: 'eisenhower' }] }],
    },
  ],
}

const daily: WsLayoutSeed = {
  name: 'Daily',
  columns: [{ id: 'colD', cells: [{ id: 'd1', tabs: [{ id: 'dailyNotes', kind: 'notes' }] }] }],
}

async function seed(page: Page): Promise<void> {
  await seedWorkspace(page, {
    layouts: [weekly, daily],
    people: ['Ben'],
    listDefinitions: [{ name: 'Today' }, { name: 'Waiting on', grouping: 'people' }],
    tasks: [{ title: 'Call plumber', people: ['Ben'] }, { title: 'Pay electricity bill' }],
  })
}

const pager = (page: Page) => page.locator('[data-ws-pager]')
const columnName = (page: Page, name: string) => page.getByRole('tablist', { name: 'Columns' }).getByRole('tab', { name })

async function pagerState(page: Page): Promise<{ scrollLeft: number; page: number }> {
  return pager(page).evaluate((el) => ({ scrollLeft: el.scrollLeft, page: el.clientWidth + 8 }))
}

/**
 * A horizontal touch swipe from trusted CDP touch events, so the browser
 * scrolls and snaps natively. A negative dx moves the finger left. The events
 * carry their own timestamps — a move every 16 ms, then the finger rests
 * 200 ms before lifting (headless Chromium never ends a flick, released while
 * still moving, so it would never snap) — instead of real waits between them.
 */
async function swipe(page: Page, dx: number): Promise<void> {
  const b = await box(pager(page))
  const y = b.y + b.height / 2
  const x0 = dx < 0 ? b.x + b.width * 0.85 : b.x + b.width * 0.15
  const cdp = await page.context().newCDPSession(page)
  const steps = 10
  // Seconds since the epoch, ending now: the gesture already happened.
  const start = Date.now() / 1000 - (steps * 0.016 + 0.2)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }], timestamp: start })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / steps, y }], timestamp: start + i * 0.016 })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: start + steps * 0.016 + 0.2 })
  await cdp.detach()
}

test('mobile opens the workspace; list widgets use touch rows and tabs are not draggable', async ({ page }) => {
  await seed(page)
  await page.goto('/#/')
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('tablist', { name: 'Columns' })).toBeVisible()
  await expect(columnName(page, 'Today')).toHaveAttribute('aria-selected', 'true')

  const rows = wsCell(page, 'a1').locator('[data-todo-id]')
  await expect(rows).toHaveCount(2)
  await expect(wsCell(page, 'a1').getByRole('button', { name: 'Open task details', exact: true })).toHaveCount(2)
  await expect(wsCell(page, 'a1').locator('[data-row-key]')).toHaveCount(0)

  // Switching only: no close ×, no add-tab +, no drag handle semantics.
  await expect(wsTab(page, 'todayTab')).not.toHaveAttribute('aria-roledescription', 'draggable')
  await expect(page.getByRole('button', { name: 'Add widget as tab' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Close / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Quick add' })).toBeVisible()
})

test('swiping snaps to whole columns and the strip follows', async ({ page }) => {
  await seed(page)
  const { page: width } = await pagerState(page)

  // A short drag snaps back to the first column.
  await swipe(page, -60)
  await expect.poll(async () => (await pagerState(page)).scrollLeft).toBe(0)

  await swipe(page, -260)
  await expect.poll(async () => (await pagerState(page)).scrollLeft).toBe(width)
  await expect(columnName(page, 'Calendar')).toHaveAttribute('aria-selected', 'true')
  await expect(columnName(page, 'Today')).toHaveAttribute('aria-selected', 'false')
  const underline = page.getByTestId('ws-column-underline')
  const nameBox = await columnName(page, 'Calendar').boundingBox()
  const lineBox = await underline.boundingBox()
  expect(lineBox && nameBox && lineBox.x > nameBox.x && lineBox.x + lineBox.width < nameBox.x + nameBox.width).toBe(true)

  // On to the third column.
  await swipe(page, -360)
  await expect.poll(async () => (await pagerState(page)).scrollLeft).toBe(width * 2)
  await expect(columnName(page, 'Waiting on')).toHaveAttribute('aria-selected', 'true')

  await swipe(page, 260)
  await expect.poll(async () => (await pagerState(page)).scrollLeft).toBe(width)
})

test('tapping a column name scrolls to it; tabs switch inside a cell and stay switched', async ({ page }) => {
  await seed(page)
  const { page: width } = await pagerState(page)

  await columnName(page, 'Waiting on').tap()
  await expect.poll(async () => (await pagerState(page)).scrollLeft).toBe(width * 2)
  await expect(wsCell(page, 'c1').getByText('Ben', { exact: true })).toBeVisible()

  await wsTab(page, 'eisTab').tap()
  await expect(wsTab(page, 'eisTab')).toHaveAttribute('aria-selected', 'true')
  await expect(wsCell(page, 'c1').locator('[data-eisenhower="eisTab"]')).toBeVisible()
  // The column is named after its first cell's active tab.
  await expect(columnName(page, 'Eisenhower')).toHaveAttribute('aria-selected', 'true')

  // The active tab is view state: kept across a reload, never an unsaved change.
  await page.reload()
  await expect(wsTab(page, 'eisTab')).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('layout-picker').tap()
  const sheet = page.getByRole('dialog', { name: 'Layouts' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('Edited')).toHaveCount(0)
})

test('the ⋯ menu collapses a cell; tapping its tab expands it', async ({ page }) => {
  await seed(page)
  await wsCell(page, 'a1').getByRole('button', { name: 'Cell options' }).tap()
  const menu = page.getByRole('menu', { name: 'Cell options' })
  await expect(menu.getByRole('menuitem')).toHaveText(['Collapse cell'])
  await menu.getByRole('menuitem', { name: 'Collapse cell' }).tap()
  await expect(wsCell(page, 'a1').locator('[data-ws-cell-body]')).toHaveCount(0)
  await expect(wsCell(page, 'a1').getByRole('button', { name: 'Expand cell' })).toBeVisible()

  await wsTab(page, 'todayTab').tap()
  await expect(wsCell(page, 'a1').locator('[data-ws-cell-body]')).toBeVisible()
})

test('the layout sheet switches layouts and starts at the first column', async ({ page }) => {
  await seed(page)
  await columnName(page, 'Waiting on').tap()
  await expect.poll(async () => (await pagerState(page)).scrollLeft).toBeGreaterThan(0)

  await page.getByTestId('layout-picker').tap()
  const sheet = page.getByRole('dialog', { name: 'Layouts' })
  await expect(sheet.getByRole('button', { name: 'Weekly review' })).toHaveAttribute('aria-current', 'true')
  await expect(sheet.getByText('To create or edit layouts, use a wider screen.')).toBeVisible()
  await sheet.getByRole('button', { name: 'Daily' }).tap()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Daily')
  await expect(columnName(page, 'Notes')).toHaveAttribute('aria-selected', 'true')

  await page.getByTestId('layout-picker').tap()
  await page.getByRole('dialog', { name: 'Layouts' }).getByRole('button', { name: 'Weekly review' }).tap()
  await expect(columnName(page, 'Today')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(async () => (await pagerState(page)).scrollLeft).toBe(0)
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

test('long-pressing a list tab opens its list sheet; a list edit shows the save button', async ({ page }) => {
  await seed(page)
  // Mobile browsers turn a long press into `contextmenu`.
  await wsTab(page, 'todayTab').dispatchEvent('contextmenu')
  const sheet = page.getByRole('menu', { name: 'List' })
  await expect(sheet.getByRole('menuitem')).toHaveText(['List options…', 'Edit list…', 'Copy tasks'])
  await sheet.getByRole('menuitem', { name: 'List options…' }).click()
  const options = page.getByTestId('list-options')
  await expect(options).toBeVisible()
  await options.getByLabel('Sort').selectOption('name')
  await expect(wsCell(page, 'a1').getByTestId('save-list')).toBeVisible()
  await expect(wsTab(page, 'todayTab').getByRole('img', { name: 'unsaved list changes' })).toBeVisible()
})

test('switching between desktop and phone widths keeps the drag sensors stable (no React deps error)', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await seed(page)
  await expect(page.getByRole('tablist', { name: 'Columns' })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.getByTestId('layout-save')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('tablist', { name: 'Columns' })).toBeVisible()
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
